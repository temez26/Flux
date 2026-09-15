//! Downloads with single-range support, so browsers and download managers can resume.

use std::{io::SeekFrom, path::PathBuf};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use futures_util::{StreamExt, TryStreamExt, stream};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::{
    Shared,
    error::{AppError, Result},
    transfers::{self, hex},
    zip,
};

const READ_BUFFER: usize = 256 * 1024;

/// A response body assembled from in-memory bytes and on-disk files.
pub enum Part {
    Bytes(Bytes),
    File { path: PathBuf, len: u64 },
}

impl Part {
    fn len(&self) -> u64 {
        match self {
            Part::Bytes(b) => b.len() as u64,
            Part::File { len, .. } => *len,
        }
    }
}

/// Streams bytes `start..end` of the concatenated parts, opening files lazily.
fn body(parts: Vec<Part>, start: u64, end: u64) -> Body {
    let mut pieces = Vec::new();
    let mut pos = 0;
    for part in parts {
        let (part_start, part_end) = (pos, pos + part.len());
        pos = part_end;
        if part_end <= start || part_start >= end {
            continue;
        }
        let from = start.saturating_sub(part_start);
        let to = end.min(part_end) - part_start;
        pieces.push((part, from, to));
    }
    let stream = stream::iter(pieces)
        .then(|(part, from, to)| async move {
            Ok::<_, std::io::Error>(match part {
                Part::Bytes(b) => stream::once(async move { Ok(b.slice(from as usize..to as usize)) }).boxed(),
                Part::File { path, .. } => {
                    let mut file = tokio::fs::File::open(path).await?;
                    file.seek(SeekFrom::Start(from)).await?;
                    ReaderStream::with_capacity(file.take(to - from), READ_BUFFER).boxed()
                }
            })
        })
        .try_flatten();
    Body::from_stream(stream)
}

/// Parses a single `bytes=` range into `start..end`. `Err` means unsatisfiable.
fn parse_range(value: &str, total: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (first, last) = spec.split_once('-')?;
    let range = if first.is_empty() {
        let suffix: u64 = last.parse().ok()?;
        (total.saturating_sub(suffix), total)
    } else {
        let start: u64 = first.parse().ok()?;
        let end = if last.is_empty() { total } else { last.parse::<u64>().ok()?.saturating_add(1).min(total) };
        (start, end)
    };
    Some(if range.0 < range.1 { Ok(range) } else { Err(()) })
}

fn content_disposition(name: &str, inline: bool) -> HeaderValue {
    let fallback: String = name
        .chars()
        .map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    let disposition = if inline { "inline" } else { "attachment" };
    HeaderValue::from_str(&format!("{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"))
        .unwrap_or_else(|_| HeaderValue::from_static(disposition))
}

fn respond(request: &HeaderMap, parts: Vec<Part>, etag: String, mime: &str, name: &str, inline: bool) -> Response {
    // Previews revisit the same files, and their content never changes under one ETag.
    if request.get(header::IF_NONE_MATCH).is_some_and(|v| v.as_bytes() == etag.as_bytes()) {
        return (
            StatusCode::NOT_MODIFIED,
            [(header::ETAG, etag), (header::CACHE_CONTROL, "private, no-cache".to_owned())],
        )
            .into_response();
    }

    let total: u64 = parts.iter().map(Part::len).sum();
    let if_range_ok = request
        .get(header::IF_RANGE)
        .is_none_or(|v| v.to_str().is_ok_and(|v| v == etag));
    let range = request
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .filter(|_| if_range_ok)
        .and_then(|v| parse_range(v, total));

    let (status, start, end) = match range {
        None => (StatusCode::OK, 0, total),
        Some(Ok((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end),
        Some(Err(())) => {
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{total}"))],
            )
                .into_response();
        }
    };

    let mut response = Response::new(body(parts, start, end));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    let mime = HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream"));
    headers.insert(header::CONTENT_TYPE, mime);
    headers.insert(header::CONTENT_LENGTH, (end - start).into());
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    headers.insert(header::CONTENT_DISPOSITION, content_disposition(name, inline));
    if let Ok(etag) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, etag);
    }
    if status == StatusCode::PARTIAL_CONTENT {
        let range = format!("bytes {start}-{}/{total}", end - 1);
        headers.insert(header::CONTENT_RANGE, HeaderValue::from_str(&range).unwrap());
    }
    response
}

#[derive(Deserialize)]
pub struct FileQuery {
    inline: Option<String>,
}

pub async fn file(
    State(state): State<Shared>,
    Path((code, idx)): Path<(String, i32)>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    let (path, size, mime, hash): (String, i64, String, Vec<u8>) = sqlx::query_as(
        "SELECT path, size, mime, hash FROM files
         WHERE transfer_id = $1 AND idx = $2 AND hash IS NOT NULL",
    )
    .bind(transfer.id)
    .bind(idx)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NOT_FOUND)?;

    let name = path.rsplit('/').next().unwrap_or(&path);
    // Only PDFs open inline, for the browser's viewer. Other uploads shown inline on this origin
    // (HTML, SVG) could run scripts; forcing the type keeps a renamed file from being sniffed as one.
    let inline = query.inline.is_some() && name.to_ascii_lowercase().ends_with(".pdf");
    let mime = if inline { "application/pdf" } else { &mime };
    let parts = vec![Part::File { path: transfers::file_path(&state, transfer.id, idx), len: size as u64 }];
    Ok(respond(&headers, parts, format!("\"{}\"", hex(&hash)), mime, name, inline))
}

pub async fn zip(
    State(state): State<Shared>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    let rows: Vec<(i32, String, i64, Option<i64>, Option<Vec<u8>>, Option<i32>)> = sqlx::query_as(
        "SELECT idx, path, size, modified, hash, crc32 FROM files WHERE transfer_id = $1 ORDER BY idx",
    )
    .bind(transfer.id)
    .fetch_all(&state.db)
    .await?;

    let mut etag = blake3::Hasher::new();
    let mut entries = Vec::with_capacity(rows.len());
    for (idx, path, size, modified, hash, crc) in rows {
        let (Some(hash), Some(crc)) = (hash, crc) else {
            return Err(AppError(StatusCode::CONFLICT, "transfer is not complete yet"));
        };
        etag.update(&hash);
        entries.push(zip::Entry {
            name: path,
            size: size as u64,
            crc: crc as u32,
            modified: modified
                .and_then(DateTime::<Utc>::from_timestamp_millis)
                .unwrap_or(transfer.created_at),
            file: transfers::file_path(&state, transfer.id, idx),
        });
    }
    if entries.is_empty() {
        return Err(AppError::NOT_FOUND);
    }

    let etag = format!("\"{}\"", etag.finalize().to_hex());
    let name = format!("flux-{}.zip", transfer.code);
    Ok(respond(&headers, zip::build(entries), etag, "application/zip", &name, false))
}

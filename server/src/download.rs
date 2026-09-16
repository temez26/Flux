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

pub fn respond(request: &HeaderMap, parts: Vec<Part>, etag: String, mime: &str, name: &str, inline: bool) -> Response {
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

/// Most ranges a selection may name; a folder, being contiguous, needs one.
const MAX_RANGES: usize = 4096;

/// Parses a selection written as index ranges, such as `0-12,15,40-44`, into sorted,
/// merged ranges. `None` for anything malformed.
fn parse_selection(spec: &str) -> Option<Vec<(i32, i32)>> {
    let mut ranges = Vec::new();
    for part in spec.split(',') {
        let (first, last) = part.split_once('-').unwrap_or((part, part));
        let (first, last): (i32, i32) = (first.parse().ok()?, last.parse().ok()?);
        if first < 0 || last < first || ranges.len() == MAX_RANGES {
            return None;
        }
        ranges.push((first, last));
    }
    ranges.sort_unstable();
    let mut merged: Vec<(i32, i32)> = Vec::with_capacity(ranges.len());
    for (first, last) in ranges {
        match merged.last_mut() {
            Some(prev) if first <= prev.1.saturating_add(1) => prev.1 = prev.1.max(last),
            _ => merged.push((first, last)),
        }
    }
    Some(merged)
}

fn selected(ranges: &[(i32, i32)], idx: i32) -> bool {
    let after = ranges.partition_point(|&(first, _)| first <= idx);
    after > 0 && idx <= ranges[after - 1].1
}

/// The deepest folder every path sits in, to name an archive of part of a transfer after.
fn common_folder<'a>(paths: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    let mut shared: Option<Vec<&str>> = None;
    for path in paths {
        let folders: Vec<&str> = path.rsplit_once('/').map_or(vec![], |(dir, _)| dir.split('/').collect());
        shared = Some(match shared {
            None => folders,
            Some(prev) => prev.into_iter().zip(folders).take_while(|(a, b)| a == b).map(|(a, _)| a).collect(),
        });
    }
    shared?.pop()
}

#[derive(Deserialize)]
pub struct ZipQuery {
    /// Only these files, as index ranges. The whole transfer when absent.
    files: Option<String>,
}

pub async fn zip(
    State(state): State<Shared>,
    Path(code): Path<String>,
    Query(query): Query<ZipQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    let selection = match query.files.as_deref() {
        Some(spec) => Some(parse_selection(spec).ok_or(AppError::bad_request("invalid file selection"))?),
        None => None,
    };
    let transfer = transfers::find(&state.db, &code).await?;
    let mut rows: Vec<(i32, String, i64, Option<i64>, Option<Vec<u8>>, Option<i32>)> = sqlx::query_as(
        "SELECT idx, path, size, modified, hash, crc32 FROM files WHERE transfer_id = $1 ORDER BY idx",
    )
    .bind(transfer.id)
    .fetch_all(&state.db)
    .await?;
    if let Some(ranges) = &selection {
        rows.retain(|row| selected(ranges, row.0));
    }
    // Only the files asked for have to be complete, so part of a transfer that is still
    // uploading can already be taken.
    let name = match &selection {
        None => format!("flux-{}.zip", transfer.code),
        Some(_) => match common_folder(rows.iter().map(|row| row.1.as_str())) {
            Some(folder) => format!("{folder}.zip"),
            None => format!("flux-{}-selection.zip", transfer.code),
        },
    };

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
    Ok(respond(&headers, zip::build(entries), etag, "application/zip", &name, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_selection_as_merged_ranges() {
        assert_eq!(parse_selection("0-12,15,40-44"), Some(vec![(0, 12), (15, 15), (40, 44)]));
        assert_eq!(parse_selection("7"), Some(vec![(7, 7)]));
        // Overlapping, adjacent and out-of-order ranges fold together.
        assert_eq!(parse_selection("5-9,0-4,8-12,20"), Some(vec![(0, 12), (20, 20)]));
    }

    #[test]
    fn refuses_a_malformed_selection() {
        for spec in ["", "a", "3-1", "-1", "1-", ",", "1,,2", "0-2147483648"] {
            assert_eq!(parse_selection(spec), None, "{spec:?}");
        }
        let too_many = (0..=MAX_RANGES).map(|i| (i * 2).to_string()).collect::<Vec<_>>().join(",");
        assert_eq!(parse_selection(&too_many), None, "more ranges than a request should carry");
    }

    #[test]
    fn tells_which_files_a_selection_holds() {
        let ranges = parse_selection("0-2,10,20-21").unwrap();
        let held: Vec<i32> = (0..25).filter(|&i| selected(&ranges, i)).collect();
        assert_eq!(held, [0, 1, 2, 10, 20, 21]);
    }

    #[test]
    fn names_an_archive_after_the_folder_its_files_share() {
        assert_eq!(common_folder(["trip/2024/a.jpg", "trip/2024/b.jpg"]), Some("2024"));
        assert_eq!(common_folder(["trip/2024/a.jpg", "trip/2025/b.jpg"]), Some("trip"));
        assert_eq!(common_folder(["a.jpg", "trip/b.jpg"]), None, "a loose file shares no folder");
        assert_eq!(common_folder(["trip/a.jpg"]), Some("trip"));
        assert_eq!(common_folder(Vec::<&str>::new()), None);
    }
}

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::Serialize;

use super::{find, hex};
use crate::{
    Shared,
    error::{AppError, Result},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    idx: i32,
    path: String,
    size: i64,
    #[serde(rename = "type")]
    mime: String,
    modified: Option<i64>,
    hash: Option<String>,
    received: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInfo {
    code: String,
    title: String,
    /// The text of a text transfer; absent for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    editable: bool,
    note_version: i32,
    collect: bool,
    downloads: i32,
    closed: bool,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    hosted: bool,
    public: bool,
    /// Seconds it lasts once its upload completes; absent when it counts from creation.
    lifetime: Option<i32>,
    files: Vec<FileInfo>,
}

/// Sizes of the partial files among `wanted`, read with one directory listing.
fn sizes_on_disk(dir: &std::path::Path, wanted: &HashSet<i32>) -> HashMap<i32, u64> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return HashMap::new();
    };
    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let idx: i32 = entry.file_name().to_str()?.parse().ok()?;
            if !wanted.contains(&idx) {
                return None;
            }
            Some((idx, entry.metadata().ok()?.len()))
        })
        .collect()
}

/// idx, path, size, mime, modified, hash
type FileRow = (i32, String, i64, String, Option<i64>, Option<Vec<u8>>);

pub async fn get(State(state): State<Shared>, Path(code): Path<String>, headers: HeaderMap) -> Result<Response> {
    let transfer = find(&state.db, &code).await?;
    let rows: Vec<FileRow> =
        sqlx::query_as("SELECT idx, path, size, mime, modified, hash FROM files WHERE transfer_id = $1 ORDER BY idx")
            .bind(transfer.id)
            .fetch_all(&state.db)
            .await?;

    let mut received = state.uploads.received_for(transfer.id);
    // In-memory progress is lost on restart; partial files on disk still tell it.
    let unknown: HashSet<i32> = rows
        .iter()
        .filter(|row| row.5.is_none() && !received.contains_key(&row.0))
        .map(|row| row.0)
        .collect();
    if !unknown.is_empty() {
        let dir = state.data_dir.join(transfer.id.to_string());
        let on_disk = tokio::task::spawn_blocking(move || sizes_on_disk(&dir, &unknown))
            .await
            .map_err(|_| AppError::INTERNAL)?;
        received.extend(on_disk);
    }

    let files = rows
        .into_iter()
        .map(|(idx, path, size, mime, modified, hash)| {
            let received = if hash.is_some() {
                size as u64
            } else {
                received.get(&idx).copied().unwrap_or(0)
            };
            FileInfo {
                idx,
                path,
                size,
                mime,
                modified,
                hash: hash.as_deref().map(hex),
                received,
            }
        })
        .collect();

    let body = serde_json::to_vec(&TransferInfo {
        code: transfer.code,
        title: transfer.title,
        note: transfer.note,
        editable: transfer.editable,
        note_version: transfer.note_version,
        collect: transfer.collect,
        downloads: transfer.downloads,
        closed: transfer.closed,
        created_at: transfer.created_at,
        expires_at: transfer.expires_at,
        hosted: transfer.hosted,
        public: transfer.public,
        lifetime: transfer.lifetime,
        files,
    })
    .map_err(|_| AppError::INTERNAL)?;

    // Receivers poll this; when nothing changed they get a 304 instead of the whole file list.
    let etag = format!("\"{}\"", blake3::hash(&body).to_hex());
    let unchanged = headers
        .get(header::IF_NONE_MATCH)
        .is_some_and(|v| v.as_bytes() == etag.as_bytes());
    let mut response = if unchanged {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        ([(header::CONTENT_TYPE, "application/json")], body).into_response()
    };
    let response_headers = response.headers_mut();
    response_headers.insert(
        header::ETAG,
        HeaderValue::from_str(&etag).map_err(|_| AppError::INTERNAL)?,
    );
    response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Ok(response)
}

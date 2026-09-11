//! Resumable uploads. The length of the file on disk is the authoritative upload offset, so a
//! chunk interrupted mid-stream keeps every byte that reached the server and no per-chunk
//! database writes are needed.

use std::{
    collections::HashMap,
    io::{Read, SeekFrom},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::json;
use tokio::io::{AsyncSeekExt, AsyncWriteExt, BufWriter};
use uuid::Uuid;

use crate::{
    Shared,
    error::{AppError, Result},
    transfers,
};

type Key = (Uuid, i32);

/// A stalled client must not hold the upload lock forever, or its retry would be locked out.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct Registry(Mutex<HashMap<Key, Arc<Upload>>>);

#[derive(Default)]
struct Upload {
    received: AtomicU64,
    digest: tokio::sync::Mutex<Digest>,
}

/// Running checksums over the first `len` bytes of the file.
#[derive(Default)]
struct Digest {
    len: u64,
    blake3: blake3::Hasher,
    crc: crc32fast::Hasher,
}

impl Digest {
    fn update(&mut self, data: &[u8]) {
        self.blake3.update(data);
        self.crc.update(data);
        self.len += data.len() as u64;
    }
}

impl Registry {
    fn get(&self, key: Key) -> Arc<Upload> {
        self.0.lock().unwrap().entry(key).or_default().clone()
    }

    pub fn received(&self, key: Key) -> Option<u64> {
        self.0.lock().unwrap().get(&key).map(|u| u.received.load(Ordering::Relaxed))
    }

    pub fn remove(&self, key: Key) {
        self.0.lock().unwrap().remove(&key);
    }

    pub fn remove_transfer(&self, id: Uuid) {
        self.0.lock().unwrap().retain(|key, _| key.0 != id);
    }
}

fn progress(status: StatusCode, offset: u64, complete: bool) -> Response {
    (status, Json(json!({ "offset": offset, "complete": complete }))).into_response()
}

/// Rebuilds checksums from disk, e.g. after a server restart lost the in-memory state.
async fn digest_prefix(path: PathBuf, len: u64) -> std::io::Result<Digest> {
    tokio::task::spawn_blocking(move || {
        let mut reader = std::fs::File::open(path)?.take(len);
        let mut digest = Digest::default();
        let mut buf = vec![0; 1 << 20];
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                return Ok(digest);
            }
            digest.update(&buf[..n]);
        }
    })
    .await?
}

pub async fn chunk(
    State(state): State<Shared>,
    Path((code, idx)): Path<(String, i32)>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    transfers::authorize(&headers, &transfer)?;
    let (size, hash): (i64, Option<Vec<u8>>) =
        sqlx::query_as("SELECT size, hash FROM files WHERE transfer_id = $1 AND idx = $2")
            .bind(transfer.id)
            .bind(idx)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NOT_FOUND)?;
    let size = size as u64;
    if hash.is_some() {
        // Idempotent: a retried final chunk whose response was lost lands here.
        return Ok(progress(StatusCode::OK, size, true));
    }

    let offset: u64 = headers
        .get("upload-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or(AppError::bad_request("missing upload-offset"))?;
    let expected_hash = headers
        .get("upload-hash")
        .and_then(|v| v.to_str().ok())
        .map(str::to_ascii_lowercase);

    let key = (transfer.id, idx);
    let upload = state.uploads.get(key);
    let Ok(mut digest) = upload.digest.try_lock() else {
        return Err(AppError(StatusCode::LOCKED, "upload already in progress"));
    };

    let path = transfers::file_path(&state, transfer.id, idx);
    let mut file = tokio::fs::OpenOptions::new().write(true).create(true).truncate(false).open(&path).await?;
    let mut len = file.metadata().await?.len();
    upload.received.store(len, Ordering::Relaxed);
    if offset != len {
        return Ok(progress(StatusCode::CONFLICT, len, false));
    }
    if digest.len != len {
        *digest = digest_prefix(path.clone(), len).await?;
    }

    file.seek(SeekFrom::Start(len)).await?;
    let mut writer = BufWriter::with_capacity(1 << 20, file);
    let mut stream = body.into_data_stream();
    let mut oversized = false;
    while let Ok(Some(Ok(data))) = tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
        if len + data.len() as u64 > size {
            oversized = true;
            break;
        }
        if let Err(err) = writer.write_all(&data).await {
            digest.len = u64::MAX; // disk contents unknown; force a rebuild next time
            return Err(err.into());
        }
        digest.update(&data);
        len += data.len() as u64;
        upload.received.store(len, Ordering::Relaxed);
    }
    // Flush even when the client went away so the kept bytes match the digest.
    if let Err(err) = writer.flush().await {
        digest.len = u64::MAX;
        return Err(err.into());
    }
    if oversized {
        return Err(AppError(StatusCode::PAYLOAD_TOO_LARGE, "data exceeds declared file size"));
    }
    if len < size {
        return Ok(progress(StatusCode::OK, len, false));
    }

    let finished = std::mem::take(&mut *digest);
    let blake3 = finished.blake3.finalize();
    if expected_hash.is_some_and(|expected| expected != blake3.to_hex().as_str()) {
        writer.into_inner().set_len(0).await?;
        upload.received.store(0, Ordering::Relaxed);
        return Err(AppError(StatusCode::UNPROCESSABLE_ENTITY, "integrity check failed"));
    }

    sqlx::query("UPDATE files SET hash = $3, crc32 = $4 WHERE transfer_id = $1 AND idx = $2")
        .bind(transfer.id)
        .bind(idx)
        .bind(blake3.as_bytes().as_slice())
        .bind(finished.crc.finalize() as i32)
        .execute(&state.db)
        .await?;
    drop(digest);
    state.uploads.remove(key);
    Ok(progress(StatusCode::OK, size, true))
}

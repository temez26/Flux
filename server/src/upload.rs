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
    body::{Body, BodyDataStream},
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::json;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use uuid::Uuid;

use crate::{
    Shared,
    error::{AppError, Result},
    transfers,
};

type Key = (Uuid, i32);

/// A stalled client must not hold the upload lock forever, or its retry would be locked out.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// Upper bound for reading the rest of a chunk the server has already answered.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(10);
/// Bytes buffered before each write syscall.
const WRITE_BUFFER: usize = 1 << 20;
/// How far the file may run ahead of the digest before catching up needs a full re-read. An
/// interrupted request leaves at most one uncommitted buffer behind, so the real gap is smaller.
const MAX_REWIND: u64 = 4 << 20;

/// Answered while a rebuild runs; the client waits and retries rather than failing the file.
const REBUILDING: AppError = AppError(StatusCode::LOCKED, "checking the part already uploaded");

#[derive(Default)]
pub struct Registry(Mutex<HashMap<Key, Arc<Upload>>>);

#[derive(Default)]
struct Upload {
    received: AtomicU64,
    state: tokio::sync::Mutex<Checksums>,
}

/// What is known about the checksums of the bytes already on disk.
// One lives behind each upload's lock and is updated in place, never moved, so the size of
// `Ready` costs nothing that a box would save.
#[allow(clippy::large_enum_variant)]
#[derive(Default)]
enum Checksums {
    /// Nothing, e.g. after a restart: the file must be re-read before more can be appended.
    #[default]
    Unknown,
    /// A background task is re-reading the file to produce `Ready`.
    Rebuilding,
    Ready(Digest),
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

    /// Bytes received so far for each of a transfer's files that are mid-upload.
    pub fn received_for(&self, id: Uuid) -> HashMap<i32, u64> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(key, _)| key.0 == id)
            .map(|(key, upload)| (key.1, upload.received.load(Ordering::Relaxed)))
            .collect()
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

/// Reads the first `len` bytes back to recompute what the running digest lost.
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

/// Rebuilds the digest off the request path. Re-reading a multi-gigabyte file takes longer than
/// the client's stall timeout, so doing it inline makes every retry start the read over and a
/// large upload never converges.
fn spawn_rebuild(upload: Arc<Upload>, path: PathBuf, len: u64) {
    tokio::spawn(async move {
        let rebuilt = digest_prefix(path, len).await;
        let mut slot = upload.state.lock().await;
        *slot = match rebuilt {
            Ok(digest) => Checksums::Ready(digest),
            Err(err) => {
                tracing::warn!("failed to rebuild upload digest: {err}");
                Checksums::Unknown
            }
        };
    });
}

/// Writes the buffer, then folds it into the digest. An interrupted request can leave bytes on
/// disk that the digest never counted, but never the reverse, so the gap stays small enough to
/// repair by dropping those bytes instead of re-reading the file.
async fn commit(file: &mut tokio::fs::File, buf: &mut Vec<u8>, digest: &mut Digest) -> std::io::Result<()> {
    if buf.is_empty() {
        return Ok(());
    }
    file.write_all(buf).await?;
    file.flush().await?;
    digest.update(buf);
    buf.clear();
    Ok(())
}

pub async fn chunk(
    State(state): State<Shared>,
    Path((code, idx)): Path<(String, i32)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let mut stream = body.into_data_stream();
    let response = write_chunk(state, code, idx, headers, &mut stream)
        .await
        .into_response();
    // Browsers report a response that arrives before their upload finished as a network
    // error, hiding statuses the client needs (404 gone, 409 offset). Read the rest first.
    let _ = tokio::time::timeout(DRAIN_TIMEOUT, async { while let Some(Ok(_)) = stream.next().await {} }).await;
    response
}

async fn write_chunk(
    state: Shared,
    code: String,
    idx: i32,
    headers: HeaderMap,
    stream: &mut BodyDataStream,
) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    transfers::authorize_file(&state.db, &headers, &transfer, idx).await?;
    // A hosted transfer was accepted without checking for room to store it, so it must not
    // become a way to store anything. Not 409: that status carries the real offset and the
    // client retries it at once, which here would spin forever.
    if transfer.hosted {
        return Err(AppError(
            StatusCode::FORBIDDEN,
            "this transfer is served from the sender's device",
        ));
    }
    transfers::keep_uploading(&state.db, transfer.id).await?;
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
    let Ok(mut slot) = upload.state.try_lock() else {
        return Err(AppError(StatusCode::LOCKED, "upload already in progress"));
    };

    let path = transfers::file_path(&state, transfer.id, idx);
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .await?;
    let on_disk = file.metadata().await?.len();

    // An empty digest already describes an empty file, so a new upload never needs a rebuild.
    if on_disk == 0 && !matches!(*slot, Checksums::Ready(_)) {
        *slot = Checksums::Ready(Digest::default());
    }
    let rewind = match &*slot {
        Checksums::Ready(digest) if digest.len == on_disk => None,
        Checksums::Ready(digest) if on_disk > digest.len && on_disk - digest.len <= MAX_REWIND => Some(digest.len),
        Checksums::Rebuilding => return Err(REBUILDING),
        _ => {
            *slot = Checksums::Rebuilding;
            spawn_rebuild(upload.clone(), path, on_disk);
            return Err(REBUILDING);
        }
    };
    // An interrupted request wrote past the digest. Dropping those few bytes for the client to
    // resend is instant, where catching the digest up would re-read the whole file.
    if let Some(len) = rewind {
        file.set_len(len).await?;
    }
    let Checksums::Ready(digest) = &mut *slot else {
        return Err(AppError::INTERNAL);
    };
    upload.received.store(digest.len, Ordering::Relaxed);
    if offset != digest.len {
        return Ok(progress(StatusCode::CONFLICT, digest.len, false));
    }

    file.seek(SeekFrom::Start(digest.len)).await?;
    let mut buf = Vec::with_capacity(WRITE_BUFFER);
    let mut oversized = false;
    let mut failure = None;
    while let Ok(Some(Ok(data))) = tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
        if digest.len + (buf.len() + data.len()) as u64 > size {
            oversized = true;
            break;
        }
        buf.extend_from_slice(&data);
        if buf.len() >= WRITE_BUFFER {
            if let Err(err) = commit(&mut file, &mut buf, digest).await {
                failure = Some(err);
                break;
            }
            upload.received.store(digest.len, Ordering::Relaxed);
        }
    }
    // Commit even when the client went away, so the kept bytes match the digest.
    if failure.is_none() {
        failure = commit(&mut file, &mut buf, digest).await.err();
    }
    upload.received.store(digest.len, Ordering::Relaxed);
    if let Some(err) = failure {
        return Err(err.into());
    }
    if oversized {
        return Err(AppError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "data exceeds declared file size",
        ));
    }
    if digest.len < size {
        return Ok(progress(StatusCode::OK, digest.len, false));
    }

    let finished = std::mem::take(digest);
    let blake3 = finished.blake3.finalize();
    if expected_hash.is_some_and(|expected| expected != blake3.to_hex().as_str()) {
        file.set_len(0).await?;
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
    transfers::start_lifetime(&state.db, transfer.id).await?;
    drop(slot);
    state.uploads.remove(key);
    Ok(progress(StatusCode::OK, size, true))
}

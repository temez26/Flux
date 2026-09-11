use std::{collections::HashSet, path::PathBuf};

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
};
use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Shared,
    error::{AppError, Result},
};

/// Unambiguous characters only (no 0/o, 1/i/l) so codes can be read aloud and typed on a phone.
const CODE_ALPHABET: &[u8] = b"23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LEN: usize = 8;
const EXPIRY_CHOICES: [i64; 3] = [3600, 86_400, 604_800];
const MAX_FILES: usize = 100_000;
const MAX_PATH_LEN: usize = 1024;

#[derive(sqlx::FromRow)]
pub struct Transfer {
    pub id: Uuid,
    pub code: String,
    pub token_hash: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub fn normalize_code(raw: &str) -> String {
    raw.chars().filter(|c| *c != '-').flat_map(char::to_lowercase).collect()
}

pub async fn find(db: &sqlx::PgPool, code: &str) -> Result<Transfer> {
    sqlx::query_as(
        "SELECT id, code, token_hash, created_at, expires_at FROM transfers
         WHERE code = $1 AND expires_at > now()",
    )
    .bind(normalize_code(code))
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NOT_FOUND)
}

pub fn token_matches(token: &str, transfer: &Transfer) -> bool {
    <[u8; 32]>::try_from(transfer.token_hash.as_slice())
        // blake3::Hash equality is constant-time.
        .is_ok_and(|stored| blake3::hash(token.as_bytes()) == blake3::Hash::from(stored))
}

pub fn authorize(headers: &HeaderMap, transfer: &Transfer) -> Result<()> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(AppError::UNAUTHORIZED)?;
    if token_matches(token, transfer) {
        Ok(())
    } else {
        Err(AppError::UNAUTHORIZED)
    }
}

pub fn file_path(state: &Shared, transfer: Uuid, idx: i32) -> PathBuf {
    state.data_dir.join(transfer.to_string()).join(idx.to_string())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LEN)
        .map(|_| CODE_ALPHABET[rng.random_range(0..CODE_ALPHABET.len())] as char)
        .collect()
}

fn valid_path(path: &str) -> bool {
    path.len() <= MAX_PATH_LEN
        && !path.contains(['\\', '\0'])
        && path.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFile {
    path: String,
    size: i64,
    #[serde(default, rename = "type")]
    mime: String,
    modified: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTransfer {
    files: Vec<NewFile>,
    expires_in: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    code: String,
    token: String,
    expires_at: DateTime<Utc>,
}

pub async fn create(State(state): State<Shared>, Json(req): Json<NewTransfer>) -> Result<Json<Created>> {
    if req.files.is_empty() || req.files.len() > MAX_FILES {
        return Err(AppError::bad_request("invalid file count"));
    }
    if !EXPIRY_CHOICES.contains(&req.expires_in) {
        return Err(AppError::bad_request("invalid expiry"));
    }
    let mut seen = HashSet::with_capacity(req.files.len());
    let mut total: u64 = 0;
    for file in &req.files {
        if file.size < 0 || !valid_path(&file.path) || !seen.insert(file.path.as_str()) {
            return Err(AppError::bad_request("invalid file entry"));
        }
        total = total.saturating_add(file.size as u64);
    }
    if available_space(&state.data_dir).is_some_and(|free| total > free) {
        return Err(AppError(StatusCode::INSUFFICIENT_STORAGE, "not enough free space on server"));
    }

    let id = Uuid::new_v4();
    let token = hex(&rand::random::<[u8; 32]>());
    let token_hash = blake3::hash(token.as_bytes());
    let expires_at = Utc::now() + chrono::Duration::seconds(req.expires_in);

    let mut tx = state.db.begin().await?;
    let mut code = None;
    for _ in 0..8 {
        let candidate = random_code();
        let inserted = sqlx::query(
            "INSERT INTO transfers (id, code, token_hash, expires_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (code) DO NOTHING",
        )
        .bind(id)
        .bind(&candidate)
        .bind(token_hash.as_bytes().as_slice())
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            code = Some(candidate);
            break;
        }
    }
    let code = code.ok_or(AppError::INTERNAL)?;

    let count = req.files.len();
    let (mut idxs, mut paths, mut sizes, mut mimes, mut modified) = (
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
    );
    for (idx, file) in req.files.into_iter().enumerate() {
        idxs.push(idx as i32);
        paths.push(file.path);
        sizes.push(file.size);
        mimes.push(if file.mime.is_empty() { "application/octet-stream".to_owned() } else { file.mime });
        modified.push(file.modified);
    }
    sqlx::query(
        "INSERT INTO files (transfer_id, idx, path, size, mime, modified)
         SELECT $1, * FROM UNNEST($2::int[], $3::text[], $4::bigint[], $5::text[], $6::bigint[])",
    )
    .bind(id)
    .bind(&idxs)
    .bind(&paths)
    .bind(&sizes)
    .bind(&mimes)
    .bind(&modified)
    .execute(&mut *tx)
    .await?;

    tokio::fs::create_dir_all(state.data_dir.join(id.to_string())).await?;
    tx.commit().await?;

    Ok(Json(Created { code, token, expires_at }))
}

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
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    files: Vec<FileInfo>,
}

pub async fn get(State(state): State<Shared>, Path(code): Path<String>) -> Result<Json<TransferInfo>> {
    let transfer = find(&state.db, &code).await?;
    let rows: Vec<(i32, String, i64, String, Option<i64>, Option<Vec<u8>>)> = sqlx::query_as(
        "SELECT idx, path, size, mime, modified, hash FROM files WHERE transfer_id = $1 ORDER BY idx",
    )
    .bind(transfer.id)
    .fetch_all(&state.db)
    .await?;

    let files = rows
        .into_iter()
        .map(|(idx, path, size, mime, modified, hash)| {
            let received = match hash {
                Some(_) => size as u64,
                None => state.uploads.received((transfer.id, idx)).unwrap_or(0),
            };
            FileInfo { idx, path, size, mime, modified, hash: hash.as_deref().map(hex), received }
        })
        .collect();

    Ok(Json(TransferInfo {
        code: transfer.code,
        created_at: transfer.created_at,
        expires_at: transfer.expires_at,
        files,
    }))
}

pub async fn delete(
    State(state): State<Shared>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    let transfer = find(&state.db, &code).await?;
    authorize(&headers, &transfer)?;
    sqlx::query("DELETE FROM transfers WHERE id = $1").bind(transfer.id).execute(&state.db).await?;
    crate::cleanup::remove_transfer_data(&state, transfer.id).await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_file(
    State(state): State<Shared>,
    Path((code, idx)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    let transfer = find(&state.db, &code).await?;
    authorize(&headers, &transfer)?;
    sqlx::query("DELETE FROM files WHERE transfer_id = $1 AND idx = $2")
        .bind(transfer.id)
        .bind(idx)
        .execute(&state.db)
        .await?;
    state.uploads.remove((transfer.id, idx));
    match tokio::fs::remove_file(file_path(&state, transfer.id, idx)).await {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(StatusCode::NO_CONTENT),
    }
}

#[cfg(unix)]
fn available_space(path: &std::path::Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `path` is a valid NUL-terminated string and `stat` is a plain C struct.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    Some(stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(not(unix))]
fn available_space(_: &std::path::Path) -> Option<u64> {
    None
}

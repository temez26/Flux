use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
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
const PUBLIC_LIST_LIMIT: i64 = 100;

#[derive(sqlx::FromRow)]
pub struct Transfer {
    pub id: Uuid,
    pub code: String,
    pub token_hash: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// Served from the sender's device; the server never holds the bytes.
    pub hosted: bool,
}

pub fn normalize_code(raw: &str) -> String {
    raw.chars().filter(|c| *c != '-').flat_map(char::to_lowercase).collect()
}

pub async fn find(db: &sqlx::PgPool, code: &str) -> Result<Transfer> {
    sqlx::query_as(
        "SELECT id, code, token_hash, created_at, expires_at, hosted FROM transfers
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

/// A human name for the transfer: the dropped folder's name, or the first file's name.
fn title(files: &[NewFile]) -> String {
    let first = files[0].path.as_str();
    let top = first.split('/').next().unwrap_or(first);
    let one_folder = files.len() > 1
        && first.contains('/')
        && files.iter().all(|f| f.path.split('/').next() == Some(top));
    if one_folder {
        top.to_owned()
    } else {
        first.rsplit('/').next().unwrap_or(first).to_owned()
    }
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
    #[serde(default)]
    public: bool,
    /// Keep nothing but the file list: the sender serves the bytes itself.
    #[serde(default)]
    hosted: bool,
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
    if !req.hosted && let Some(free) = available_space(&state.data_dir) {
        // Free space already accounts for every byte written so far, but not for the ones
        // transfers accepted earlier are still expecting. Without holding those back, two
        // large transfers created moments apart both pass and then fight over the same room.
        let promised = outstanding(&state).await?;
        if total > free.saturating_sub(promised) {
            return Err(AppError(StatusCode::INSUFFICIENT_STORAGE, "not enough free space on server"));
        }
    }

    let id = Uuid::new_v4();
    let token = hex(&rand::random::<[u8; 32]>());
    let token_hash = blake3::hash(token.as_bytes());
    let expires_at = Utc::now() + chrono::Duration::seconds(req.expires_in);
    let title = title(&req.files);

    let mut tx = state.db.begin().await?;
    let mut code = None;
    for _ in 0..8 {
        let candidate = random_code();
        let inserted = sqlx::query(
            "INSERT INTO transfers (id, code, token_hash, expires_at, public, title, hosted)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (code) DO NOTHING",
        )
        .bind(id)
        .bind(&candidate)
        .bind(token_hash.as_bytes().as_slice())
        .bind(expires_at)
        .bind(req.public)
        .bind(&title)
        .bind(req.hosted)
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

    if !req.hosted {
        tokio::fs::create_dir_all(state.data_dir.join(id.to_string())).await?;
    }
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
    hosted: bool,
    files: Vec<FileInfo>,
}

/// Sizes of the partial files among `wanted`, read with one directory listing.
fn sizes_on_disk(dir: &std::path::Path, wanted: &HashSet<i32>) -> HashMap<i32, u64> {
    let Ok(entries) = std::fs::read_dir(dir) else { return HashMap::new() };
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

pub async fn get(State(state): State<Shared>, Path(code): Path<String>, headers: HeaderMap) -> Result<Response> {
    let transfer = find(&state.db, &code).await?;
    let rows: Vec<(i32, String, i64, String, Option<i64>, Option<Vec<u8>>)> = sqlx::query_as(
        "SELECT idx, path, size, mime, modified, hash FROM files WHERE transfer_id = $1 ORDER BY idx",
    )
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
            let received = if hash.is_some() { size as u64 } else { received.get(&idx).copied().unwrap_or(0) };
            FileInfo { idx, path, size, mime, modified, hash: hash.as_deref().map(hex), received }
        })
        .collect();

    let body = serde_json::to_vec(&TransferInfo {
        code: transfer.code,
        created_at: transfer.created_at,
        expires_at: transfer.expires_at,
        hosted: transfer.hosted,
        files,
    })
    .map_err(|_| AppError::INTERNAL)?;

    // Receivers poll this; when nothing changed they get a 304 instead of the whole file list.
    let etag = format!("\"{}\"", blake3::hash(&body).to_hex());
    let unchanged = headers.get(header::IF_NONE_MATCH).is_some_and(|v| v.as_bytes() == etag.as_bytes());
    let mut response = if unchanged {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        ([(header::CONTENT_TYPE, "application/json")], body).into_response()
    };
    let response_headers = response.headers_mut();
    response_headers.insert(header::ETAG, HeaderValue::from_str(&etag).map_err(|_| AppError::INTERNAL)?);
    response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Ok(response)
}

const SUMMARY_SQL: &str = "SELECT t.code, t.title, t.created_at, t.expires_at, t.hosted,
        count(f.idx) AS files,
        coalesce(sum(f.size), 0)::bigint AS size,
        -- Nothing is pending for a hosted transfer: its bytes were never coming here.
        t.hosted OR count(f.idx) = count(f.hash) AS complete
     FROM transfers t JOIN files f ON f.transfer_id = t.id";

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    code: String,
    title: String,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    hosted: bool,
    files: i64,
    size: i64,
    complete: bool,
}

/// Public transfers, newest first.
pub async fn list_public(State(state): State<Shared>) -> Result<Json<Vec<Summary>>> {
    let sql = format!(
        "{SUMMARY_SQL} WHERE t.public AND t.expires_at > now()
         GROUP BY t.id ORDER BY t.created_at DESC LIMIT $1"
    );
    let transfers = sqlx::query_as(&sql).bind(PUBLIC_LIST_LIMIT).fetch_all(&state.db).await?;
    Ok(Json(transfers))
}

/// Counts and completion without the file list, for cheap status checks.
pub async fn summary(State(state): State<Shared>, Path(code): Path<String>) -> Result<Json<Summary>> {
    let sql = format!("{SUMMARY_SQL} WHERE t.code = $1 AND t.expires_at > now() GROUP BY t.id");
    let summary = sqlx::query_as(&sql)
        .bind(normalize_code(&code))
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NOT_FOUND)?;
    Ok(Json(summary))
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
    crate::thumbs::remove(&state, transfer.id, idx).await;
    match tokio::fs::remove_file(file_path(&state, transfer.id, idx)).await {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(StatusCode::NO_CONTENT),
    }
}

/// Bytes already on disk for one transfer, counting the uploads and not the thumbnail cache.
fn stored_bytes(dir: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            // Uploads are named for their index; anything else here is the server's own.
            entry.file_name().to_str()?.parse::<i32>().ok()?;
            Some(entry.metadata().ok()?.len())
        })
        .sum()
}

/// What transfers already accepted still expect to be sent, across the whole server.
///
/// Counted per transfer as everything it declared less what it has actually stored, so a
/// long upload that is nearly done holds back only the part still to come.
async fn outstanding(state: &Shared) -> Result<u64> {
    let pending: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT t.id, coalesce(sum(f.size), 0)::bigint FROM transfers t
         JOIN files f ON f.transfer_id = t.id
         WHERE NOT t.hosted AND t.expires_at > now()
         GROUP BY t.id HAVING count(f.idx) <> count(f.hash)",
    )
    .fetch_all(&state.db)
    .await?;
    if pending.is_empty() {
        return Ok(0);
    }

    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || {
        pending
            .into_iter()
            .map(|(id, declared)| {
                let stored = stored_bytes(&data_dir.join(id.to_string()));
                (declared.max(0) as u64).saturating_sub(stored)
            })
            .sum()
    })
    .await
    .map_err(|_| AppError::INTERNAL)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_uploads_and_ignores_the_thumbnail_cache() {
        let dir = std::env::temp_dir().join(format!("flux-stored-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("thumbs")).unwrap();
        std::fs::write(dir.join("0"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.join("1"), vec![0u8; 24]).unwrap();
        // Named for a file it belongs to, but not one of the uploads themselves.
        std::fs::write(dir.join("thumbs").join("0.jpg"), vec![0u8; 5000]).unwrap();
        std::fs::write(dir.join(".0.12345"), vec![0u8; 7000]).unwrap();

        assert_eq!(stored_bytes(&dir), 1024);
        assert_eq!(stored_bytes(&dir.join("missing")), 0, "an absent directory holds nothing");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_finished_upload_holds_nothing_back() {
        // What `outstanding` works out per transfer, on its own.
        let remaining = |declared: i64, stored: u64| (declared.max(0) as u64).saturating_sub(stored);
        assert_eq!(remaining(1_000, 0), 1_000, "nothing sent yet");
        assert_eq!(remaining(1_000, 400), 600, "part way through");
        assert_eq!(remaining(1_000, 1_000), 0, "done");
        assert_eq!(remaining(1_000, 1_200), 0, "never negative");
    }
}

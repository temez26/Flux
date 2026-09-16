use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use axum::{
    Json,
    extract::{Path, Query, State},
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
const MAX_TITLE: usize = 80;
const MAX_CONTRIBUTOR: usize = 60;
const COLLECTION_TITLE: &str = "Collected files";
/// Ceiling on one request, so a wide listing can be paged through but never asked for whole.
const PUBLIC_LIST_MAX: i64 = 500;
/// Stands in for a LIKE wildcard, so a title containing % or _ searches for those characters.
const LIKE_ESCAPE: char = '!';

#[derive(sqlx::FromRow)]
pub struct Transfer {
    pub id: Uuid,
    pub code: String,
    pub token_hash: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// Served from the sender's device; the server never holds the bytes.
    pub hosted: bool,
    /// Open to files from anyone with the code, not only from its owner.
    pub collect: bool,
    pub title: String,
}

pub fn normalize_code(raw: &str) -> String {
    raw.chars().filter(|c| *c != '-').flat_map(char::to_lowercase).collect()
}

pub async fn find(db: &sqlx::PgPool, code: &str) -> Result<Transfer> {
    sqlx::query_as(
        "SELECT id, code, token_hash, created_at, expires_at, hosted, collect, title FROM transfers
         WHERE code = $1 AND expires_at > now()",
    )
    .bind(normalize_code(code))
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NOT_FOUND)
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

fn hash_matches(token: &str, stored: &[u8]) -> bool {
    <[u8; 32]>::try_from(stored)
        // blake3::Hash equality is constant-time.
        .is_ok_and(|stored| blake3::hash(token.as_bytes()) == blake3::Hash::from(stored))
}

pub fn token_matches(token: &str, transfer: &Transfer) -> bool {
    hash_matches(token, &transfer.token_hash)
}

pub fn authorize(headers: &HeaderMap, transfer: &Transfer) -> Result<()> {
    match bearer(headers) {
        Some(token) if token_matches(token, transfer) => Ok(()),
        _ => Err(AppError::UNAUTHORIZED),
    }
}

/// Whether a request may write to or remove one file: its transfer's owner may, and in a
/// collection so may whoever added that file.
pub async fn authorize_file(db: &sqlx::PgPool, headers: &HeaderMap, transfer: &Transfer, idx: i32) -> Result<()> {
    let token = bearer(headers).ok_or(AppError::UNAUTHORIZED)?;
    if token_matches(token, transfer) {
        return Ok(());
    }
    if transfer.collect {
        let stored: Option<Option<Vec<u8>>> =
            sqlx::query_scalar("SELECT upload_token_hash FROM files WHERE transfer_id = $1 AND idx = $2")
                .bind(transfer.id)
                .bind(idx)
                .fetch_optional(db)
                .await?;
        if stored.flatten().is_some_and(|hash| hash_matches(token, &hash)) {
            return Ok(());
        }
    }
    Err(AppError::UNAUTHORIZED)
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
    /// A collection, created empty for others to add files to.
    #[serde(default)]
    collect: bool,
    /// What a collection is called; an ordinary transfer is named after its files.
    #[serde(default)]
    title: Option<String>,
}

fn collection_title(title: Option<&str>) -> String {
    let title: String = title.unwrap_or_default().chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect();
    let title = title.trim();
    if title.is_empty() { COLLECTION_TITLE.to_owned() } else { title.to_owned() }
}

/// A contributor's name as the one folder their files go into, or None if nothing usable is left.
fn contributor_folder(name: &str) -> Option<String> {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\'))
        .take(MAX_CONTRIBUTOR)
        .collect();
    let name = name.trim();
    (!name.is_empty() && name != "." && name != "..").then(|| name.to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    code: String,
    token: String,
    expires_at: DateTime<Utc>,
}

/// The declared size of a batch of files, once every entry is one the server can store.
fn checked_total(files: &[NewFile]) -> Result<u64> {
    let mut seen = HashSet::with_capacity(files.len());
    let mut total: u64 = 0;
    for file in files {
        if file.size < 0 || !valid_path(&file.path) || !seen.insert(file.path.as_str()) {
            return Err(AppError::bad_request("invalid file entry"));
        }
        total = total.saturating_add(file.size as u64);
    }
    Ok(total)
}

async fn ensure_room(state: &Shared, total: u64) -> Result<()> {
    let Some(free) = available_space(&state.data_dir) else { return Ok(()) };
    // Free space already accounts for every byte written so far, but not for the ones
    // transfers accepted earlier are still expecting. Without holding those back, two large
    // transfers created moments apart both pass and then fight over the same room.
    let promised = outstanding(state).await?;
    if total > free.saturating_sub(promised) {
        return Err(AppError(StatusCode::INSUFFICIENT_STORAGE, "not enough free space on server"));
    }
    Ok(())
}

/// "photo.jpg" becomes "photo (1).jpg" while its name is taken — the way the page renames
/// duplicates within one selection, applied to files the transfer already holds.
fn unique_path(path: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(path) {
        return path.to_owned();
    }
    let name = path.rfind('/').map_or(0, |slash| slash + 1);
    // A leading dot starts a hidden file's name, not its extension.
    let split = match path[name..].rfind('.') {
        Some(dot) if dot > 0 => name + dot,
        _ => path.len(),
    };
    (1..)
        .map(|n| format!("{} ({n}){}", &path[..split], &path[split..]))
        .find(|candidate| !taken.contains(candidate))
        .expect("an unused name is always found")
}

async fn insert_files(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    transfer: Uuid,
    first_idx: i32,
    files: Vec<NewFile>,
    upload_token_hash: Option<&[u8]>,
) -> Result<()> {
    let count = files.len();
    let (mut idxs, mut paths, mut sizes, mut mimes, mut modified) = (
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
    );
    for (offset, file) in files.into_iter().enumerate() {
        idxs.push(first_idx + offset as i32);
        paths.push(file.path);
        sizes.push(file.size);
        mimes.push(if file.mime.is_empty() { "application/octet-stream".to_owned() } else { file.mime });
        modified.push(file.modified);
    }
    sqlx::query(
        "INSERT INTO files (transfer_id, idx, path, size, mime, modified, upload_token_hash)
         SELECT $1, u.*, $7::bytea FROM UNNEST($2::int[], $3::text[], $4::bigint[], $5::text[], $6::bigint[]) AS u",
    )
    .bind(transfer)
    .bind(&idxs)
    .bind(&paths)
    .bind(&sizes)
    .bind(&mimes)
    .bind(&modified)
    .bind(upload_token_hash)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn create(State(state): State<Shared>, Json(req): Json<NewTransfer>) -> Result<Json<Created>> {
    let counted = if req.collect {
        // A collection starts empty, and its files are uploaded here by whoever adds them.
        req.files.is_empty() && !req.hosted
    } else {
        !req.files.is_empty() && req.files.len() <= MAX_FILES
    };
    if !counted {
        return Err(AppError::bad_request("invalid file count"));
    }
    if !EXPIRY_CHOICES.contains(&req.expires_in) {
        return Err(AppError::bad_request("invalid expiry"));
    }
    let total = checked_total(&req.files)?;
    if !req.hosted {
        ensure_room(&state, total).await?;
    }

    let id = Uuid::new_v4();
    let token = hex(&rand::random::<[u8; 32]>());
    let token_hash = blake3::hash(token.as_bytes());
    let expires_at = Utc::now() + chrono::Duration::seconds(req.expires_in);
    let title = if req.collect { collection_title(req.title.as_deref()) } else { title(&req.files) };

    let mut tx = state.db.begin().await?;
    let mut code = None;
    for _ in 0..8 {
        let candidate = random_code();
        let inserted = sqlx::query(
            "INSERT INTO transfers (id, code, token_hash, expires_at, public, title, hosted, collect, next_idx)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (code) DO NOTHING",
        )
        .bind(id)
        .bind(&candidate)
        .bind(token_hash.as_bytes().as_slice())
        .bind(expires_at)
        .bind(req.public)
        .bind(&title)
        .bind(req.hosted)
        .bind(req.collect)
        .bind(req.files.len() as i32)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            code = Some(candidate);
            break;
        }
    }
    let code = code.ok_or(AppError::INTERNAL)?;
    insert_files(&mut tx, id, 0, req.files, None).await?;

    if !req.hosted {
        tokio::fs::create_dir_all(state.data_dir.join(id.to_string())).await?;
    }
    tx.commit().await?;

    Ok(Json(Created { code, token, expires_at }))
}

#[derive(Deserialize)]
pub struct NewFiles {
    files: Vec<NewFile>,
    /// Who is adding to a collection; their files go into a folder by that name.
    #[serde(default)]
    from: Option<String>,
}

#[derive(Serialize)]
pub struct AddedFile {
    idx: i32,
    /// Differs from the path asked for when that one was already taken.
    path: String,
}

#[derive(Serialize)]
pub struct Added {
    files: Vec<AddedFile>,
    /// For someone adding to a collection: what lets them upload, or cancel, what they added.
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

/// Adds files to a transfer: one its owner created earlier, so a file forgotten the first time
/// doesn't mean a new code for everyone it was already shared with, or a collection anyone with
/// the code may add to. The files come back in the order asked for, with the index each was given.
pub async fn add_files(
    State(state): State<Shared>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(mut req): Json<NewFiles>,
) -> Result<Json<Added>> {
    let transfer = find(&state.db, &code).await?;
    let owner = bearer(&headers).is_some_and(|token| token_matches(token, &transfer));
    // Someone adding to a collection gets a token of their own — or keeps the one they hold,
    // coming back to add more — so the uploads they can finish or cancel are only theirs.
    let contributor = match (owner, transfer.collect) {
        (true, _) => None,
        (false, true) => Some(bearer(&headers).map_or_else(|| hex(&rand::random::<[u8; 32]>()), str::to_owned)),
        (false, false) => return Err(AppError::UNAUTHORIZED),
    };
    if let Some(folder) = contributor.as_ref().and(req.from.as_deref()).and_then(contributor_folder) {
        for file in &mut req.files {
            file.path = format!("{folder}/{}", file.path);
        }
    }
    if transfer.hosted {
        return Err(AppError(StatusCode::FORBIDDEN, "this transfer is served from the sender's device"));
    }
    if req.files.is_empty() {
        return Err(AppError::bad_request("invalid file count"));
    }
    let total = checked_total(&req.files)?;
    ensure_room(&state, total).await?;

    let mut tx = state.db.begin().await?;
    // Taking the indices first also locks the transfer's row, so a second addition waits here
    // and then sees this one's paths, rather than both picking the same names. A removed
    // file's index is never handed out again.
    let first: i32 = sqlx::query_scalar("UPDATE transfers SET next_idx = next_idx + $2 WHERE id = $1 RETURNING next_idx - $2")
        .bind(transfer.id)
        .bind(req.files.len() as i32)
        .fetch_one(&mut *tx)
        .await?;
    let existing: Vec<String> = sqlx::query_scalar("SELECT path FROM files WHERE transfer_id = $1")
        .bind(transfer.id)
        .fetch_all(&mut *tx)
        .await?;
    if existing.len() + req.files.len() > MAX_FILES {
        return Err(AppError::bad_request("invalid file count"));
    }

    let mut taken: HashSet<String> = existing.into_iter().collect();
    let mut files = req.files;
    for file in &mut files {
        file.path = unique_path(&file.path, &taken);
        taken.insert(file.path.clone());
    }
    let added = files
        .iter()
        .enumerate()
        .map(|(offset, file)| AddedFile { idx: first + offset as i32, path: file.path.clone() })
        .collect();
    let token_hash = contributor.as_ref().map(|token| blake3::hash(token.as_bytes()));
    insert_files(&mut tx, transfer.id, first, files, token_hash.as_ref().map(|hash| hash.as_bytes().as_slice())).await?;
    tx.commit().await?;
    Ok(Json(Added { files: added, token: contributor }))
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
    title: String,
    collect: bool,
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
        title: transfer.title,
        collect: transfer.collect,
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

const SUMMARY_SQL: &str = "SELECT t.code, t.title, t.created_at, t.expires_at, t.hosted, t.collect,
        count(f.idx) AS files,
        coalesce(sum(f.size), 0)::bigint AS size,
        -- Nothing is pending for a hosted transfer: its bytes were never coming here.
        t.hosted OR count(f.idx) = count(f.hash) AS complete
     FROM transfers t LEFT JOIN files f ON f.transfer_id = t.id";

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    code: String,
    title: String,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    hosted: bool,
    collect: bool,
    files: i64,
    size: i64,
    complete: bool,
}

/// Wraps text as a LIKE pattern with its own wildcards demoted to ordinary characters.
fn like_pattern(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('%');
    for c in text.chars() {
        if c == '%' || c == '_' || c == LIKE_ESCAPE {
            out.push(LIKE_ESCAPE);
        }
        out.push(c);
    }
    out.push('%');
    out
}

#[derive(Deserialize)]
pub struct PublicQuery {
    /// Matches the transfer's title, which is the dropped folder or the first file's name.
    q: Option<String>,
    limit: Option<i64>,
}

/// Public transfers, newest first, narrowed by `q` and capped at `limit`.
pub async fn list_public(
    State(state): State<Shared>,
    Query(query): Query<PublicQuery>,
) -> Result<Json<Vec<Summary>>> {
    let limit = query.limit.unwrap_or(PUBLIC_LIST_LIMIT).clamp(1, PUBLIC_LIST_MAX);
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(like_pattern);
    let sql = format!(
        "{SUMMARY_SQL} WHERE t.public AND t.expires_at > now()
           AND ($2::text IS NULL OR t.title ILIKE $2 ESCAPE '{LIKE_ESCAPE}')
         GROUP BY t.id ORDER BY t.created_at DESC LIMIT $1"
    );
    let transfers = sqlx::query_as(&sql).bind(limit).bind(search).fetch_all(&state.db).await?;
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
    authorize_file(&state.db, &headers, &transfer, idx).await?;
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
    fn a_collection_is_called_what_its_owner_says_or_something_plain() {
        assert_eq!(collection_title(Some("  Holiday photos ")), "Holiday photos");
        assert_eq!(collection_title(None), COLLECTION_TITLE);
        assert_eq!(collection_title(Some("\n\t ")), COLLECTION_TITLE);
        assert_eq!(collection_title(Some(&"x".repeat(200))).chars().count(), MAX_TITLE);
    }

    #[test]
    fn a_contributor_name_makes_one_folder_and_no_more() {
        assert_eq!(contributor_folder("Bob's iPhone").as_deref(), Some("Bob's iPhone"));
        assert_eq!(contributor_folder("a/b\\c").as_deref(), Some("abc"), "no nesting, no escaping upwards");
        for unusable in ["", "   ", ".", "..", "/"] {
            assert_eq!(contributor_folder(unusable), None, "{unusable:?}");
        }
    }

    #[test]
    fn only_the_owners_token_authorizes() {
        let token = "owner-token";
        let transfer = Transfer {
            id: Uuid::nil(),
            code: "abcdefgh".into(),
            token_hash: blake3::hash(token.as_bytes()).as_bytes().to_vec(),
            created_at: Utc::now(),
            expires_at: Utc::now(),
            hosted: false,
            collect: true,
            title: String::new(),
        };
        let with = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(header::AUTHORIZATION, value.parse().unwrap());
            headers
        };
        assert!(authorize(&with("Bearer owner-token"), &transfer).is_ok());
        assert!(authorize(&with("Bearer someone-else"), &transfer).is_err());
        assert!(authorize(&with("owner-token"), &transfer).is_err(), "only as a bearer token");
        assert!(authorize(&HeaderMap::new(), &transfer).is_err());
    }

    fn file(path: &str, size: i64) -> NewFile {
        NewFile { path: path.into(), size, mime: String::new(), modified: None }
    }

    #[test]
    fn renames_a_path_already_taken() {
        let taken: HashSet<String> = ["photo.jpg", "photo (1).jpg", "trip/.env", "notes"].map(String::from).into();
        assert_eq!(unique_path("new.jpg", &taken), "new.jpg", "a free name is kept");
        assert_eq!(unique_path("photo.jpg", &taken), "photo (2).jpg", "past every name in use");
        assert_eq!(unique_path("trip/.env", &taken), "trip/.env (1)", "a hidden file has no extension");
        assert_eq!(unique_path("notes", &taken), "notes (1)");
    }

    #[test]
    fn refuses_a_batch_the_server_couldnt_store() {
        assert_eq!(checked_total(&[file("a", 10), file("b/c", 5)]).ok(), Some(15));
        for bad in [vec![file("a", -1)], vec![file("../a", 1)], vec![file("a", 1), file("a", 2)]] {
            assert!(checked_total(&bad).is_err());
        }
    }

    #[test]
    fn searches_for_wildcards_as_ordinary_characters() {
        assert_eq!(like_pattern("holiday"), "%holiday%");
        // Otherwise a title of "100%" would be unsearchable and "_" would match anything.
        assert_eq!(like_pattern("100%"), "%100!%%");
        assert_eq!(like_pattern("a_b"), "%a!_b%");
        assert_eq!(like_pattern("!"), "%!!%", "the escape character escapes itself");
    }

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

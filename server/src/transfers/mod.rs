mod auth;
mod create;
mod files;
mod info;
mod listing;
mod manage;
mod note;
mod space;
mod titles;

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    Shared,
    error::{AppError, Result},
};

pub use auth::{authorize_file, token_matches};
pub use create::create;
pub use files::{add_files, delete_file};
pub use info::get;
pub use listing::{list_public, summary};
pub use manage::{count_download, delete, update};
pub use note::save_note;

/// 5, 15 and 30 minutes, 1 and 6 hours, 1, 3 and 7 days.
const EXPIRY_CHOICES: [i64; 8] = [300, 900, 1800, 3600, 21_600, 86_400, 259_200, 604_800];
/// How long an unfinished upload is kept after it was last added to, whatever its lifetime.
const UPLOAD_GRACE: i32 = 86_400;
const MAX_FILES: usize = 100_000;
/// A text transfer is a message, not a document: generous for that, and small enough to send
/// whole on every save.
const MAX_NOTE_BYTES: usize = 1 << 20;

#[derive(sqlx::FromRow)]
pub struct Transfer {
    pub id: Uuid,
    pub code: String,
    pub token_hash: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// Served from the sender's device; the server never holds the bytes.
    pub hosted: bool,
    /// Listed for everyone who opens Flux.
    pub public: bool,
    /// A public share its owner opened to files from anyone who opens it.
    pub open: bool,
    pub title: String,
    pub downloads: i32,
    /// The text of a text transfer, which has no files.
    pub note: Option<String>,
    /// Whether anyone with the code may edit the text, not only its owner.
    pub editable: bool,
    pub note_version: i32,
    /// Seconds an uploaded transfer lasts once its upload completes; None when it counts from creation.
    pub lifetime: Option<i32>,
}

pub fn normalize_code(raw: &str) -> String {
    raw.chars().filter(|c| *c != '-').flat_map(char::to_lowercase).collect()
}

pub async fn find(db: &sqlx::PgPool, code: &str) -> Result<Transfer> {
    sqlx::query_as(
        "SELECT id, code, token_hash, created_at, expires_at, hosted, public, open, title, downloads, note, editable, note_version, lifetime FROM transfers
         WHERE code = $1 AND expires_at > now()",
    )
    .bind(normalize_code(code))
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NOT_FOUND)
}

/// Keeps an unfinished upload from expiring while it is still being added to. Only writes once the
/// expiry has fallen a minute behind, so a stream of chunks costs an update now and then.
pub async fn keep_uploading(db: &sqlx::PgPool, id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE transfers SET expires_at = now() + make_interval(secs => GREATEST(lifetime, $2))
         WHERE id = $1 AND lifetime IS NOT NULL
           AND expires_at < now() + make_interval(secs => GREATEST(lifetime, $2) - 60)",
    )
    .bind(id)
    .bind(UPLOAD_GRACE)
    .execute(db)
    .await?;
    Ok(())
}

/// Starts an uploaded transfer's lifetime once the last of its owner's files has arrived. It starts
/// once: what others add to an open share later never keeps the share going longer.
pub async fn start_lifetime(db: &sqlx::PgPool, id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE transfers SET expires_at = now() + make_interval(secs => lifetime), lifetime = NULL
         WHERE id = $1 AND lifetime IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM files WHERE transfer_id = $1 AND hash IS NULL AND upload_token_hash IS NULL
           )",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

/// A file's path within its transfer and its hash, once it has been uploaded in full.
pub async fn complete_file(db: &sqlx::PgPool, transfer: Uuid, idx: i32) -> Result<(String, Vec<u8>)> {
    sqlx::query_as("SELECT path, hash FROM files WHERE transfer_id = $1 AND idx = $2 AND hash IS NOT NULL")
        .bind(transfer)
        .bind(idx)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NOT_FOUND)
}

/// A file's extension, lowercased; empty when it has none.
pub fn extension(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn file_path(state: &Shared, transfer: Uuid, idx: i32) -> PathBuf {
    state.data_dir.join(transfer.to_string()).join(idx.to_string())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

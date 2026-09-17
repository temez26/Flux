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
    /// Open to files from anyone with the code, not only from its owner.
    pub collect: bool,
    pub title: String,
    pub downloads: i32,
    /// A collection no longer taking files.
    pub closed: bool,
    /// The text of a text transfer, which has no files.
    pub note: Option<String>,
    /// Whether anyone with the code may edit the text, not only its owner.
    pub editable: bool,
    pub note_version: i32,
}

pub fn normalize_code(raw: &str) -> String {
    raw.chars().filter(|c| *c != '-').flat_map(char::to_lowercase).collect()
}

pub async fn find(db: &sqlx::PgPool, code: &str) -> Result<Transfer> {
    sqlx::query_as(
        "SELECT id, code, token_hash, created_at, expires_at, hosted, public, collect, title, downloads, closed, note, editable, note_version FROM transfers
         WHERE code = $1 AND expires_at > now()",
    )
    .bind(normalize_code(code))
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NOT_FOUND)
}

pub fn file_path(state: &Shared, transfer: Uuid, idx: i32) -> PathBuf {
    state.data_dir.join(transfer.to_string()).join(idx.to_string())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    EXPIRY_CHOICES, MAX_FILES, MAX_NOTE_BYTES, UPLOAD_GRACE,
    files::{NewFile, checked_total, insert_files},
    hex,
    space::ensure_room,
    titles::{note_title, title},
};
use crate::{
    Shared,
    error::{AppError, Result},
};

/// Unambiguous characters only (no 0/o, 1/i/l) so codes can be read aloud and typed on a phone.
const CODE_ALPHABET: &[u8] = b"23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LEN: usize = 8;

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
    /// A text transfer: this text, and no files.
    #[serde(default)]
    note: Option<String>,
    /// For a text transfer, whether anyone with the code may edit it.
    #[serde(default)]
    editable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    code: String,
    token: String,
    expires_at: DateTime<Utc>,
}

fn random_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LEN)
        .map(|_| CODE_ALPHABET[rng.random_range(0..CODE_ALPHABET.len())] as char)
        .collect()
}

pub async fn create(State(state): State<Shared>, Json(req): Json<NewTransfer>) -> Result<Json<Created>> {
    let counted = match &req.note {
        // Text lives with the transfer on the server, so there is nothing to upload or serve.
        Some(_) => req.files.is_empty() && !req.hosted,
        None => !req.files.is_empty() && req.files.len() <= MAX_FILES,
    };
    if !counted {
        return Err(AppError::bad_request("invalid file count"));
    }
    if req.note.as_ref().is_some_and(|note| note.len() > MAX_NOTE_BYTES) {
        return Err(AppError::bad_request("text is too long"));
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
    // Files uploaded here last their lifetime from when the upload completes; until then the
    // transfer is kept for at least as long as an upload may pause.
    let lifetime = (!req.hosted && req.note.is_none()).then_some(req.expires_in as i32);
    let kept_for = match lifetime {
        Some(seconds) => seconds.max(UPLOAD_GRACE) as i64,
        None => req.expires_in,
    };
    let expires_at = Utc::now() + chrono::Duration::seconds(kept_for);
    let title = match &req.note {
        Some(note) => note_title(note),
        None => title(&req.files),
    };

    let mut tx = state.db.begin().await?;
    let mut code = None;
    for _ in 0..8 {
        let candidate = random_code();
        let inserted = sqlx::query(
            "INSERT INTO transfers (id, code, token_hash, expires_at, public, title, hosted, next_idx, note, editable, lifetime)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (code) DO NOTHING",
        )
        .bind(id)
        .bind(&candidate)
        .bind(token_hash.as_bytes().as_slice())
        .bind(expires_at)
        .bind(req.public)
        .bind(&title)
        .bind(req.hosted)
        .bind(req.files.len() as i32)
        .bind(&req.note)
        .bind(req.note.is_some() && req.editable)
        .bind(lifetime)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            code = Some(candidate);
            break;
        }
    }
    let code = code.ok_or(AppError::INTERNAL)?;
    insert_files(&mut tx, id, 0, req.files, None).await?;

    if !req.hosted && req.note.is_none() {
        tokio::fs::create_dir_all(state.data_dir.join(id.to_string())).await?;
    }
    tx.commit().await?;

    Ok(Json(Created {
        code,
        token,
        expires_at,
    }))
}

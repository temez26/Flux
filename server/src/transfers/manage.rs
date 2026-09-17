use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{EXPIRY_CHOICES, UPLOAD_GRACE, auth::authorize, find, normalize_code};
use crate::{
    Shared,
    error::{AppError, Result},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    /// Keep the transfer this long from now, whatever was chosen when it was made.
    expires_in: Option<i64>,
    /// Stop a collection taking files, or start it again.
    closed: Option<bool>,
    /// Let anyone with the code edit a text transfer, or only its owner.
    editable: Option<bool>,
    /// List the transfer for everyone who opens Flux, or stop listing it.
    public: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Updated {
    expires_at: DateTime<Utc>,
    closed: bool,
    editable: bool,
    public: bool,
    lifetime: Option<i32>,
}

/// Changes what its owner may change about a transfer after making it.
pub async fn update(
    State(state): State<Shared>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<Update>,
) -> Result<Json<Updated>> {
    let transfer = find(&state.db, &code).await?;
    authorize(&headers, &transfer)?;
    let (expires_at, lifetime) = match req.expires_in {
        Some(seconds) if !EXPIRY_CHOICES.contains(&seconds) => return Err(AppError::bad_request("invalid expiry")),
        // An upload still under way keeps the new lifetime for when it completes.
        Some(seconds) if transfer.lifetime.is_some() && uploading(&state.db, transfer.id).await? => (
            Utc::now() + chrono::Duration::seconds(seconds.max(UPLOAD_GRACE as i64)),
            Some(seconds as i32),
        ),
        Some(seconds) => (
            Utc::now() + chrono::Duration::seconds(seconds),
            transfer.lifetime.map(|_| seconds as i32),
        ),
        None => (transfer.expires_at, transfer.lifetime),
    };
    if req.closed.is_some() && !transfer.collect {
        return Err(AppError::bad_request("only a collection can be closed"));
    }
    if req.editable.is_some() && transfer.note.is_none() {
        return Err(AppError::bad_request("only text can be made editable"));
    }
    let closed = req.closed.unwrap_or(transfer.closed);
    let editable = req.editable.unwrap_or(transfer.editable);
    let public = req.public.unwrap_or(transfer.public);
    sqlx::query(
        "UPDATE transfers SET expires_at = $2, closed = $3, editable = $4, public = $5, lifetime = $6 WHERE id = $1",
    )
    .bind(transfer.id)
    .bind(expires_at)
    .bind(closed)
    .bind(editable)
    .bind(public)
    .bind(lifetime)
    .execute(&state.db)
    .await?;
    state.notes.changed(transfer.id);
    Ok(Json(Updated {
        expires_at,
        closed,
        editable,
        public,
        lifetime,
    }))
}

async fn uploading(db: &sqlx::PgPool, id: uuid::Uuid) -> Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM files WHERE transfer_id = $1 AND hash IS NULL)")
            .bind(id)
            .fetch_one(db)
            .await?,
    )
}

/// Counts one download of a transfer. Called by the page a download starts from, which is the
/// only place that knows one did: a preview requests the same files, and a direct download
/// never reaches the server at all.
pub async fn count_download(State(state): State<Shared>, Path(code): Path<String>) -> Result<StatusCode> {
    let counted = sqlx::query("UPDATE transfers SET downloads = downloads + 1 WHERE code = $1 AND expires_at > now()")
        .bind(normalize_code(&code))
        .execute(&state.db)
        .await?;
    if counted.rows_affected() == 0 {
        return Err(AppError::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete(State(state): State<Shared>, Path(code): Path<String>, headers: HeaderMap) -> Result<StatusCode> {
    let transfer = find(&state.db, &code).await?;
    authorize(&headers, &transfer)?;
    sqlx::query("DELETE FROM transfers WHERE id = $1")
        .bind(transfer.id)
        .execute(&state.db)
        .await?;
    state.notes.changed(transfer.id);
    crate::cleanup::remove_transfer_data(&state, transfer.id).await;
    Ok(StatusCode::NO_CONTENT)
}

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{EXPIRY_CHOICES, auth::authorize, find, normalize_code};
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
    let expires_at = match req.expires_in {
        Some(seconds) if EXPIRY_CHOICES.contains(&seconds) => Utc::now() + chrono::Duration::seconds(seconds),
        Some(_) => return Err(AppError::bad_request("invalid expiry")),
        None => transfer.expires_at,
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
    sqlx::query("UPDATE transfers SET expires_at = $2, closed = $3, editable = $4, public = $5 WHERE id = $1")
        .bind(transfer.id)
        .bind(expires_at)
        .bind(closed)
        .bind(editable)
        .bind(public)
        .execute(&state.db)
        .await?;
    state.notes.changed(transfer.id);
    Ok(Json(Updated {
        expires_at,
        closed,
        editable,
        public,
    }))
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

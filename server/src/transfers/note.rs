use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::{
    MAX_NOTE_BYTES,
    auth::{bearer, token_matches},
    find,
    titles::note_title,
};
use crate::{
    Shared,
    error::{AppError, Result},
};

#[derive(Deserialize)]
pub struct NoteEdit {
    text: String,
    /// The version the text was edited from.
    version: i32,
}

#[derive(Serialize)]
pub struct NoteState {
    text: String,
    version: i32,
}

/// Replaces a text transfer's text: its owner may always, anyone with the code may while the
/// owner allows it. A save names the version it was edited from, so two people editing at once
/// can't silently overwrite each other — the later save is refused with the text as it now is.
pub async fn save_note(
    State(state): State<Shared>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<NoteEdit>,
) -> Result<Response> {
    let transfer = find(&state.db, &code).await?;
    if transfer.note.is_none() {
        return Err(AppError::NOT_FOUND);
    }
    let owner = bearer(&headers).is_some_and(|token| token_matches(token, &transfer));
    if !owner && !transfer.editable {
        return Err(AppError(StatusCode::FORBIDDEN, "this text is read-only"));
    }
    if req.text.len() > MAX_NOTE_BYTES {
        return Err(AppError::bad_request("text is too long"));
    }

    let saved: Option<i32> = sqlx::query_scalar(
        "UPDATE transfers SET note = $2, title = $3, note_version = note_version + 1
         WHERE id = $1 AND note_version = $4 RETURNING note_version",
    )
    .bind(transfer.id)
    .bind(&req.text)
    .bind(note_title(&req.text))
    .bind(req.version)
    .fetch_optional(&state.db)
    .await?;
    if let Some(version) = saved {
        state.notes.changed(transfer.id);
        return Ok(Json(NoteState {
            text: req.text,
            version,
        })
        .into_response());
    }
    let (text, version): (Option<String>, i32) =
        sqlx::query_as("SELECT note, note_version FROM transfers WHERE id = $1")
            .bind(transfer.id)
            .fetch_one(&state.db)
            .await?;
    Ok((
        StatusCode::CONFLICT,
        Json(NoteState {
            text: text.unwrap_or_default(),
            version,
        }),
    )
        .into_response())
}

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    MAX_FILES,
    auth::{authorize_file, bearer, token_matches},
    file_path, find, hex,
    space::ensure_room,
    titles::contributor_folder,
};
use crate::{
    Shared,
    error::{AppError, Result},
};

const MAX_PATH_LEN: usize = 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFile {
    pub(super) path: String,
    pub(super) size: i64,
    #[serde(default, rename = "type")]
    mime: String,
    modified: Option<i64>,
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

fn valid_path(path: &str) -> bool {
    path.len() <= MAX_PATH_LEN
        && !path.contains(['\\', '\0'])
        && path.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

/// The declared size of a batch of files, once every entry is one the server can store.
pub(super) fn checked_total(files: &[NewFile]) -> Result<u64> {
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

pub(super) async fn insert_files(
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
        mimes.push(if file.mime.is_empty() {
            "application/octet-stream".to_owned()
        } else {
            file.mime
        });
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
        // Files a contributor already added may still finish uploading; only new ones are refused.
        (false, true) if transfer.closed => {
            return Err(AppError(StatusCode::FORBIDDEN, "this collection is closed"));
        }
        (false, true) => Some(bearer(&headers).map_or_else(|| hex(&rand::random::<[u8; 32]>()), str::to_owned)),
        (false, false) => return Err(AppError::UNAUTHORIZED),
    };
    if let Some(folder) = contributor
        .as_ref()
        .and(req.from.as_deref())
        .and_then(contributor_folder)
    {
        for file in &mut req.files {
            file.path = format!("{folder}/{}", file.path);
        }
    }
    if transfer.hosted {
        return Err(AppError(
            StatusCode::FORBIDDEN,
            "this transfer is served from the sender's device",
        ));
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
    let first: i32 =
        sqlx::query_scalar("UPDATE transfers SET next_idx = next_idx + $2 WHERE id = $1 RETURNING next_idx - $2")
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
        .map(|(offset, file)| AddedFile {
            idx: first + offset as i32,
            path: file.path.clone(),
        })
        .collect();
    let token_hash = contributor.as_ref().map(|token| blake3::hash(token.as_bytes()));
    insert_files(
        &mut tx,
        transfer.id,
        first,
        files,
        token_hash.as_ref().map(|hash| hash.as_bytes().as_slice()),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(Added {
        files: added,
        token: contributor,
    }))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: i64) -> NewFile {
        NewFile {
            path: path.into(),
            size,
            mime: String::new(),
            modified: None,
        }
    }

    #[test]
    fn renames_a_path_already_taken() {
        let taken: HashSet<String> = ["photo.jpg", "photo (1).jpg", "trip/.env", "notes"]
            .map(String::from)
            .into();
        assert_eq!(unique_path("new.jpg", &taken), "new.jpg", "a free name is kept");
        assert_eq!(
            unique_path("photo.jpg", &taken),
            "photo (2).jpg",
            "past every name in use"
        );
        assert_eq!(
            unique_path("trip/.env", &taken),
            "trip/.env (1)",
            "a hidden file has no extension"
        );
        assert_eq!(unique_path("notes", &taken), "notes (1)");
    }

    #[test]
    fn refuses_a_batch_the_server_couldnt_store() {
        assert_eq!(checked_total(&[file("a", 10), file("b/c", 5)]).ok(), Some(15));
        for bad in [
            vec![file("a", -1)],
            vec![file("../a", 1)],
            vec![file("a", 1), file("a", 2)],
        ] {
            assert!(checked_total(&bad).is_err());
        }
    }
}

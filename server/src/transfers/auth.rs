use axum::http::{HeaderMap, header};

use super::Transfer;
use crate::error::{AppError, Result};

pub(super) fn bearer(headers: &HeaderMap) -> Option<&str> {
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

pub(super) fn authorize(headers: &HeaderMap, transfer: &Transfer) -> Result<()> {
    match bearer(headers) {
        Some(token) if token_matches(token, transfer) => Ok(()),
        _ => Err(AppError::UNAUTHORIZED),
    }
}

/// Whether a request may write to or remove one file: its transfer's owner may, and in an open
/// share so may whoever added that file.
pub async fn authorize_file(db: &sqlx::PgPool, headers: &HeaderMap, transfer: &Transfer, idx: i32) -> Result<()> {
    let token = bearer(headers).ok_or(AppError::UNAUTHORIZED)?;
    if token_matches(token, transfer) {
        return Ok(());
    }
    if transfer.open {
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

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use super::*;

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
            public: false,
            open: true,
            title: String::new(),
            downloads: 0,
            note: None,
            editable: false,
            note_version: 0,
            lifetime: None,
        };
        let with = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(header::AUTHORIZATION, value.parse().unwrap());
            headers
        };
        assert!(authorize(&with("Bearer owner-token"), &transfer).is_ok());
        assert!(authorize(&with("Bearer someone-else"), &transfer).is_err());
        assert!(
            authorize(&with("owner-token"), &transfer).is_err(),
            "only as a bearer token"
        );
        assert!(authorize(&HeaderMap::new(), &transfer).is_err());
    }
}

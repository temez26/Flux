use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::normalize_code;
use crate::{
    Shared,
    error::{AppError, Result},
};

const PUBLIC_LIST_LIMIT: i64 = 100;
/// Ceiling on one request, so a wide listing can be paged through but never asked for whole.
const PUBLIC_LIST_MAX: i64 = 500;
/// Stands in for a LIKE wildcard, so a title containing % or _ searches for those characters.
const LIKE_ESCAPE: char = '!';

const SUMMARY_SQL: &str =
    "SELECT t.code, t.title, t.created_at, t.expires_at, t.lifetime, t.hosted, t.open, t.downloads,
        t.note IS NOT NULL AS note,
        count(f.idx) AS files,
        CASE WHEN t.note IS NULL THEN coalesce(sum(f.size), 0) ELSE octet_length(t.note) END::bigint AS size,
        -- Nothing is pending for a hosted transfer: its bytes were never coming here. What others
        -- are still adding to an open share doesn't make the owner's share incomplete.
        t.hosted OR count(f.idx) FILTER (WHERE f.upload_token_hash IS NULL)
          = count(f.hash) FILTER (WHERE f.upload_token_hash IS NULL) AS complete,
        CASE WHEN t.note IS NULL AND NOT t.hosted AND count(f.idx) = 1
          THEN min(f.idx) FILTER (WHERE f.hash IS NOT NULL) END AS thumb
     FROM transfers t LEFT JOIN files f ON f.transfer_id = t.id";

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    code: String,
    title: String,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    lifetime: Option<i32>,
    hosted: bool,
    open: bool,
    downloads: i32,
    /// A text transfer rather than files.
    note: bool,
    files: i64,
    size: i64,
    complete: bool,
    /// The only file, once it is here in full: a listing can show its thumbnail.
    thumb: Option<i32>,
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

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Files,
    Text,
}

#[derive(Deserialize)]
pub struct PublicQuery {
    /// Matches the transfer's title, which is the dropped folder or the first file's name.
    q: Option<String>,
    limit: Option<i64>,
    /// Only files or only text; both when absent.
    kind: Option<Kind>,
}

/// Public transfers, newest first, narrowed by `q` and `kind` and capped at `limit`.
pub async fn list_public(State(state): State<Shared>, Query(query): Query<PublicQuery>) -> Result<Json<Vec<Summary>>> {
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
           AND ($3::bool IS NULL OR (t.note IS NOT NULL) = $3)
         GROUP BY t.id ORDER BY t.created_at DESC LIMIT $1"
    );
    let transfers = sqlx::query_as(&sql)
        .bind(limit)
        .bind(search)
        .bind(query.kind.map(|kind| matches!(kind, Kind::Text)))
        .fetch_all(&state.db)
        .await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_for_wildcards_as_ordinary_characters() {
        assert_eq!(like_pattern("holiday"), "%holiday%");
        // Otherwise a title of "100%" would be unsearchable and "_" would match anything.
        assert_eq!(like_pattern("100%"), "%100!%%");
        assert_eq!(like_pattern("a_b"), "%a!_b%");
        assert_eq!(like_pattern("!"), "%!!%", "the escape character escapes itself");
    }
}

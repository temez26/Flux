use axum::http::StatusCode;
use uuid::Uuid;

use crate::{
    Shared,
    error::{AppError, Result},
};

pub(super) async fn ensure_room(state: &Shared, total: u64) -> Result<()> {
    let Some(free) = available_space(&state.data_dir) else {
        return Ok(());
    };
    // Free space already accounts for every byte written so far, but not for the ones
    // transfers accepted earlier are still expecting. Without holding those back, two large
    // transfers created moments apart both pass and then fight over the same room.
    let promised = outstanding(state).await?;
    if total > free.saturating_sub(promised) {
        return Err(AppError(
            StatusCode::INSUFFICIENT_STORAGE,
            "not enough free space on server",
        ));
    }
    Ok(())
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
    fn counts_uploads_and_ignores_the_thumbnail_cache() {
        let dir = std::env::temp_dir().join(format!("flux-stored-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("thumbs")).unwrap();
        std::fs::write(dir.join("0"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.join("1"), vec![0u8; 24]).unwrap();
        // Named for a file it belongs to, but not one of the uploads themselves.
        std::fs::write(dir.join("thumbs").join("0.jpg"), vec![0u8; 5000]).unwrap();
        std::fs::write(dir.join(".0.12345"), vec![0u8; 7000]).unwrap();

        assert_eq!(stored_bytes(&dir), 1024);
        assert_eq!(
            stored_bytes(&dir.join("missing")),
            0,
            "an absent directory holds nothing"
        );
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

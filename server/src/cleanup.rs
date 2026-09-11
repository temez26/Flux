use std::{collections::HashSet, time::Duration};

use uuid::Uuid;

use crate::Shared;

const INTERVAL: Duration = Duration::from_secs(60);

pub fn spawn(state: Shared) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(INTERVAL);
        loop {
            tick.tick().await;
            if let Err(err) = remove_expired(&state).await {
                tracing::warn!("cleanup failed: {err}");
            }
        }
    });
}

async fn remove_expired(state: &Shared) -> Result<(), sqlx::Error> {
    let expired: Vec<Uuid> =
        sqlx::query_scalar("DELETE FROM transfers WHERE expires_at <= now() RETURNING id")
            .fetch_all(&state.db)
            .await?;
    for id in &expired {
        remove_transfer_data(state, *id).await;
    }
    if !expired.is_empty() {
        tracing::info!("removed {} expired transfer(s)", expired.len());
    }
    Ok(())
}

pub async fn remove_transfer_data(state: &Shared, id: Uuid) {
    state.uploads.remove_transfer(id);
    let dir = state.data_dir.join(id.to_string());
    if let Err(err) = tokio::fs::remove_dir_all(&dir).await
        && err.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!("failed to remove {}: {err}", dir.display());
    }
}

/// Deletes data directories left behind by transfers that no longer exist, e.g. after a crash.
pub async fn remove_orphans(state: &Shared) -> Result<(), Box<dyn std::error::Error>> {
    let known: HashSet<Uuid> = sqlx::query_scalar("SELECT id FROM transfers")
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .collect();
    let mut entries = tokio::fs::read_dir(&state.data_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let orphan = entry.file_name().to_str().and_then(|n| Uuid::parse_str(n).ok());
        if let Some(id) = orphan.filter(|id| !known.contains(id)) {
            remove_transfer_data(state, id).await;
        }
    }
    Ok(())
}

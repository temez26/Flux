//! Small previews for file listings. A grid of tiles would otherwise pull every full-size
//! image, so each one is decoded once, shrunk, and cached beside the file it came from.

use std::{
    io::Cursor,
    path::{Path as FsPath, PathBuf},
    sync::LazyLock,
};

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use image::{ImageFormat, ImageReader, codecs::jpeg::JpegEncoder};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    Shared,
    download::{Part, respond},
    error::{AppError, Result},
    transfers::{self, hex},
};

/// Longest edge of a generated thumbnail. Twice the widest tile a listing draws, so the
/// grid stays sharp on a phone's 2× screen without storing anything close to the original.
const MAX_EDGE: u32 = 320;
const JPEG_QUALITY: u8 = 78;
/// Refuses images whose decoded pixels wouldn't fit comfortably in memory, whatever the
/// compressed file's size suggests.
const MAX_DECODED_BYTES: u64 = 512 << 20;

/// Extensions `image` can decode with the codecs this build enables. HEIC and AVIF are
/// absent on purpose: decoding them needs a C library, and the client falls back to its own
/// icon (or, on Safari, the file itself) when a thumbnail isn't offered.
const DECODABLE: [&str; 9] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"];

// Decoding is CPU-bound and a listing asks for many tiles at once, so downloads and uploads
// must not be left waiting behind a burst of them.
static DECODERS: LazyLock<Semaphore> = LazyLock::new(|| {
    let permits = std::thread::available_parallelism().map_or(2, |n| n.get().div_ceil(2)).max(1);
    Semaphore::new(permits)
});

fn extension(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn cache_dir(state: &Shared, transfer: Uuid) -> PathBuf {
    state.data_dir.join(transfer.to_string()).join("thumbs")
}

/// Cache names carry the encoded format, so a hit needs no decoding to know its type.
fn cached(dir: &FsPath, idx: i32) -> [(PathBuf, &'static str); 2] {
    [
        (dir.join(format!("{idx}.jpg")), "image/jpeg"),
        (dir.join(format!("{idx}.png")), "image/png"),
    ]
}

/// Shrinks `source` to fit `MAX_EDGE`, keeping alpha by falling back to PNG when there is any.
fn encode(source: &FsPath) -> Result<(Vec<u8>, &'static str)> {
    let mut reader = ImageReader::open(source)
        .map_err(|_| AppError::NOT_FOUND)?
        .with_guessed_format()
        .map_err(|_| AppError::NOT_FOUND)?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    reader.limits(limits);

    let image = reader.decode().map_err(|_| AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "can't read this image"))?;
    // `thumbnail` halves repeatedly before its final filter, which is what makes shrinking a
    // very large photo cheap; the quality difference at this size isn't visible.
    let small = image.thumbnail(MAX_EDGE, MAX_EDGE);

    let mut out = Vec::new();
    if small.color().has_alpha() {
        small
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .map_err(|_| AppError::INTERNAL)?;
        Ok((out, "image/png"))
    } else {
        small
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY))
            .map_err(|_| AppError::INTERNAL)?;
        Ok((out, "image/jpeg"))
    }
}

/// Publishes the thumbnail under its final name only once it is complete, so a reader can
/// never pick up a half-written file.
async fn store(dir: PathBuf, idx: i32, bytes: &[u8], mime: &str) -> std::io::Result<()> {
    tokio::fs::create_dir_all(&dir).await?;
    let name = if mime == "image/png" { format!("{idx}.png") } else { format!("{idx}.jpg") };
    let temp = dir.join(format!(".{idx}.{}", std::process::id()));
    tokio::fs::write(&temp, bytes).await?;
    tokio::fs::rename(&temp, dir.join(name)).await
}

/// Drops the cached thumbnail for one file, e.g. when the file itself is deleted.
pub async fn remove(state: &Shared, transfer: Uuid, idx: i32) {
    for (path, _) in cached(&cache_dir(state, transfer), idx) {
        let _ = tokio::fs::remove_file(path).await;
    }
}

pub async fn thumb(
    State(state): State<Shared>,
    Path((code, idx)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    let (path, hash): (String, Vec<u8>) = sqlx::query_as(
        "SELECT path, hash FROM files WHERE transfer_id = $1 AND idx = $2 AND hash IS NOT NULL",
    )
    .bind(transfer.id)
    .bind(idx)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NOT_FOUND)?;

    if !DECODABLE.contains(&extension(&path).as_str()) {
        return Err(AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "no thumbnail for this file type"));
    }

    let etag = format!("\"t{}\"", hex(&hash));
    let name = format!("{idx}.thumb");
    let dir = cache_dir(&state, transfer.id);

    for (cache, mime) in cached(&dir, idx) {
        if let Ok(meta) = tokio::fs::metadata(&cache).await {
            let part = Part::File { path: cache, len: meta.len() };
            // Safe to show inline: these bytes were encoded here, not uploaded.
            return Ok(respond(&headers, vec![part], etag, mime, &name, true));
        }
    }

    let source = transfers::file_path(&state, transfer.id, idx);
    let _permit = DECODERS.acquire().await.map_err(|_| AppError::INTERNAL)?;
    let (bytes, mime) = tokio::task::spawn_blocking(move || encode(&source))
        .await
        .map_err(|_| AppError::INTERNAL)??;

    if let Err(err) = store(dir, idx, &bytes, mime).await {
        // A thumbnail that can't be cached is still worth serving; the next request redoes it.
        tracing::warn!("failed to cache thumbnail: {err}");
    }
    Ok(respond(&headers, vec![Part::Bytes(bytes.into())], etag, mime, &name, true))
}

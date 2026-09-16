//! Server-rendered views of an uploaded image, cached beside the file they came from: a
//! tile for a listing, and a larger one for the viewer to fall back on when the browser
//! can't decode the original itself.

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
use image::{DynamicImage, ImageFormat, ImageReader, RgbImage, codecs::jpeg::JpegEncoder};
use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    Shared,
    download::{Part, respond},
    error::{AppError, Result},
    transfers::{self, hex},
};

/// Longest edge of a listing tile. Twice the widest tile a listing draws, so the grid stays
/// sharp on a phone's 2× screen without storing anything close to the original.
const TILE_EDGE: u32 = 320;
/// Longest edge of the viewer's copy: enough for a full-screen look on a dense display,
/// while staying far cheaper to send than a modern phone's original.
const FULL_EDGE: u32 = 1600;
const JPEG_QUALITY: u8 = 78;
/// Refuses images whose decoded pixels wouldn't fit comfortably in memory, whatever the
/// compressed file's size suggests.
const MAX_DECODED_BYTES: u64 = 512 << 20;

/// Extensions the `image` crate decodes with the codecs this build enables.
const DECODABLE: [&str; 9] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"];
/// What libheif decodes. Every iPhone shoots HEIC by default and only Safari can show one,
/// so without this the most common photo on the network has no preview anywhere else.
const HEIF: [&str; 4] = ["heic", "heif", "hif", "avif"];

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
fn cached(dir: &FsPath, idx: i32, size: Size) -> [(PathBuf, &'static str); 2] {
    let stem = size.stem(idx);
    [
        (dir.join(format!("{stem}.jpg")), "image/jpeg"),
        (dir.join(format!("{stem}.png")), "image/png"),
    ]
}

/// Which rendering of an image is wanted. Both are cached, under names of their own.
#[derive(Clone, Copy, PartialEq)]
enum Size {
    Tile,
    Full,
}

impl Size {
    fn stem(self, idx: i32) -> String {
        match self {
            Size::Tile => idx.to_string(),
            Size::Full => format!("{idx}.full"),
        }
    }

    fn edge(self) -> u32 {
        match self {
            Size::Tile => TILE_EDGE,
            Size::Full => FULL_EDGE,
        }
    }
}

const UNREADABLE: AppError = AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "can't read this image");

/// HEIF and its relatives, which the `image` crate has no codec for.
fn decode_heif(source: &FsPath) -> Result<DynamicImage> {
    let ctx = HeifContext::read_from_file(&source.to_string_lossy()).map_err(|_| UNREADABLE)?;
    let handle = ctx.primary_image_handle().map_err(|_| UNREADABLE)?;
    let (width, height) = (handle.width(), handle.height());
    // libheif has no allocation limit of its own, so refuse the same sizes `image` would.
    if u64::from(width) * u64::from(height) * 3 > MAX_DECODED_BYTES {
        return Err(UNREADABLE);
    }

    let decoded = LibHeif::new()
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|_| UNREADABLE)?;
    let planes = decoded.planes();
    let plane = planes.interleaved.ok_or(UNREADABLE)?;

    // Rows are padded to the decoder's stride, which `RgbImage` knows nothing about.
    let row = width as usize * 3;
    let mut pixels = Vec::with_capacity(row * height as usize);
    for y in 0..height as usize {
        let start = y * plane.stride;
        pixels.extend_from_slice(plane.data.get(start..start + row).ok_or(UNREADABLE)?);
    }
    Ok(DynamicImage::ImageRgb8(RgbImage::from_raw(width, height, pixels).ok_or(UNREADABLE)?))
}

fn decode_image(source: &FsPath) -> Result<DynamicImage> {
    let mut reader = ImageReader::open(source)
        .map_err(|_| AppError::NOT_FOUND)?
        .with_guessed_format()
        .map_err(|_| AppError::NOT_FOUND)?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    reader.limits(limits);
    reader.decode().map_err(|_| UNREADABLE)
}

/// Shrinks `source` to fit `size`, keeping alpha by falling back to PNG when there is any.
fn encode(source: &FsPath, size: Size, heif: bool) -> Result<(Vec<u8>, &'static str)> {
    let image = if heif { decode_heif(source)? } else { decode_image(source)? };
    let edge = size.edge();
    // `thumbnail` fits the image to the box in both directions, so an image already smaller
    // than the box comes back enlarged — bigger to send and blurrier to look at than the
    // original. `thumbnail` halves repeatedly before its final filter, which is what makes
    // shrinking a very large photo cheap; the quality difference at this size isn't visible.
    let small = if image.width() > edge || image.height() > edge {
        image.thumbnail(edge, edge)
    } else {
        image
    };

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
async fn store(dir: PathBuf, idx: i32, size: Size, bytes: &[u8], mime: &str) -> std::io::Result<()> {
    tokio::fs::create_dir_all(&dir).await?;
    let stem = size.stem(idx);
    let name = if mime == "image/png" { format!("{stem}.png") } else { format!("{stem}.jpg") };
    let temp = dir.join(format!(".{stem}.{}", std::process::id()));
    tokio::fs::write(&temp, bytes).await?;
    tokio::fs::rename(&temp, dir.join(name)).await
}

/// Drops every cached rendering of one file, e.g. when the file itself is deleted.
pub async fn remove(state: &Shared, transfer: Uuid, idx: i32) {
    let dir = cache_dir(state, transfer);
    for size in [Size::Tile, Size::Full] {
        for (path, _) in cached(&dir, idx, size) {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
}

#[derive(serde::Deserialize)]
pub struct ThumbQuery {
    /// Ask for the viewer's copy rather than a listing tile.
    full: Option<String>,
}

pub async fn thumb(
    State(state): State<Shared>,
    Path((code, idx)): Path<(String, i32)>,
    axum::extract::Query(query): axum::extract::Query<ThumbQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    let size = if query.full.is_some() { Size::Full } else { Size::Tile };
    let transfer = transfers::find(&state.db, &code).await?;
    let (path, hash): (String, Vec<u8>) = sqlx::query_as(
        "SELECT path, hash FROM files WHERE transfer_id = $1 AND idx = $2 AND hash IS NOT NULL",
    )
    .bind(transfer.id)
    .bind(idx)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NOT_FOUND)?;

    let ext = extension(&path);
    let heif = HEIF.contains(&ext.as_str());
    if !heif && !DECODABLE.contains(&ext.as_str()) {
        return Err(AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "no preview for this file type"));
    }

    let etag = format!("\"t{}{}\"", if size == Size::Full { "f" } else { "" }, hex(&hash));
    let name = size.stem(idx);
    let dir = cache_dir(&state, transfer.id);

    for (cache, mime) in cached(&dir, idx, size) {
        if let Ok(meta) = tokio::fs::metadata(&cache).await {
            let part = Part::File { path: cache, len: meta.len() };
            // Safe to show inline: these bytes were encoded here, not uploaded.
            return Ok(respond(&headers, vec![part], etag, mime, &name, true));
        }
    }

    let source = transfers::file_path(&state, transfer.id, idx);
    let _permit = DECODERS.acquire().await.map_err(|_| AppError::INTERNAL)?;
    let (bytes, mime) = tokio::task::spawn_blocking(move || encode(&source, size, heif))
        .await
        .map_err(|_| AppError::INTERNAL)??;

    if let Err(err) = store(dir, idx, size, &bytes, mime).await {
        // One that can't be cached is still worth serving; the next request redoes it.
        tracing::warn!("failed to cache preview: {err}");
    }
    Ok(respond(&headers, vec![Part::Bytes(bytes.into())], etag, mime, &name, true))
}


#[cfg(test)]
mod tests {
    use super::*;

    /// A 64x48 HEIC, red at the top and blue at the bottom. iPhones shoot this format by
    /// default and the `image` crate has no codec for it, which is the whole reason libheif
    /// is linked in.
    const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/sample.heic");

    #[test]
    fn the_image_crate_cannot_read_a_heic() {
        assert!(decode_image(FsPath::new(SAMPLE)).is_err());
    }

    #[test]
    fn libheif_reads_a_heic_right_way_up() {
        let image = decode_heif(FsPath::new(SAMPLE)).expect("libheif decodes it");
        assert_eq!((image.width(), image.height()), (64, 48));

        // Rows arrive padded to the decoder's stride, so a row copied from the wrong offset
        // still yields an image of the right size — only the pixels give it away.
        let rgb = image.to_rgb8();
        let top = rgb.get_pixel(0, 0).0;
        let bottom = rgb.get_pixel(0, 47).0;
        assert!(top[0] > 200 && top[2] < 60, "top row is red, got {top:?}");
        assert!(bottom[2] > 200 && bottom[0] < 60, "bottom row is blue, got {bottom:?}");
    }

    #[test]
    fn never_enlarges_an_image_that_already_fits() {
        for size in [Size::Tile, Size::Full] {
            let (bytes, mime) = encode(FsPath::new(SAMPLE), size, true).expect("encodes");
            assert_eq!(mime, "image/jpeg", "no alpha, so JPEG");
            let decoded = image::load_from_memory(&bytes).expect("a readable image");
            assert_eq!((decoded.width(), decoded.height()), (64, 48), "left at its own size");
        }
    }

    #[test]
    fn shrinks_an_image_past_the_edge_it_serves() {
        let wide = DynamicImage::ImageRgb8(RgbImage::new(FULL_EDGE * 2, FULL_EDGE));
        for (size, edge) in [(Size::Tile, TILE_EDGE), (Size::Full, FULL_EDGE)] {
            let small = wide.thumbnail(size.edge(), size.edge());
            assert_eq!(small.width(), edge, "the long edge lands on the bound");
            assert_eq!(small.height(), edge / 2, "and the aspect ratio survives");
        }
    }

    #[test]
    fn names_a_cache_entry_per_size() {
        let dir = FsPath::new("/tmp");
        let tile: Vec<_> = cached(dir, 7, Size::Tile).iter().map(|(p, _)| p.clone()).collect();
        let full: Vec<_> = cached(dir, 7, Size::Full).iter().map(|(p, _)| p.clone()).collect();
        assert!(tile.iter().all(|p| !full.contains(p)), "one must not overwrite the other");
        assert!(full.iter().all(|p| p.to_string_lossy().contains("7.full")));
    }
}

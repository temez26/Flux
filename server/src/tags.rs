//! What an audio file says about itself: its tags, how it was encoded, and the cover art
//! embedded in it, which the thumbnails serve like any other image.

use std::path::Path as FsPath;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use lofty::{
    file::{AudioFile, TaggedFile, TaggedFileExt},
    picture::PictureType,
    probe::Probe,
    tag::{Accessor, ItemKey, Tag},
};

use crate::{
    Shared,
    error::{AppError, Result},
    transfers,
};

/// Extensions lofty reads, of the audio the web app previews.
const AUDIO: [&str; 8] = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus"];

const UNREADABLE: AppError = AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "can't read this audio file");

pub fn is_audio(ext: &str) -> bool {
    AUDIO.contains(&ext)
}

/// Uploads are stored without their names, so the format is told from the content.
fn read(source: &FsPath) -> Result<TaggedFile> {
    let probe = Probe::open(source).map_err(|_| AppError::NOT_FOUND)?;
    probe.guess_file_type()?.read().map_err(|_| UNREADABLE)
}

/// The tag a player would show: the format's own kind first, then whichever else it carries.
fn main_tag(file: &TaggedFile) -> Option<&Tag> {
    file.primary_tag().or_else(|| file.first_tag())
}

/// The embedded front cover, or failing that the first picture of any kind.
pub fn cover(source: &FsPath) -> Result<Vec<u8>> {
    let file = read(source)?;
    let pictures = file.tags().iter().flat_map(Tag::pictures);
    let picture = pictures
        .clone()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| pictures.clone().next())
        .ok_or(AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "no cover art"))?;
    Ok(picture.data().to_vec())
}

#[derive(serde::Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTags {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    genre: Option<String>,
    year: Option<u32>,
    track: Option<u32>,
    track_total: Option<u32>,
    disc: Option<u32>,
    disc_total: Option<u32>,
    /// Seconds.
    duration: f64,
    /// Kilobits a second.
    bitrate: Option<u32>,
    sample_rate: Option<u32>,
    bit_depth: Option<u8>,
    channels: Option<u8>,
    /// Whether the thumbnail has cover art to show.
    cover: bool,
}

/// Tag values a tagger left blank are as good as missing.
fn text(value: Option<impl AsRef<str>>) -> Option<String> {
    value.map(|v| v.as_ref().trim().to_owned()).filter(|v| !v.is_empty())
}

/// Dates are tagged anything from "1997" to "1997-03-24T00:00:00"; only the year is worth showing.
fn year(date: &str) -> Option<u32> {
    date.trim().get(..4)?.parse().ok()
}

fn describe(file: &TaggedFile) -> AudioTags {
    let props = file.properties();
    let mut tags = AudioTags {
        duration: props.duration().as_secs_f64(),
        bitrate: props.audio_bitrate().or(props.overall_bitrate()).filter(|&b| b > 0),
        sample_rate: props.sample_rate(),
        bit_depth: props.bit_depth(),
        channels: props.channels(),
        cover: file.tags().iter().any(|t| !t.pictures().is_empty()),
        ..AudioTags::default()
    };
    if let Some(tag) = main_tag(file) {
        tags.title = text(tag.title());
        tags.artist = text(tag.artist());
        tags.album = text(tag.album());
        tags.album_artist = text(tag.get_string(&ItemKey::AlbumArtist));
        tags.genre = text(tag.genre());
        tags.year = [ItemKey::RecordingDate, ItemKey::Year, ItemKey::OriginalReleaseDate]
            .into_iter()
            .find_map(|key| tag.get_string(&key).and_then(year));
        tags.track = tag.track();
        tags.track_total = tag.track_total();
        tags.disc = tag.disk();
        tags.disc_total = tag.disk_total();
    }
    tags
}

pub async fn tags(State(state): State<Shared>, Path((code, idx)): Path<(String, i32)>) -> Result<Json<AudioTags>> {
    let transfer = transfers::find(&state.db, &code).await?;
    let (path, _) = transfers::complete_file(&state.db, transfer.id, idx).await?;
    if !is_audio(&transfers::extension(&path)) {
        return Err(AppError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "not an audio file"));
    }
    let source = transfers::file_path(&state, transfer.id, idx);
    let tags = tokio::task::spawn_blocking(move || read(&source).map(|file| describe(&file)))
        .await
        .map_err(|_| AppError::INTERNAL)??;
    Ok(Json(tags))
}

/// One second of silence, tagged by ffmpeg with a 64x64 red PNG as its front cover, copied
/// under a bare name as uploads are stored, where nothing but the content tells its format.
#[cfg(test)]
pub fn stored_sample(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("flux-{}-{name}", std::process::id()));
    std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/sample.mp3"), &path).expect("copies the sample");
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_tags_a_player_shows() {
        let tags = describe(&read(&stored_sample("tags")).expect("lofty reads it"));
        assert_eq!(tags.title.as_deref(), Some("Test Song"));
        assert_eq!(tags.artist.as_deref(), Some("Test Artist"));
        assert_eq!(tags.album.as_deref(), Some("Test Album"));
        assert_eq!(tags.album_artist.as_deref(), Some("Various"));
        assert_eq!(tags.genre.as_deref(), Some("Jazz"));
        assert_eq!(tags.year, Some(1997));
        assert_eq!((tags.track, tags.track_total), (Some(3), Some(12)));
        assert_eq!((tags.sample_rate, tags.channels), (Some(44_100), Some(2)));
        assert!(
            (tags.duration - 1.0).abs() < 0.1,
            "about a second, got {}",
            tags.duration
        );
        assert!(tags.cover);
    }

    #[test]
    fn finds_the_embedded_cover() {
        let bytes = cover(&stored_sample("cover")).expect("has a cover");
        assert!(bytes.starts_with(b"\x89PNG"), "the picture as it was embedded");
    }

    #[test]
    fn reads_the_year_out_of_any_date() {
        assert_eq!(year("1997"), Some(1997));
        assert_eq!(year("1997-03-24"), Some(1997));
        assert_eq!(year(" 2001-01-01T00:00:00 "), Some(2001));
        assert_eq!(year("97"), None);
        assert_eq!(year("unknown"), None);
    }

    #[test]
    fn treats_blank_values_as_missing() {
        assert_eq!(text(Some("  ")), None);
        assert_eq!(text(Some(" Song ")), Some("Song".to_owned()));
        assert_eq!(text(None::<&str>), None);
    }
}

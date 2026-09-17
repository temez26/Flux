//! Uncompressed ZIP (with ZIP64 where needed) laid out entirely from stored metadata.
//! Because every size and CRC is known up front, the archive has an exact length and any
//! byte range can be served without reading preceding files.

use std::path::PathBuf;

use bytes::{BufMut, BytesMut};
use chrono::{DateTime, Datelike, Timelike, Utc};

use crate::download::Part;

const FLAG_UTF8: u16 = 1 << 11;
const VERSION_ZIP64: u16 = 45;
const VERSION_DEFAULT: u16 = 20;
const MADE_BY_UNIX: u16 = (3 << 8) | VERSION_ZIP64;
const UNIX_FILE_MODE: u32 = 0o100644 << 16;
const MAX32: u64 = u32::MAX as u64;

pub struct Entry {
    pub name: String,
    pub size: u64,
    pub crc: u32,
    pub modified: DateTime<Utc>,
    pub file: PathBuf,
}

fn dos_datetime(t: DateTime<Utc>) -> (u16, u16) {
    if t.year() < 1980 {
        return (0, (1 << 5) | 1);
    }
    let year = (t.year() - 1980).min(127) as u16;
    let time = (t.hour() as u16) << 11 | (t.minute() as u16) << 5 | (t.second() as u16 / 2);
    let date = year << 9 | (t.month() as u16) << 5 | t.day() as u16;
    (time, date)
}

pub fn build(entries: Vec<Entry>) -> Vec<Part> {
    let count = entries.len() as u64;
    let mut parts = Vec::with_capacity(entries.len() * 2 + 1);
    let mut central = BytesMut::new();
    let mut offset: u64 = 0;

    for entry in entries {
        let name = entry.name.as_bytes();
        let (time, date) = dos_datetime(entry.modified);
        let big_size = entry.size >= MAX32;
        let big_offset = offset >= MAX32;
        let size32 = if big_size { u32::MAX } else { entry.size as u32 };

        let mut local = BytesMut::with_capacity(30 + name.len() + 20);
        local.put_u32_le(0x0403_4b50);
        local.put_u16_le(if big_size { VERSION_ZIP64 } else { VERSION_DEFAULT });
        local.put_u16_le(FLAG_UTF8);
        local.put_u16_le(0); // stored
        local.put_u16_le(time);
        local.put_u16_le(date);
        local.put_u32_le(entry.crc);
        local.put_u32_le(size32);
        local.put_u32_le(size32);
        local.put_u16_le(name.len() as u16);
        local.put_u16_le(if big_size { 20 } else { 0 });
        local.put_slice(name);
        if big_size {
            local.put_u16_le(0x0001);
            local.put_u16_le(16);
            local.put_u64_le(entry.size);
            local.put_u64_le(entry.size);
        }
        let header_len = local.len() as u64;
        parts.push(Part::Bytes(local.freeze()));
        parts.push(Part::File {
            path: entry.file,
            len: entry.size,
        });

        let mut extra = BytesMut::new();
        if big_size {
            extra.put_u64_le(entry.size);
            extra.put_u64_le(entry.size);
        }
        if big_offset {
            extra.put_u64_le(offset);
        }
        central.put_u32_le(0x0201_4b50);
        central.put_u16_le(MADE_BY_UNIX);
        central.put_u16_le(if big_size || big_offset {
            VERSION_ZIP64
        } else {
            VERSION_DEFAULT
        });
        central.put_u16_le(FLAG_UTF8);
        central.put_u16_le(0);
        central.put_u16_le(time);
        central.put_u16_le(date);
        central.put_u32_le(entry.crc);
        central.put_u32_le(size32);
        central.put_u32_le(size32);
        central.put_u16_le(name.len() as u16);
        central.put_u16_le(if extra.is_empty() { 0 } else { extra.len() as u16 + 4 });
        central.put_u16_le(0); // comment
        central.put_u16_le(0); // disk
        central.put_u16_le(0); // internal attributes
        central.put_u32_le(UNIX_FILE_MODE);
        central.put_u32_le(if big_offset { u32::MAX } else { offset as u32 });
        central.put_slice(name);
        if !extra.is_empty() {
            central.put_u16_le(0x0001);
            central.put_u16_le(extra.len() as u16);
            central.put_slice(&extra);
        }

        offset += header_len + entry.size;
    }

    let central_offset = offset;
    let central_size = central.len() as u64;
    let mut end = BytesMut::with_capacity(98);
    if count >= 0xFFFF || central_offset >= MAX32 || central_size >= MAX32 {
        end.put_u32_le(0x0606_4b50);
        end.put_u64_le(44);
        end.put_u16_le(MADE_BY_UNIX);
        end.put_u16_le(VERSION_ZIP64);
        end.put_u32_le(0);
        end.put_u32_le(0);
        end.put_u64_le(count);
        end.put_u64_le(count);
        end.put_u64_le(central_size);
        end.put_u64_le(central_offset);

        end.put_u32_le(0x0706_4b50);
        end.put_u32_le(0);
        end.put_u64_le(central_offset + central_size);
        end.put_u32_le(1);
    }
    end.put_u32_le(0x0605_4b50);
    end.put_u16_le(0);
    end.put_u16_le(0);
    end.put_u16_le(count.min(0xFFFF) as u16);
    end.put_u16_le(count.min(0xFFFF) as u16);
    end.put_u32_le(central_size.min(MAX32) as u32);
    end.put_u32_le(central_offset.min(MAX32) as u32);
    end.put_u16_le(0);

    parts.push(Part::Bytes(central.freeze()));
    parts.push(Part::Bytes(end.freeze()));
    parts
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    const LOCAL_SIG: u32 = 0x0403_4b50;
    const CENTRAL_SIG: u32 = 0x0201_4b50;
    const EOCD_SIG: u32 = 0x0605_4b50;
    const ZIP64_EOCD_SIG: u32 = 0x0606_4b50;
    const ZIP64_LOCATOR_SIG: u32 = 0x0706_4b50;
    const ZIP64_EXTRA_ID: u16 = 0x0001;
    const CRC: u32 = 0x1234_5678;

    fn at(t: (i32, u32, u32, u32, u32, u32)) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(t.0, t.1, t.2, t.3, t.4, t.5).unwrap()
    }

    fn entry(name: &str, size: u64) -> Entry {
        Entry {
            name: name.to_owned(),
            size,
            crc: CRC,
            modified: at((2021, 5, 17, 9, 41, 31)),
            file: PathBuf::from("unused-in-tests"),
        }
    }

    fn u16_at(b: &[u8], i: usize) -> u16 {
        u16::from_le_bytes(b[i..i + 2].try_into().unwrap())
    }

    fn u32_at(b: &[u8], i: usize) -> u32 {
        u32::from_le_bytes(b[i..i + 4].try_into().unwrap())
    }

    fn u64_at(b: &[u8], i: usize) -> u64 {
        u64::from_le_bytes(b[i..i + 8].try_into().unwrap())
    }

    fn inline(part: &Part) -> &[u8] {
        match part {
            Part::Bytes(bytes) => bytes,
            Part::File { .. } => panic!("expected an inline part, found a file"),
        }
    }

    fn length(part: &Part) -> u64 {
        match part {
            Part::Bytes(bytes) => bytes.len() as u64,
            Part::File { len, .. } => *len,
        }
    }

    /// Byte offset of a part within the archive the whole list describes.
    fn offset_of(parts: &[Part], index: usize) -> u64 {
        parts[..index].iter().map(length).sum()
    }

    /// The payload of the ZIP64 extended-information field, if the record carries one.
    fn zip64_extra(record: &[u8]) -> Option<&[u8]> {
        let name_len = u16_at(record, 28) as usize;
        let extra = &record[46 + name_len..46 + name_len + u16_at(record, 30) as usize];
        let mut i = 0;
        while i + 4 <= extra.len() {
            let size = u16_at(extra, i + 2) as usize;
            if u16_at(extra, i) == ZIP64_EXTRA_ID {
                return Some(&extra[i + 4..i + 4 + size]);
            }
            i += 4 + size;
        }
        None
    }

    /// Start of each central directory record inside the directory part.
    fn record_offsets(central: &[u8]) -> Vec<usize> {
        let mut offsets = Vec::new();
        let mut i = 0;
        while i + 46 <= central.len() {
            assert_eq!(u32_at(central, i), CENTRAL_SIG, "record at {i}");
            offsets.push(i);
            i += 46 + u16_at(central, 28 + i) as usize + u16_at(central, 30 + i) as usize;
        }
        offsets
    }

    #[test]
    fn pairs_each_header_with_its_file_then_ends_with_the_directory() {
        let parts = build(vec![entry("one.txt", 11), entry("two.txt", 22)]);
        assert_eq!(parts.len(), 6, "two header/file pairs, a directory and an end record");

        for (i, size) in [(0, 11), (2, 22)] {
            assert_eq!(u32_at(inline(&parts[i]), 0), LOCAL_SIG);
            match &parts[i + 1] {
                Part::File { len, .. } => assert_eq!(*len, size),
                Part::Bytes(_) => panic!("expected the file to follow its header"),
            }
        }
        assert_eq!(u32_at(inline(&parts[4]), 0), CENTRAL_SIG);
        assert_eq!(u32_at(inline(&parts[5]), 0), EOCD_SIG);
    }

    #[test]
    fn states_the_sizes_and_crc_in_the_local_header() {
        // Unlike the browser's writer, everything is known before a byte is served, so
        // nothing is deferred to a trailing data descriptor.
        let parts = build(vec![entry("a/b.txt", 1234)]);
        let header = inline(&parts[0]);

        assert_eq!(u16_at(header, 4), VERSION_DEFAULT, "version needed");
        assert_eq!(u16_at(header, 6), FLAG_UTF8, "UTF-8 name, and no descriptor flag");
        assert_eq!(u16_at(header, 8), 0, "stored, not deflated");
        assert_eq!(u32_at(header, 14), CRC);
        assert_eq!(u32_at(header, 18), 1234, "compressed size");
        assert_eq!(u32_at(header, 22), 1234, "uncompressed size");
        assert_eq!(u16_at(header, 26) as usize, "a/b.txt".len());
        assert_eq!(u16_at(header, 28), 0, "no extra field below 4 GiB");
        assert_eq!(&header[30..], b"a/b.txt");
    }

    #[test]
    fn end_record_points_at_the_real_directory() {
        let parts = build(vec![entry("one", 5), entry("two", 7)]);
        let central = inline(&parts[4]);
        let end = inline(&parts[5]);

        assert_eq!(record_offsets(central).len(), 2);
        assert_eq!(u16_at(end, 8), 2, "entries on this disk");
        assert_eq!(u16_at(end, 10), 2, "entries in total");
        assert_eq!(u32_at(end, 12) as u64, central.len() as u64, "directory size");
        assert_eq!(u32_at(end, 16) as u64, offset_of(&parts, 4), "directory offset");
    }

    #[test]
    fn switches_to_zip64_exactly_at_the_32_bit_ceiling() {
        // 0xffffffff is the marker meaning "the real size is in the extra field", so a file
        // of precisely that length cannot be written as itself and goes ZIP64 as well.
        let extra_len = |size| u16_at(inline(&build(vec![entry("n", size)])[0]), 28);

        assert_eq!(extra_len(MAX32 - 1), 0, "one byte under still fits in 32 bits");
        assert_eq!(extra_len(MAX32), 20, "the ceiling itself is reserved");
        assert_eq!(extra_len(MAX32 + 1), 20, "and anything above it");
    }

    #[test]
    fn describes_an_oversized_entry_in_its_extra_field() {
        let size = MAX32 + 1;
        let parts = build(vec![entry("huge.bin", size)]);
        let header = inline(&parts[0]);

        assert_eq!(u16_at(header, 4), VERSION_ZIP64, "version needed");
        assert_eq!(u32_at(header, 18), u32::MAX, "compressed size defers");
        assert_eq!(u32_at(header, 22), u32::MAX, "uncompressed size defers");

        let extra = &header[30 + "huge.bin".len()..];
        assert_eq!(u16_at(extra, 0), ZIP64_EXTRA_ID);
        assert_eq!(u16_at(extra, 2), 16, "two 64-bit sizes");
        assert_eq!(u64_at(extra, 4), size, "compressed size");
        assert_eq!(u64_at(extra, 12), size, "uncompressed size");
    }

    #[test]
    fn puts_a_zip64_offset_on_an_entry_starting_past_4_gib() {
        let parts = build(vec![entry("filler.bin", MAX32 + 1), entry("after.txt", 3)]);
        let central = inline(&parts[4]);
        let records = record_offsets(central);
        assert_eq!(records.len(), 2);

        let filler = &central[records[0]..records[1]];
        assert_eq!(u32_at(filler, 42), 0, "the first entry starts at zero");
        assert_eq!(
            zip64_extra(filler).map(<[u8]>::len),
            Some(16),
            "but is itself oversized"
        );

        let after = &central[records[1]..];
        assert_eq!(u32_at(after, 42), u32::MAX, "the second defers its offset");
        let extra = zip64_extra(after).expect("a ZIP64 extra field");
        assert_eq!(extra.len(), 8, "one 64-bit local header offset");
        assert_eq!(
            u64_at(extra, 0),
            offset_of(&parts, 2),
            "which is where it really starts"
        );
    }

    #[test]
    fn promotes_the_end_record_past_65535_entries() {
        let count = 0xFFFF;
        let parts = build((0..count).map(|i| entry(&format!("f{i}"), 0)).collect());
        let end = inline(parts.last().unwrap());

        assert_eq!(u32_at(end, 0), ZIP64_EOCD_SIG, "the ZIP64 record comes first");
        assert_eq!(u64_at(end, 24), count as u64, "entries on this disk");
        assert_eq!(u64_at(end, 32), count as u64, "entries in total");
        assert_eq!(u32_at(end, 56), ZIP64_LOCATOR_SIG);
        assert_eq!(
            u64_at(end, 64),
            offset_of(&parts, parts.len() - 1),
            "the locator finds it"
        );
        assert_eq!(u32_at(end, 76), EOCD_SIG, "the classic record still follows");
        assert_eq!(u16_at(end, 76 + 10), 0xFFFF, "and saturates");
    }

    #[test]
    fn stores_timestamps_as_dos_date_and_time() {
        // Two-second granularity is all a DOS timestamp has.
        assert_eq!(
            dos_datetime(at((2021, 5, 17, 9, 41, 31))),
            (9 << 11 | 41 << 5 | 15, 41 << 9 | 5 << 5 | 17)
        );
    }

    #[test]
    fn clamps_timestamps_outside_the_dos_range() {
        assert_eq!(
            dos_datetime(at((1975, 6, 15, 12, 0, 0))),
            (0, (1 << 5) | 1),
            "1980-01-01 at midnight"
        );
        // The year field is seven bits, so 2107 is as far ahead as a zip can point.
        assert_eq!(dos_datetime(at((2200, 1, 2, 0, 0, 0))).1 >> 9, 127);
    }
}

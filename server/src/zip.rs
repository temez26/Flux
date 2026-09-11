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
        parts.push(Part::File { path: entry.file, len: entry.size });

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
        central.put_u16_le(if big_size || big_offset { VERSION_ZIP64 } else { VERSION_DEFAULT });
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

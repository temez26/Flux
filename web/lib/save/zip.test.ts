import assert from "node:assert/strict";
import { test } from "vitest";
import JSZip from "jszip";
import type { ByteSink } from "./save";
import { singleTarget, zipTarget, type Entry } from "./zip";

const LOCAL_SIG = 0x04034b50;
const DESCRIPTOR_SIG = 0x08074b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const MAX32 = 0xffffffff;

/**
 * Table-driven CRC-32, written out here on purpose: the app gets its checksums from
 * hash-wasm, and a test that shared an implementation with the code it checks would agree
 * with it about a wrong answer.
 */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function recorder() {
  const chunks: Uint8Array[] = [];
  let closed = false;
  let aborted = false;
  const sink: ByteSink = {
    async write(chunk) {
      chunks.push(Uint8Array.from(chunk));
    },
    async close() {
      closed = true;
    },
    abort() {
      aborted = true;
    },
  };
  return {
    sink,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    bytes: () => concat(chunks),
  };
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function concat(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/** Builds a whole archive from files held in memory, the way a direct transfer does. */
async function archive(files: { path: string; body: Uint8Array; modified?: number | null }[]) {
  const sink = recorder();
  const target = zipTarget(sink.sink);
  for (const { path, body, modified = null } of files) {
    const entry: Entry = { path, size: body.length, modified };
    const writer = await target.begin(entry);
    if (body.length) await writer.write(body);
    await writer.end(crc32(body));
  }
  await target.finish();
  return sink;
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Every central directory record in the archive, in the order they were written. */
function centralRecords(bytes: Uint8Array) {
  const v = view(bytes);
  const records: { at: number; name: string; extra: Uint8Array; length: number }[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (v.getUint32(i, true) !== CENTRAL_SIG) continue;
    const nameLen = v.getUint16(i + 28, true);
    const extraLen = v.getUint16(i + 30, true);
    records.push({
      at: i,
      name: new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLen)),
      extra: bytes.subarray(i + 46 + nameLen, i + 46 + nameLen + extraLen),
      length: 46 + nameLen + extraLen,
    });
  }
  return records;
}

/** The payload of the ZIP64 extended-information field, or undefined when there isn't one. */
function zip64Extra(extra: Uint8Array): Uint8Array | undefined {
  const v = view(extra);
  for (let i = 0; i + 4 <= extra.length;) {
    const id = v.getUint16(i, true);
    const size = v.getUint16(i + 2, true);
    if (id === ZIP64_EXTRA_ID) return extra.subarray(i + 4, i + 4 + size);
    i += 4 + size;
  }
  return undefined;
}

const indexOfSig = (bytes: Uint8Array, sig: number) => {
  const v = view(bytes);
  for (let i = 0; i + 4 <= bytes.length; i++) if (v.getUint32(i, true) === sig) return i;
  return -1;
};

test("round-trips through an independent zip reader", async () => {
  const files = [
    { path: "notes.txt", body: utf8("hello flux") },
    { path: "photos/inner/cat.bin", body: Uint8Array.from({ length: 5000 }, (_, i) => i % 251) },
    { path: "ä åäö/漢字 файл.txt", body: utf8("non-ascii names must survive") },
    { path: "empty.dat", body: new Uint8Array(0) },
  ];
  const bytes = (await archive(files)).bytes();

  // checkCRC32 makes this verify the descriptors, not just the directory.
  const read = await JSZip.loadAsync(bytes, { checkCRC32: true });
  assert.deepEqual(Object.keys(read.files).sort(), files.map((f) => f.path).sort());
  for (const { path, body } of files) {
    assert.deepEqual(await read.file(path)!.async("uint8array"), body, path);
  }
});

test("writes a local header the way the spec describes", async () => {
  const body = utf8("payload");
  const sink = await archive([{ path: "a/b.txt", body }]);
  const bytes = sink.bytes();
  const v = view(bytes);
  const name = utf8("a/b.txt");

  assert.equal(v.getUint32(0, true), LOCAL_SIG);
  assert.equal(v.getUint16(4, true), 20, "version needed");
  assert.equal(v.getUint16(6, true) & (1 << 11), 1 << 11, "UTF-8 name flag");
  assert.equal(v.getUint16(6, true) & (1 << 3), 1 << 3, "data descriptor flag");
  assert.equal(v.getUint16(8, true), 0, "stored, not deflated");
  assert.equal(v.getUint32(14, true), 0, "CRC belongs in the descriptor");
  assert.equal(v.getUint32(18, true), body.length, "compressed size");
  assert.equal(v.getUint32(22, true), body.length, "uncompressed size");
  assert.equal(v.getUint16(26, true), name.length, "name length");
  assert.equal(v.getUint16(28, true), 0, "no extra field below 4 GiB");
  assert.deepEqual(bytes.subarray(30, 30 + name.length), name);
  assert.deepEqual(bytes.subarray(30 + name.length, 30 + name.length + body.length), body);
  assert.ok(sink.closed, "the sink is closed when the archive finishes");
});

test("puts the CRC in a descriptor after the payload", async () => {
  const body = utf8("checksummed");
  const bytes = (await archive([{ path: "x", body }])).bytes();
  const at = 30 + 1 + body.length;
  const v = view(bytes);

  assert.equal(v.getUint32(at, true), DESCRIPTOR_SIG);
  assert.equal(v.getUint32(at + 4, true), crc32(body));
  assert.equal(v.getUint32(at + 8, true), body.length, "compressed size");
  assert.equal(v.getUint32(at + 12, true), body.length, "uncompressed size");
});

test("end record points at the real central directory", async () => {
  const bytes = (
    await archive([
      { path: "one", body: utf8("1") },
      { path: "two", body: utf8("22") },
    ])
  ).bytes();
  const records = centralRecords(bytes);
  assert.equal(records.length, 2);

  const eocd = indexOfSig(bytes, EOCD_SIG);
  const v = view(bytes);
  const size = v.getUint32(eocd + 12, true);
  const offset = v.getUint32(eocd + 16, true);

  assert.equal(v.getUint16(eocd + 8, true), 2, "entries on this disk");
  assert.equal(v.getUint16(eocd + 10, true), 2, "entries in total");
  assert.equal(offset, records[0].at, "directory starts at the first record");
  assert.equal(
    size,
    records.reduce((n, r) => n + r.length, 0),
    "directory covers both records",
  );
  assert.equal(offset + size, eocd, "and runs right up to the end record");
});

test("stores timestamps as DOS date and time", async () => {
  // DOS timestamps carry no zone, so they are written in local time like every other zip.
  const modified = new Date(Date.UTC(2021, 4, 17, 9, 41, 31));
  const bytes = (await archive([{ path: "t", body: utf8("x"), modified: modified.getTime() }])).bytes();
  const v = view(bytes);

  const expectedTime = (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1);
  const expectedDate = ((modified.getFullYear() - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();
  assert.equal(v.getUint16(10, true), expectedTime);
  assert.equal(v.getUint16(12, true), expectedDate);
});

test("clamps timestamps outside the DOS range", async () => {
  const before = (await archive([{ path: "old", body: utf8("x"), modified: Date.UTC(1975, 5, 15) }])).bytes();
  assert.equal(view(before).getUint16(10, true), 0, "midnight");
  assert.equal(view(before).getUint16(12, true), (1 << 5) | 1, "1980-01-01, the earliest it can say");

  const after = (await archive([{ path: "far", body: utf8("x"), modified: Date.UTC(2200, 0, 2) }])).bytes();
  // The year field is seven bits, so 2107 is as far ahead as a zip can point.
  assert.equal(view(after).getUint16(12, true) >> 9, 127);
});

test("promotes an entry over 4 GiB to ZIP64", async () => {
  const sink = recorder();
  const target = zipTarget(sink.sink);
  const size = 4 * 1024 ** 3 + 1;
  // The header is written from the declared size before any data arrives, so this asserts
  // what a real oversized file would produce without moving one.
  await target.begin({ path: "huge.bin", size, modified: null });
  const bytes = sink.bytes();
  const v = view(bytes);
  const name = utf8("huge.bin");

  assert.equal(v.getUint16(4, true), 45, "version needed says ZIP64");
  assert.equal(v.getUint32(18, true), MAX32, "compressed size defers to the extra field");
  assert.equal(v.getUint32(22, true), MAX32, "uncompressed size defers to the extra field");
  assert.equal(v.getUint16(28, true), 20, "extra field length");

  const extra = bytes.subarray(30 + name.length);
  const e = view(extra);
  assert.equal(e.getUint16(0, true), ZIP64_EXTRA_ID);
  assert.equal(e.getUint16(2, true), 16, "two 64-bit sizes");
  assert.equal(e.getBigUint64(4, true), BigInt(size), "compressed size");
  assert.equal(e.getBigUint64(12, true), BigInt(size), "uncompressed size");
});

test("switches to ZIP64 exactly at the 32-bit ceiling", async () => {
  // 0xffffffff is the value that means "read the real size from the extra field", so a file
  // of precisely that length cannot be written as itself and has to go ZIP64 too.
  const extraLengthFor = async (size: number) => {
    const sink = recorder();
    await zipTarget(sink.sink).begin({ path: "n", size, modified: null });
    return view(sink.bytes()).getUint16(28, true);
  };

  assert.equal(await extraLengthFor(MAX32 - 1), 0, "one byte under still fits in 32 bits");
  assert.equal(await extraLengthFor(MAX32), 20, "the ceiling itself is reserved");
  assert.equal(await extraLengthFor(MAX32 + 1), 20, "and anything above it");
});

test("promotes an entry starting past 4 GiB to a ZIP64 central record", async () => {
  // Only the tail is kept: the filler is written to move the offset, never held.
  const tail: Uint8Array[] = [];
  let recording = false;
  const target = zipTarget({
    async write(chunk) {
      if (recording) tail.push(Uint8Array.from(chunk));
    },
    async close() {},
    abort() {},
  });

  const MIB = 1 << 20;
  const size = 4 * 1024 ** 3;
  const filler = new Uint8Array(MIB);
  const first = await target.begin({ path: "filler.bin", size, modified: null });
  for (let i = 0; i < size / MIB; i++) await first.write(filler);
  await first.end(0);

  recording = true;
  const second = await target.begin({ path: "after.txt", size: 0, modified: null });
  await second.end(0);
  await target.finish();

  const bytes = concat(tail);
  const records = centralRecords(bytes);
  assert.equal(records.length, 2, "both entries are in the directory");

  const [filled, after] = records;
  const v = view(bytes);
  assert.equal(v.getUint32(filled.at + 42, true), 0, "the first entry starts at zero");
  assert.deepEqual(zip64Extra(filled.extra)?.length, 16, "but is itself over 4 GiB");

  assert.equal(v.getUint32(after.at + 42, true), MAX32, "the second defers its offset");
  const extra = zip64Extra(after.extra);
  assert.equal(extra?.length, 8, "one 64-bit local header offset");
  assert.ok(view(extra!).getBigUint64(0, true) > BigInt(MAX32), "which is past the 4 GiB mark");
});

test("promotes the end record to ZIP64 past 65535 entries", async () => {
  const sink = recorder();
  const target = zipTarget(sink.sink);
  const count = 0xffff;
  for (let i = 0; i < count; i++) {
    const writer = await target.begin({ path: `f${i}`, size: 0, modified: null });
    await writer.end(0);
  }
  await target.finish();

  const bytes = sink.bytes();
  const zip64 = indexOfSig(bytes, ZIP64_EOCD_SIG);
  const locator = indexOfSig(bytes, ZIP64_LOCATOR_SIG);
  const eocd = indexOfSig(bytes, EOCD_SIG);
  const v = view(bytes);

  assert.ok(zip64 > 0 && locator > zip64 && eocd > locator, "all three records, in order");
  assert.equal(v.getBigUint64(zip64 + 24, true), BigInt(count), "entries on this disk");
  assert.equal(v.getBigUint64(zip64 + 32, true), BigInt(count), "entries in total");
  assert.equal(v.getBigUint64(locator + 8, true), BigInt(zip64), "the locator finds the ZIP64 record");
  assert.equal(v.getUint16(eocd + 10, true), 0xffff, "the classic record saturates");
});

test("singleTarget writes one file straight through", async () => {
  const sink = recorder();
  const target = singleTarget(sink.sink);
  const writer = await target.begin({ path: "whole.bin", size: 4, modified: null });
  await writer.write(utf8("abcd"));
  await writer.end(crc32(utf8("abcd")));
  await target.finish();

  assert.deepEqual(sink.bytes(), utf8("abcd"), "no framing of any kind");
  assert.ok(sink.closed);
});

test("aborting a target aborts its sink", async () => {
  for (const make of [zipTarget, singleTarget]) {
    const sink = recorder();
    make(sink.sink).abort();
    assert.ok(sink.aborted, make.name);
  }
});

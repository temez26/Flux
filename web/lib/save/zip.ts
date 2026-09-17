import type { ByteSink } from "./save";

export interface Entry {
  path: string;
  size: number;
  modified: number | null;
}

export interface FileWriter {
  write(chunk: Uint8Array): Promise<void>;
  end(crc: number): Promise<void>;
}

/** Where received files go: one plain file, or a single zip holding all of them. */
export interface Target {
  begin(entry: Entry): Promise<FileWriter>;
  finish(): Promise<void>;
  abort(): void;
}

export function singleTarget(sink: ByteSink): Target {
  return {
    begin: async () => ({ write: (chunk) => sink.write(chunk), end: async () => {} }),
    finish: () => sink.close(),
    abort: () => sink.abort(),
  };
}

const FLAG_DESCRIPTOR = 1 << 3;
const FLAG_UTF8 = 1 << 11;
const VERSION_ZIP64 = 45;
const VERSION_DEFAULT = 20;
const MADE_BY_UNIX = (3 << 8) | VERSION_ZIP64;
const UNIX_FILE_MODE = 0o100644 << 16;
const MAX32 = 0xffffffff;
const encoder = new TextEncoder();

function dosDateTime(ms: number | null): [number, number] {
  const d = new Date(ms ?? Date.now());
  if (d.getFullYear() < 1980) return [0, (1 << 5) | 1];
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (Math.min(127, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/**
 * Streams an uncompressed zip (ZIP64 where needed). Sizes are known up front and go in
 * the local headers; each CRC follows its data in a descriptor, since it is computed on the way.
 */
export function zipTarget(sink: ByteSink): Target {
  const central: Uint8Array[] = [];
  let offset = 0;
  const put = (bytes: Uint8Array) => {
    offset += bytes.length;
    return sink.write(bytes);
  };

  return {
    async begin({ path, size, modified }) {
      const name = encoder.encode(path);
      const [time, date] = dosDateTime(modified);
      const big = size >= MAX32;
      const start = offset;
      const local = new Uint8Array(30 + name.length + (big ? 20 : 0));
      const v = new DataView(local.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, big ? VERSION_ZIP64 : VERSION_DEFAULT, true);
      v.setUint16(6, FLAG_UTF8 | FLAG_DESCRIPTOR, true);
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(18, big ? MAX32 : size, true);
      v.setUint32(22, big ? MAX32 : size, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, big ? 20 : 0, true);
      local.set(name, 30);
      if (big) {
        const x = 30 + name.length;
        v.setUint16(x, 0x0001, true);
        v.setUint16(x + 2, 16, true);
        v.setBigUint64(x + 4, BigInt(size), true);
        v.setBigUint64(x + 12, BigInt(size), true);
      }
      await put(local);

      return {
        write: put,
        async end(crc) {
          const descriptor = new Uint8Array(big ? 24 : 16);
          const d = new DataView(descriptor.buffer);
          d.setUint32(0, 0x08074b50, true);
          d.setUint32(4, crc, true);
          if (big) {
            d.setBigUint64(8, BigInt(size), true);
            d.setBigUint64(16, BigInt(size), true);
          } else {
            d.setUint32(8, size, true);
            d.setUint32(12, size, true);
          }
          await put(descriptor);
          central.push(centralHeader(name, size, crc, time, date, start));
        },
      };
    },
    async finish() {
      const start = offset;
      for (const header of central) await put(header);
      await put(endRecords(central.length, offset - start, start));
      await sink.close();
    },
    abort: () => sink.abort(),
  };
}

function centralHeader(name: Uint8Array, size: number, crc: number, time: number, date: number, offset: number) {
  const bigSize = size >= MAX32;
  const bigOffset = offset >= MAX32;
  const extra = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
  const header = new Uint8Array(46 + name.length + (extra ? extra + 4 : 0));
  const v = new DataView(header.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, MADE_BY_UNIX, true);
  v.setUint16(6, bigSize || bigOffset ? VERSION_ZIP64 : VERSION_DEFAULT, true);
  v.setUint16(8, FLAG_UTF8 | FLAG_DESCRIPTOR, true);
  v.setUint16(12, time, true);
  v.setUint16(14, date, true);
  v.setUint32(16, crc, true);
  v.setUint32(20, bigSize ? MAX32 : size, true);
  v.setUint32(24, bigSize ? MAX32 : size, true);
  v.setUint16(28, name.length, true);
  v.setUint16(30, extra ? extra + 4 : 0, true);
  v.setUint32(38, UNIX_FILE_MODE, true);
  v.setUint32(42, bigOffset ? MAX32 : offset, true);
  header.set(name, 46);
  if (extra) {
    let x = 46 + name.length;
    v.setUint16(x, 0x0001, true);
    v.setUint16(x + 2, extra, true);
    x += 4;
    if (bigSize) {
      v.setBigUint64(x, BigInt(size), true);
      v.setBigUint64(x + 8, BigInt(size), true);
      x += 16;
    }
    if (bigOffset) v.setBigUint64(x, BigInt(offset), true);
  }
  return header;
}

function endRecords(count: number, size: number, offset: number) {
  const zip64 = count >= 0xffff || size >= MAX32 || offset >= MAX32;
  const out = new Uint8Array((zip64 ? 76 : 0) + 22);
  const v = new DataView(out.buffer);
  let x = 0;
  if (zip64) {
    v.setUint32(0, 0x06064b50, true);
    v.setBigUint64(4, BigInt(44), true);
    v.setUint16(12, MADE_BY_UNIX, true);
    v.setUint16(14, VERSION_ZIP64, true);
    v.setBigUint64(24, BigInt(count), true);
    v.setBigUint64(32, BigInt(count), true);
    v.setBigUint64(40, BigInt(size), true);
    v.setBigUint64(48, BigInt(offset), true);
    v.setUint32(56, 0x07064b50, true);
    v.setBigUint64(64, BigInt(offset + size), true);
    v.setUint32(72, 1, true);
    x = 76;
  }
  v.setUint32(x, 0x06054b50, true);
  v.setUint16(x + 8, Math.min(count, 0xffff), true);
  v.setUint16(x + 10, Math.min(count, 0xffff), true);
  v.setUint32(x + 12, Math.min(size, MAX32), true);
  v.setUint32(x + 16, Math.min(offset, MAX32), true);
  return out;
}

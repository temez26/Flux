import { createBLAKE3, createCRC32, type IHasher } from "hash-wasm";

// hash-wasm instantiates WebAssembly behind a global lock on every create, which throttles
// runs of small files; finished hashers are reset and reused instead.
const pools = { blake3: [] as IHasher[], crc32: [] as IHasher[] };
const factories = { blake3: () => createBLAKE3(), crc32: () => createCRC32() };

export type HashKind = keyof typeof pools;

export async function acquireHasher(kind: HashKind): Promise<IHasher> {
  return pools[kind].pop()?.init() ?? factories[kind]();
}

export function releaseHasher(kind: HashKind, hasher: IHasher) {
  pools[kind].push(hasher);
}

// Hashing a whole multi-megabyte chunk in one call holds the main thread for long enough to
// drop frames, and with several files in flight the stalls run together. Feeding it in slices
// this size keeps each one to a few milliseconds.
const SLICE = 1 << 20;

// The pause between slices has to be a real task — a microtask runs before the browser ever
// renders — but not a timer, whose clamping would throttle hashing to a crawl.
const pending: (() => void)[] = [];
const channel = typeof MessageChannel === "function" ? new MessageChannel() : undefined;
if (channel) channel.port1.onmessage = () => pending.shift()?.();

function yieldToBrowser(): Promise<void> {
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    pending.push(resolve);
    channel.port2.postMessage(0);
  });
}

/**
 * Feeds `data` to `hasher`, letting the page render in between. `consumed` is called after
 * each slice: a caller that tracks how much of a file it has hashed must record it there,
 * because hashing can be abandoned between slices and the hasher can't be rewound.
 */
export async function updateInSlices(hasher: IHasher, data: Uint8Array, consumed?: (bytes: number) => void) {
  for (let offset = 0; offset < data.length; offset += SLICE) {
    const slice = data.subarray(offset, Math.min(offset + SLICE, data.length));
    hasher.update(slice);
    consumed?.(slice.length);
    if (offset + SLICE < data.length) await yieldToBrowser();
  }
}

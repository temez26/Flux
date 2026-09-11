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

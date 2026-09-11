import { createTransfer, type TransferMeta } from "./api";
import { DirectHost } from "./direct";
import { basename, uniquePaths, type Picked } from "./files";
import { saveOwned } from "./owned";
import { Uploader, type Entry } from "./upload";

// How long the server upload keeps yielding after a direct receiver's last request.
const DIRECT_IDLE_MS = 5000;

export interface Session {
  uploader: Uploader;
  host: DirectHost;
  /** A receiver got everything directly, so the server upload was paused as unnecessary. */
  delivered: boolean;
}

/** Transfers started in this tab. They keep running while the user moves between views. */
export const live = new Map<string, Session>();

function start(code: string, token: string, entries: Entry[]): Session {
  const files = new Map(entries.flatMap((e) => (e.file ? [[e.idx, e.file] as const] : [])));
  const uploader = new Uploader(code, token, entries);
  const session: Session = {
    uploader,
    delivered: false,
    host: new DirectHost(code, token, (idx) => files.get(idx), {
      activity: () => uploader.hold(DIRECT_IDLE_MS),
      delivered: () => {
        session.delivered = true;
        if (!uploader.snapshot.finished) uploader.pause();
      },
    }),
  };
  live.set(code, session);
  uploader.start();
  return session;
}

export async function send(picked: Picked[], expiresIn: number, isPublic: boolean): Promise<string> {
  const files = uniquePaths(picked);
  const created = await createTransfer(
    files.map(({ path, file }) => ({ path, size: file.size, type: file.type, modified: file.lastModified || null })),
    expiresIn,
    isPublic,
  );
  saveOwned(created.code, {
    token: created.token,
    expiresAt: created.expiresAt,
    public: isPublic,
    count: files.length,
    size: files.reduce((sum, p) => sum + p.file.size, 0),
    createdAt: Date.now(),
  });
  start(
    created.code,
    created.token,
    files.map(({ path, file }, idx) => ({ idx, path, size: file.size, file })),
  );
  return created.code;
}

/** Continues an interrupted upload with files the sender picked again, matched by path and size. */
export function resume(meta: TransferMeta, token: string, picked: Picked[]): Session {
  const byPath = new Map(picked.map((p) => [p.path, p.file]));
  const byName = new Map(picked.map((p) => [`${basename(p.path)}\n${p.file.size}`, p.file]));
  return start(
    meta.code,
    token,
    meta.files.map((f) => {
      const exact = byPath.get(f.path);
      const file = exact?.size === f.size ? exact : byName.get(`${basename(f.path)}\n${f.size}`);
      return { idx: f.idx, path: f.path, size: f.size, done: f.hash !== null, file: f.hash ? undefined : file };
    }),
  );
}

export function end(code: string) {
  const session = live.get(code);
  session?.uploader.dispose();
  session?.host.close();
  live.delete(code);
}

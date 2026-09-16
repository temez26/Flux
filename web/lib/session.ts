import { appendFiles, createTransfer, type NewFile, type TransferMeta } from "./api";
import { DirectHost } from "./direct";
import { basename, uniquePaths, type Picked } from "./files";
import { getOwned, saveOwned } from "./owned";
import { Uploader, type Entry } from "./upload";

// How long the server upload keeps yielding after a direct receiver's last request.
const DIRECT_IDLE_MS = 5000;

export interface Session {
  code: string;
  token: string;
  /** Absent when the transfer is served from this device and nothing is being uploaded. */
  uploader?: Uploader;
  host: DirectHost;
  /** The files this tab is serving, in listing order. */
  entries: Entry[];
  /** What this tab holds of them, by index, to upload or to hand a direct receiver. */
  files: Map<number, File>;
  /** A receiver got everything directly, so the server upload was paused as unnecessary. */
  delivered: boolean;
}

/** Transfers started in this tab. They keep running while the user moves between views. */
export const live = new Map<string, Session>();

const describe = ({ path, file }: Picked): NewFile => ({ path, size: file.size, type: file.type, modified: file.lastModified || null });

function start(code: string, token: string, entries: Entry[], hosted: boolean): Session {
  const uploader = hosted ? undefined : new Uploader(code, token, entries);
  const session: Session = {
    code,
    token,
    uploader,
    entries,
    files: new Map(entries.flatMap((e) => (e.file ? [[e.idx, e.file] as const] : []))),
    delivered: false,
    host: new DirectHost(code, token, (idx) => session.files.get(idx), {
      activity: () => uploader?.hold(DIRECT_IDLE_MS),
      delivered: () => {
        session.delivered = true;
        if (uploader && !uploader.snapshot.finished) uploader.pause();
      },
    }),
  };
  live.set(code, session);
  uploader?.start();
  return session;
}

export async function send(picked: Picked[], expiresIn: number, isPublic: boolean, hosted: boolean): Promise<string> {
  const files = uniquePaths(picked);
  const created = await createTransfer(
    files.map(describe),
    expiresIn,
    isPublic,
    hosted,
  );
  saveOwned(created.code, {
    token: created.token,
    expiresAt: created.expiresAt,
    public: isPublic,
    hosted,
    count: files.length,
    size: files.reduce((sum, p) => sum + p.file.size, 0),
    createdAt: Date.now(),
  });
  start(
    created.code,
    created.token,
    files.map(({ path, file }, idx) => ({ idx, path, size: file.size, file })),
    hosted,
  );
  return created.code;
}

/**
 * Adds files to a transfer this device created. One still uploading in this tab takes them
 * into its queue; otherwise a new upload starts for the additions, beside the files the server
 * already holds — which is why `meta` is needed then.
 */
export async function addFiles(code: string, token: string, picked: Picked[], meta?: TransferMeta): Promise<Session> {
  const files = uniquePaths(picked);
  const { files: added } = await appendFiles(code, token, files.map(describe));
  const entries: Entry[] = added.map((f, i) => ({ idx: f.idx, path: f.path, size: files[i].file.size, file: files[i].file }));

  const owned = getOwned(code);
  if (owned) {
    saveOwned(code, { ...owned, count: owned.count + entries.length, size: owned.size + entries.reduce((sum, e) => sum + e.size, 0) });
  }

  const session = live.get(code);
  if (session?.uploader && !session.uploader.gone) {
    for (const e of entries) session.files.set(e.idx, e.file!);
    session.entries.push(...entries);
    session.uploader.add(entries);
    return session;
  }
  if (!meta) throw new Error("This transfer isn't open in this tab");
  end(code);
  const held = meta.files.map((f) => ({ idx: f.idx, path: f.path, size: f.size, done: f.hash !== null }));
  return start(code, token, [...held, ...entries], false);
}

/** What a re-picked selection covers of a transfer that still needs uploading. */
export interface Match {
  entries: Entry[];
  /** Paths still needed that this selection didn't provide. */
  missing: string[];
  /** How many still-needed files it did provide. */
  matched: number;
  /** How many the server already holds in full. */
  complete: number;
}

/**
 * Lines a re-picked selection up against a transfer, by path first and then by name and
 * size — the sender may well have dropped the same folder in under a different name.
 *
 * What doesn't line up is reported rather than quietly left out: every unmatched file
 * becomes a failed row, and a whole screen of them says nothing about why.
 */
export function matchPicked(meta: TransferMeta, picked: Picked[]): Match {
  const byPath = new Map(picked.map((p) => [p.path, p.file]));
  const byName = new Map(picked.map((p) => [`${basename(p.path)}\n${p.file.size}`, p.file]));
  const missing: string[] = [];
  let matched = 0;
  let complete = 0;

  const entries = meta.files.map((f) => {
    const done = f.hash !== null;
    const exact = byPath.get(f.path);
    const file = done ? undefined : (exact?.size === f.size ? exact : byName.get(`${basename(f.path)}\n${f.size}`));
    if (done) complete++;
    else if (file) matched++;
    else missing.push(f.path);
    return { idx: f.idx, path: f.path, size: f.size, done, file };
  });

  return { entries, missing, matched, complete };
}

/** Continues an interrupted upload with the files a `matchPicked` selection lined up. */
export function resume(meta: TransferMeta, token: string, match: Match): Session {
  return start(meta.code, token, match.entries, meta.hosted);
}

export function end(code: string) {
  const session = live.get(code);
  session?.uploader?.dispose();
  session?.host.close();
  live.delete(code);
}

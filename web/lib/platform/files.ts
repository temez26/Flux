export interface Picked {
  file: File;
  /** Relative path inside the transfer, "/"-separated. */
  path: string;
}

const IGNORED = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const collator = new Intl.Collator(undefined, { numeric: true });

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function cleanPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

function finish(picked: Picked[]): Picked[] {
  return picked
    .filter((p) => p.path && !IGNORED.has(basename(p.path)))
    .sort((a, b) => collator.compare(a.path, b.path));
}

export function fromFileList(list: ArrayLike<File> | null): Picked[] {
  if (!list) return [];
  return finish(Array.from(list, (file) => ({ file, path: cleanPath(file.webkitRelativePath || file.name) })));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Pasted files, as files to send. A copied screenshot arrives called "image.png" — every one of
 * them — so those are named for when they were pasted, the way a screenshot on disk would be.
 */
export function fromClipboard(files: FileList | File[], now = new Date()): Picked[] {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return finish(
    Array.from(files, (file, i) => {
      const generic = /^image\.[a-z0-9]+$/i.test(file.name);
      const extension = file.name.slice(file.name.lastIndexOf("."));
      const name = generic ? `Pasted image ${stamp}${i ? ` (${i})` : ""}${extension}` : file.name;
      return { file, path: cleanPath(name) };
    }),
  );
}

/** Collects dropped files, descending into dropped folders. */
export function fromDataTransfer(data: DataTransfer): Promise<Picked[]> {
  // Entries must be taken synchronously; the DataTransfer is emptied once the event returns.
  const entries = Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.length) return Promise.resolve(fromFileList(data.files));

  const out: Picked[] = [];
  return Promise.all(entries.map((entry) => walk(entry, out))).then(() => finish(out));
}

async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: cleanPath(entry.fullPath) });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      await Promise.all(batch.map((child) => walk(child, out)));
    }
  }
}

/** Renames duplicates ("photo.jpg" → "photo (1).jpg"); the server requires unique paths. */
export function uniquePaths(picked: Picked[]): Picked[] {
  const seen = new Set<string>();
  return picked.map((p) => {
    let path = p.path;
    if (seen.has(path)) {
      const dot = path.lastIndexOf(".");
      const split = dot > path.lastIndexOf("/") + 1 ? dot : path.length;
      for (let n = 1; seen.has(path); n++) path = `${p.path.slice(0, split)} (${n})${p.path.slice(split)}`;
    }
    seen.add(path);
    return path === p.path ? p : { ...p, path };
  });
}

const sameFile = (a: Picked, b: Picked) =>
  a.path === b.path && a.file.size === b.file.size && a.file.lastModified === b.file.lastModified;

/** Adds a further pick to files already chosen, leaving out any picked a second time. */
export function addPicked(chosen: Picked[], added: Picked[]): Picked[] {
  return [...chosen, ...added.filter((p) => !chosen.some((c) => sameFile(c, p)))];
}

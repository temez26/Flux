"use client";

import { useEffect, type ReactNode } from "react";
import {
  countDownload,
  deleteTransfer,
  errorMessage,
  fileUrl,
  zipUrl,
  type FileMeta,
  type TransferMeta,
} from "@/lib/api";
import { basename } from "@/lib/platform/files";
import { formatBytes, formatCode, formatRemaining, plural } from "@/lib/util/format";
import { reloadTransfer, useNow } from "@/lib/hooks";
import { removeOwned } from "@/lib/storage/owned";
import { canPreview } from "@/lib/preview/preview";
import { rememberRecent } from "@/lib/storage/recent";
import { navigate } from "@/lib/platform/router";
import { end, removeFile } from "@/lib/transfer/session";
import { toast } from "@/lib/alerts/toast";
import { FileRow, FileTile } from "../files/FileList";
import { CheckIcon, ClockIcon, DownloadIcon, FileTypeIcon, FolderIcon, TrashIcon } from "../ui/icons";
import { FileThumb } from "../preview/Preview";
import { Badge, ConfirmIconButton, Spinner, buttonClass } from "../ui/ui";

/** Stand-ins for a store that doesn't exist yet, for useSyncExternalStore. */
export const subscribeNothing = () => () => {};
export const versionZero = () => 0;

/** Lists a transfer someone else made among this device's recently received, kept up to date as it changes. */
export function useRememberRecent(meta: TransferMeta, enabled = true) {
  const { code, title, expiresAt, hosted, collect } = meta;
  const note = meta.note !== undefined;
  const files = meta.files.length;
  const size = note ? new TextEncoder().encode(meta.note).length : meta.files.reduce((sum, f) => sum + f.size, 0);
  useEffect(() => {
    if (enabled) rememberRecent(code, { title, files, size, expiresAt, hosted, collect, note });
  }, [enabled, code, title, files, size, expiresAt, hosted, collect, note]);
}

export const pageTitle = (code: string) => `${formatCode(code)} · Flux`;

export const percent = (part: number, whole: number) => (whole ? Math.floor((part / whole) * 100) : 100);

/** How long deleting a transfer can be taken back. */
const UNDO_MS = 7000;

/**
 * Deletes a transfer, after a moment in which it can be taken back — it is the one action
 * in the app that nothing else can put right.
 *
 * Nothing local is given up until the deletion actually goes through. A tab closed inside
 * the window then leaves the transfer whole and still listed, which is a far better way to
 * be wrong than leaving one alive that its owner can no longer see or reach.
 */
/** Removes a file from a transfer this device owns, once its row's second tap arrives. */
export function removeOwnedFile(code: string, token: string, file: FileMeta) {
  removeFile(code, token, file.idx, file.size).then(
    () => {
      reloadTransfer(code);
      toast(`Removed ${basename(file.path)}`);
    },
    (err) => toast(errorMessage(err), "err"),
  );
}

export function removeTransfer(code: string, token: string) {
  navigate("/", true);
  const timer = window.setTimeout(() => {
    end(code);
    removeOwned(code);
    void deleteTransfer(code, token).catch(() => {});
  }, UNDO_MS);

  toast("Transfer deleted", "ok", {
    durationMs: UNDO_MS,
    action: {
      label: "Undo",
      run: () => {
        window.clearTimeout(timer);
        navigate(`/${formatCode(code)}`);
      },
    },
  });
}

export function summarize(files: FileMeta[]) {
  let size = 0;
  let received = 0;
  let complete = 0;
  for (const f of files) {
    size += f.size;
    received += f.received;
    if (f.hash) complete++;
  }
  return { size, received, complete, ready: complete === files.length };
}

/** In long lists the files in flight are rarely on screen, so they are pinned above the list. */
export function inFlight<T extends { status: string }>(items: T[], finished: boolean): T[] {
  return items.length > 8 && !finished ? items.filter((item) => item.status === "active") : [];
}

export function Pinned({ title, children }: { title: string; children: ReactNode[] }) {
  if (!children.length) return null;
  return (
    <section>
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {children.map((child, i) => (
        <div key={i} className="h-15">
          {child}
        </div>
      ))}
    </section>
  );
}

export function TransferHeading({ meta, badges }: { meta: TransferMeta; badges?: ReactNode }) {
  const now = useNow(60_000);
  const { size } = summarize(meta.files);
  const single = meta.files.length === 1 ? meta.files[0] : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge icon={<ClockIcon />}>
          {formatRemaining(meta.expiresAt, now, meta.files.some((f) => f.hash === null) ? meta.lifetime : null)}
        </Badge>
        {badges}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          {single ? <FileTypeIcon path={single.path} className="size-6" /> : <FolderIcon className="size-6" />}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {single ? basename(single.path) : plural(meta.files.length, "file")}
          </h1>
          <p className="text-sm text-muted">{formatBytes(size)}</p>
        </div>
      </div>
    </>
  );
}

/** A file as the server knows it: uploaded, part-way there, or still expected. */
/** `counted` records a download taken from the row, for anyone who isn't the transfer's owner. */
export function MetaRow({
  file,
  code,
  downloadable,
  counted = false,
  onPreview,
  onRemove,
}: {
  file: FileMeta;
  code: string;
  downloadable: boolean;
  counted?: boolean;
  onPreview: (idx: number) => void;
  /** Offered to the transfer's owner, finished upload or not. */
  onRemove?: () => void;
}) {
  const remove = onRemove && (
    <ConfirmIconButton label={`Remove ${basename(file.path)}`} onConfirm={onRemove}>
      <TrashIcon className="size-4" />
    </ConfirmIconButton>
  );
  if (file.hash) {
    return (
      <FileRow
        path={file.path}
        size={file.size}
        thumb={<FileThumb key={file.idx} code={code} file={file} className="size-4.5" />}
        onOpen={canPreview(file) ? () => onPreview(file.idx) : undefined}
        badge={
          !downloadable && (
            <Badge tone="ok" icon={<CheckIcon />}>
              Uploaded
            </Badge>
          )
        }
        actions={
          (downloadable || remove) && (
            <>
              {downloadable && (
                <a
                  href={fileUrl(code, file.idx)}
                  download
                  onClick={counted ? () => countDownload(code) : undefined}
                  className={buttonClass("ghost", "min-h-10 px-3 text-accent")}
                  aria-label={`Download ${basename(file.path)}`}
                >
                  <DownloadIcon className="size-4" />
                </a>
              )}
              {remove}
            </>
          )
        }
      />
    );
  }
  const pct = file.size ? file.received / file.size : 0;
  return file.received > 0 ? (
    <FileRow
      path={file.path}
      size={file.size}
      badge={
        <Badge tone="accent" icon={<Spinner />}>
          Uploading {Math.floor(pct * 100)}%
        </Badge>
      }
      progress={pct}
      actions={remove}
    />
  ) : (
    <FileRow path={file.path} size={file.size} badge={<Badge icon={<ClockIcon />}>Waiting</Badge>} actions={remove} />
  );
}

export function MetaTile({
  file,
  code,
  onPreview,
}: {
  file: FileMeta;
  code: string;
  onPreview: (idx: number) => void;
}) {
  return (
    <FileTile
      path={file.path}
      size={file.size}
      thumb={<FileThumb key={file.idx} code={code} file={file} className="size-7" />}
      onOpen={canPreview(file) ? () => onPreview(file.idx) : undefined}
      badge={
        !file.hash && (
          <Badge icon={<ClockIcon />}>
            {file.received > 0 ? `${Math.floor((file.received / file.size) * 100)}%` : "Waiting"}
          </Badge>
        )
      }
    />
  );
}

/** A request line a reverse proxy will still accept, with room to spare. */
const MAX_URL = 4000;

/** Downloads chosen files that the server holds: one directly, several as a zip. */
export function SelectionDownload({
  code,
  files,
  counted = false,
}: {
  code: string;
  files: FileMeta[];
  counted?: boolean;
}) {
  const count = counted ? () => countDownload(code) : undefined;
  const primary = buttonClass("primary", "min-h-9");
  if (files.some((f) => !f.hash)) {
    return (
      <button type="button" disabled className={primary}>
        Waiting for uploads
      </button>
    );
  }
  if (files.length === 1) {
    return (
      <a href={fileUrl(code, files[0].idx)} download onClick={count} className={primary}>
        <DownloadIcon className="size-4" />
        Download
      </a>
    );
  }
  const url = zipUrl(
    code,
    files.map((f) => f.idx),
  );
  // Scattered picks can't be written as a handful of ranges; a folder always can.
  if (url.length > MAX_URL) {
    return (
      <button type="button" disabled className={primary}>
        Too many separate files — narrow it down
      </button>
    );
  }
  return (
    <a href={url} download onClick={count} className={primary}>
      <DownloadIcon className="size-4" />
      Download {files.length.toLocaleString()} as .zip
    </a>
  );
}

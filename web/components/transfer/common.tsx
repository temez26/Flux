"use client";

import type { ReactNode } from "react";
import { deleteTransfer, fileUrl, type FileMeta, type TransferMeta } from "@/lib/api";
import { basename } from "@/lib/files";
import { formatBytes, formatCode, formatRemaining, plural } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { removeOwned } from "@/lib/owned";
import { canPreview } from "@/lib/preview";
import { navigate } from "@/lib/router";
import { end } from "@/lib/session";
import { toast } from "@/lib/toast";
import { FileRow, FileTile } from "../FileList";
import { CheckIcon, ClockIcon, DownloadIcon, FileTypeIcon, FolderIcon } from "../icons";
import { FileThumb } from "../preview/Preview";
import { Badge, Spinner, buttonClass } from "../ui";

export const pageTitle = (code: string) => `${formatCode(code)} · Flux`;

export const percent = (part: number, whole: number) => (whole ? Math.floor((part / whole) * 100) : 100);

export async function removeTransfer(code: string, token: string) {
  end(code);
  removeOwned(code);
  navigate("/", true);
  toast("Transfer deleted");
  await deleteTransfer(code, token).catch(() => {});
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
        <Badge>
          <span className="font-mono">{formatCode(meta.code)}</span>
        </Badge>
        <Badge icon={<ClockIcon />}>{formatRemaining(meta.expiresAt, now)}</Badge>
        {badges}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          {single ? <FileTypeIcon path={single.path} className="size-6" /> : <FolderIcon className="size-6" />}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{single ? basename(single.path) : plural(meta.files.length, "file")}</h1>
          <p className="text-sm text-muted">{formatBytes(size)}</p>
        </div>
      </div>
    </>
  );
}

/** A file as the server knows it: uploaded, part-way there, or still expected. */
export function MetaRow({ file, code, downloadable, onPreview }: { file: FileMeta; code: string; downloadable: boolean; onPreview: (idx: number) => void }) {
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
          downloadable && (
            <a href={fileUrl(code, file.idx)} download className={buttonClass("ghost", "min-h-10 px-3 text-accent")} aria-label={`Download ${basename(file.path)}`}>
              <DownloadIcon className="size-4" />
            </a>
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
    />
  ) : (
    <FileRow path={file.path} size={file.size} badge={<Badge icon={<ClockIcon />}>Waiting</Badge>} />
  );
}

export function MetaTile({ file, code, onPreview }: { file: FileMeta; code: string; onPreview: (idx: number) => void }) {
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

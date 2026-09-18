"use client";

import { useEffect, useRef, useState } from "react";
import { basename, type Picked } from "@/lib/platform/files";
import { formatBytes, plural } from "@/lib/util/format";
import { CloseIcon, FileTypeIcon, PlusIcon, UploadIcon } from "../../ui/icons";
import { Button, IconButton } from "../../ui/ui";

/** Enough rows to check a pick at a glance; past this the list only says how many more. */
const LISTED = 100;

/** The size of files and the first of their names, to recognise them by. */
export function describeFiles(files: Picked[]): string {
  const size = formatBytes(files.reduce((sum, p) => sum + p.file.size, 0));
  const names = files
    .slice(0, 2)
    .map((p) => p.path)
    .join(", ");
  const rest = files.length > 2 ? ` and ${(files.length - 2).toLocaleString()} more` : "";
  return `${size} · ${names}${rest}`;
}

/** The picked file itself where the browser can draw it, otherwise its type's icon. */
function Thumb({ picked }: { picked: Picked }) {
  const img = useRef<HTMLImageElement>(null);
  // Rows are reused as files are removed, so a failure belongs to the file that failed.
  const [failed, setFailed] = useState<File | null>(null);
  const drawn = picked.file.type.startsWith("image/") && failed !== picked.file;

  useEffect(() => {
    if (!drawn || !img.current) return;
    const url = URL.createObjectURL(picked.file);
    img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [picked.file, drawn]);

  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-hover text-muted">
      {drawn ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local file, not a static asset
        <img
          ref={img}
          alt=""
          decoding="async"
          onError={() => setFailed(picked.file)}
          className="size-full object-cover"
        />
      ) : (
        <FileTypeIcon path={picked.path} className="size-4.5" />
      )}
    </span>
  );
}

/** Files chosen, dropped, pasted or shared from another app, waiting for Send. */
export function StagedFiles({
  files,
  action,
  disabled,
  onSend,
  onAdd,
  onRemove,
  onCancel,
}: {
  files: Picked[];
  action: string;
  disabled: boolean;
  onSend: () => void;
  /** Opens the picker for more; phones pick from the library a batch at a time. */
  onAdd: () => void;
  onRemove: (index: number) => void;
  onCancel: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  /** Where focus goes once a removed row has left, as its button went with it. */
  const removed = useRef<number | null>(null);
  const size = files.reduce((sum, p) => sum + p.file.size, 0);

  useEffect(() => {
    const at = removed.current;
    if (at === null) return;
    removed.current = null;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("button");
    (buttons?.[Math.min(at, buttons.length - 1)] ?? heading.current)?.focus();
  }, [files]);

  return (
    <div className="animate-view-in rounded-inset border-2 border-accent/60 bg-accent/5 p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p ref={heading} tabIndex={-1} className="font-semibold outline-none!">
          {plural(files.length, "file")} ready
        </p>
        <p className="shrink-0 text-sm text-muted tabular-nums">{formatBytes(size)}</p>
      </div>
      <ul ref={list} aria-label="Files to send" className="-mx-2 mt-2 max-h-72 overflow-y-auto overscroll-contain">
        {files.slice(0, LISTED).map((picked, i) => {
          const slash = picked.path.lastIndexOf("/");
          return (
            <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-1">
              <Thumb picked={picked} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{basename(picked.path)}</p>
                <p className="flex min-w-0 gap-1.5 text-xs text-muted">
                  <span className="shrink-0 tabular-nums">{formatBytes(picked.file.size)}</span>
                  {slash > 0 && <span className="truncate">· {picked.path.slice(0, slash)}</span>}
                </p>
              </div>
              <IconButton
                label={`Remove ${picked.path}`}
                onClick={() => {
                  removed.current = i;
                  onRemove(i);
                }}
              >
                <CloseIcon className="size-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {files.length > LISTED && (
        <p className="mt-1 text-sm text-muted">and {(files.length - LISTED).toLocaleString()} more</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onSend} disabled={disabled} className="max-sm:w-full">
          <UploadIcon className="size-4" />
          {action}
        </Button>
        <Button onClick={onAdd} className="max-sm:flex-1">
          <PlusIcon className="size-4" />
          Add more
        </Button>
        <Button variant="ghost" onClick={onCancel} className="max-sm:flex-1">
          Cancel
        </Button>
      </div>
    </div>
  );
}

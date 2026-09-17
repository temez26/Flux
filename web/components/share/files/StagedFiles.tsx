"use client";

import type { Picked } from "@/lib/platform/files";
import { formatBytes, plural } from "@/lib/util/format";
import { UploadIcon } from "../../ui/icons";
import { Button } from "../../ui/ui";

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

/** Files chosen, dropped, pasted or shared from another app, waiting for Send. */
export function StagedFiles({
  files,
  action,
  disabled,
  hint,
  onSend,
  onCancel,
}: {
  files: Picked[];
  action: string;
  disabled: boolean;
  /** Why they can't be sent yet. */
  hint?: string;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-accent/60 bg-accent/5 p-5">
      <p className="font-semibold">{plural(files.length, "file")} ready</p>
      <p className="mt-1 truncate text-sm text-muted">{describeFiles(files)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onSend} disabled={disabled}>
          <UploadIcon className="size-4" />
          {action}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {hint && <p className="mt-3 text-sm text-muted">{hint}</p>}
    </div>
  );
}

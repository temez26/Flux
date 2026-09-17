"use client";

import type { Peer } from "@/lib/nearby/nearby";
import type { Picked } from "@/lib/platform/files";
import { formatBytes, plural } from "@/lib/util/format";
import { UploadIcon } from "../../ui/icons";
import { Button } from "../../ui/ui";

/** Files another app shared to Flux, waiting to be told where to go. */
export function SharedFiles({
  files,
  target,
  onSend,
  onCancel,
}: {
  files: Picked[];
  target: Peer | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-accent/60 bg-accent/5 p-5">
      <p className="font-semibold">{plural(files.length, "file")} shared to Flux</p>
      <p className="mt-1 truncate text-sm text-muted">
        {formatBytes(files.reduce((sum, p) => sum + p.file.size, 0))} ·{" "}
        {files
          .slice(0, 2)
          .map((p) => p.path)
          .join(", ")}
        {files.length > 2 ? ` and ${(files.length - 2).toLocaleString()} more` : ""}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onSend}>
          <UploadIcon className="size-4" />
          {target ? `Send to ${target.name}` : "Send"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted">Or choose a nearby device below to send straight to it.</p>
    </div>
  );
}

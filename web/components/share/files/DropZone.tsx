"use client";

import type { Picked } from "@/lib/platform/files";
import { canPickFolder, canPickMedia, type PickerKind } from "../../files/picker";
import { FolderIcon, ImageIcon, UploadIcon } from "../../ui/icons";
import { Button, Spinner } from "../../ui/ui";
import { dropTarget } from "../incoming";

/** The area files are chosen, dropped or pasted into, which shows the progress of reading them. */
export function DropZone({
  status,
  stalled,
  disabled,
  title,
  onPick,
  onDrop,
}: {
  status: string | null;
  /** The picker has been waiting long enough to say something is wrong. */
  stalled: boolean;
  /** Files can't be chosen yet; dropped ones are still taken, to wait. */
  disabled: boolean;
  title: string;
  onPick: (kind: PickerKind) => void;
  onDrop: (picked: Promise<Picked[]>) => void;
}) {
  const folders = canPickFolder();
  const photos = canPickMedia();
  const idle = !status && !disabled;
  // The zone around these buttons opens the file picker too.
  const pick = (kind: PickerKind) => (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    onPick(kind);
  };

  return (
    <div
      onClick={() => idle && onPick("files")}
      {...dropTarget((picked) => !status && onDrop(picked))}
      className={`flex min-h-44 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${
        idle ? "cursor-pointer border-line hover:border-accent/60 hover:bg-hover/50" : "border-line"
      }`}
    >
      {status ? (
        <>
          <Spinner className="size-7 text-accent" />
          <p role="status" className="font-medium">
            {status}
          </p>
          {stalled && <p className="max-w-xs text-sm text-muted">Still waiting. Try fewer files at a time.</p>}
        </>
      ) : (
        <>
          <p className={`font-semibold ${disabled ? "text-muted" : ""}`}>{title}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {photos && (
              <Button variant="primary" onClick={pick("media")} disabled={disabled}>
                <ImageIcon className="size-4" />
                Photos & videos
              </Button>
            )}
            <Button variant={photos ? "secondary" : "primary"} onClick={pick("files")} disabled={disabled}>
              <UploadIcon className="size-4" />
              Choose files
            </Button>
            {folders && (
              <Button onClick={pick("folder")} disabled={disabled}>
                <FolderIcon className="size-4" />
                Choose folder
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function DropOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 bg-bg/80 p-4 backdrop-blur-sm">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent text-accent">
        <UploadIcon className="size-10" />
        <p className="text-lg font-semibold">{label}</p>
      </div>
    </div>
  );
}

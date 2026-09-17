"use client";

import type { Peer } from "@/lib/nearby/nearby";
import type { Picked } from "@/lib/platform/files";
import { canPickFolder } from "../../files/picker";
import { FolderIcon, UploadIcon } from "../../ui/icons";
import { Button, Spinner } from "../../ui/ui";
import { dropTarget } from "../incoming";

/** The area files are chosen, dropped or pasted into, which shows the progress of reading them. */
export function DropZone({
  status,
  stalled,
  busy,
  target,
  isPublic,
  highlight,
  onPick,
  onDrop,
}: {
  status: string | null;
  /** The picker has been waiting long enough to say something is wrong. */
  stalled: boolean;
  busy: boolean;
  target: Peer | null;
  isPublic: boolean;
  /** Files are being dragged over the page, and this is one of several places to drop them. */
  highlight: boolean;
  onPick: (kind: "files" | "folder") => void;
  onDrop: (picked: Promise<Picked[]>) => void;
}) {
  const folders = canPickFolder();
  // The zone around these buttons opens the file picker too.
  const pick = (kind: "files" | "folder") => (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    onPick(kind);
  };

  return (
    <div
      onClick={() => !busy && onPick("files")}
      {...dropTarget((picked) => !busy && onDrop(picked))}
      className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${
        status
          ? "cursor-default border-line"
          : highlight
            ? "border-accent bg-accent/5"
            : "border-line hover:border-accent/60 hover:bg-hover/50"
      }`}
    >
      {status ? (
        <>
          <Spinner className="size-7 text-accent" />
          <p className="font-medium">{status}</p>
          {stalled && (
            <p className="max-w-xs text-sm text-muted">
              Still nothing. Phones quietly give up on very large selections — try a few hundred files at a time.
            </p>
          )}
        </>
      ) : (
        <>
          <div>
            <p className="font-semibold">
              {highlight
                ? `Drop here to share ${isPublic ? "publicly" : "privately"}`
                : target
                  ? `Choose what to send to ${target.name}`
                  : folders
                    ? "Drop files or folders here"
                    : "Send photos, videos or any files"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {isPublic ? "Anyone who opens Flux can see and download them" : "Only people with the code or link"}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={pick("files")}>
              <UploadIcon className="size-4" />
              Choose files
            </Button>
            {folders && (
              <Button onClick={pick("folder")}>
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

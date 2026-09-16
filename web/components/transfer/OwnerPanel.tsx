"use client";

import { useMemo, useState } from "react";
import type { TransferMeta } from "@/lib/api";
import { basename } from "@/lib/files";
import { formatBytes, plural } from "@/lib/format";
import { useTitle } from "@/lib/hooks";
import { matchPicked, resume, type Match, type Session } from "@/lib/session";
import { toast } from "@/lib/toast";
import { FileBrowser, FileRow } from "../FileList";
import { AlertIcon, CheckIcon, DeviceIcon, FolderIcon, UploadIcon } from "../icons";
import { canPickFolder, useFilePickers } from "../picker";
import { PreviewDialog } from "../preview/Preview";
import { ShareCard } from "../ShareCard";
import { Badge, Button, ConfirmButton, Notice, Spinner, StatusCard, type StatusProps } from "../ui";
import { MetaRow, MetaTile, pageTitle, percent, removeTransfer, summarize } from "./common";

/**
 * The sender coming back to a transfer this tab is no longer uploading — after a reload, or
 * from another visit. The files themselves are gone with the old page, so continuing means
 * picking them again.
 */
export function OwnerPanel({ meta, token, onResume }: { meta: TransferMeta; token: string; onResume: (s: Session) => void }) {
  const { complete, ready, size, received } = summarize(meta.files);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const paths = useMemo(() => meta.files.map((f) => f.path), [meta]);
  const folders = canPickFolder();
  /** A selection that didn't cover everything still needed, kept so it can be explained. */
  const [shortfall, setShortfall] = useState<Match>();
  const picker = useFilePickers((picked) => {
    if (!picked.length) return;
    const match = matchPicked(meta, picked);
    setShortfall(match.missing.length ? match : undefined);
    // Starting an upload where nothing lined up would just hand back a screen of failures.
    if (!match.matched) return;
    if (match.missing.length) {
      toast(`${match.matched.toLocaleString()} of ${(match.matched + match.missing.length).toLocaleString()} files matched`, "err");
    }
    onResume(resume(meta, token, match));
  });
  useTitle(pageTitle(meta.code));

  const status: StatusProps = meta.hosted
    ? { tone: "warn", icon: <DeviceIcon />, title: "Not being shared", subtitle: "Nothing was uploaded, so add the files again to serve them from this device." }
    : ready
      ? { tone: "ok", icon: <CheckIcon />, title: "Ready to receive", subtitle: "Every file is uploaded and verified." }
      : { tone: "warn", icon: <AlertIcon />, title: "Upload interrupted", subtitle: "Add the same files again to continue where it stopped." };

  return (
    <div className="space-y-4">
      <ShareCard code={meta.code} expiresAt={meta.expiresAt} hosted={meta.hosted} />
      <StatusCard
        {...status}
        // Nothing was ever uploaded for a hosted transfer, so there is no progress to show.
        percent={meta.hosted ? undefined : percent(received, size)}
        progress={meta.hosted ? undefined : size ? received / size : 1}
        stats={
          meta.hosted
            ? [
                ["Files", meta.files.length.toLocaleString()],
                ["Size", formatBytes(size)],
              ]
            : [
                ["Files", `${complete.toLocaleString()} / ${meta.files.length.toLocaleString()}`],
                ["Uploaded", `${formatBytes(received)} / ${formatBytes(size)}`],
              ]
        }
        actions={
          !ready && (
            <>
              <Button variant="primary" onClick={() => picker.open("files")}>
                {picker.waiting ? <Spinner className="size-4" /> : meta.hosted ? <DeviceIcon className="size-4" /> : <UploadIcon className="size-4" />}
                {picker.waiting ? "Getting your files…" : meta.hosted ? "Share these files again" : "Add files"}
              </Button>
              {folders && (
                <Button onClick={() => picker.open("folder")}>
                  <FolderIcon className="size-4" />
                  Add folder
                </Button>
              )}
            </>
          )
        }
        danger={<ConfirmButton onConfirm={() => removeTransfer(meta.code, token)}>Delete transfer</ConfirmButton>}
      >
        {picker.inputs}
        {shortfall && !shortfall.matched && (
          <Notice tone="warn" icon={<AlertIcon />} className="mt-4">
            None of the {plural(shortfall.missing.length, "file")} still needed were in what you picked. Choose the same files or
            folder you sent — still missing {shortfall.missing.slice(0, 3).map(basename).join(", ")}
            {shortfall.missing.length > 3 ? ` and ${(shortfall.missing.length - 3).toLocaleString()} more` : ""}.
          </Notice>
        )}
      </StatusCard>
      <FileBrowser
        paths={paths}
        renderRow={(i) =>
          meta.hosted ? (
            <FileRow path={meta.files[i].path} size={meta.files[i].size} badge={<Badge icon={<DeviceIcon />}>Not shared</Badge>} />
          ) : (
            <MetaRow file={meta.files[i]} code={meta.code} downloadable={false} onPreview={setPreviewing} />
          )
        }
        renderTile={meta.hosted ? undefined : (i) => <MetaTile file={meta.files[i]} code={meta.code} onPreview={setPreviewing} />}
      />
      <PreviewDialog code={meta.code} files={meta.files} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

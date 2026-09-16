"use client";

import { useMemo, useState } from "react";
import type { TransferMeta } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useTitle } from "@/lib/hooks";
import { resume, type Session } from "@/lib/session";
import { FileBrowser, FileRow } from "../FileList";
import { AlertIcon, CheckIcon, DeviceIcon, FolderIcon, UploadIcon } from "../icons";
import { canPickFolder, useFilePickers } from "../picker";
import { PreviewDialog } from "../preview/Preview";
import { ShareCard } from "../ShareCard";
import { Badge, Button, ConfirmButton, Spinner, StatusCard, type StatusProps } from "../ui";
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
  const picker = useFilePickers((picked) => {
    if (picked.length) onResume(resume(meta, token, picked));
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

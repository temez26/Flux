"use client";

import { useState, useSyncExternalStore } from "react";
import { errorMessage, type TransferMeta } from "@/lib/api";
import { getDevice } from "@/lib/nearby/device";
import { formatBytes, plural } from "@/lib/util/format";
import { reloadTransfer, useLeaveGuard, useNotifyWhen, useWakeLock } from "@/lib/hooks";
import { contribute, contributions } from "@/lib/transfer/session";
import { toast } from "@/lib/alerts/toast";
import { AlertIcon, CheckIcon, PauseIcon, PlayIcon, PlusIcon, RetryIcon, UploadIcon } from "../ui/icons";
import { canPickFolder, useFilePickers } from "../files/picker";
import { Button, Card, SectionTitle, Spinner, StatusCard, type StatusProps } from "../ui/ui";
import { percent, subscribeNothing, versionZero } from "./common";

/**
 * Adding files to someone else's public share, which its owner opened to that: choosing them,
 * and following their upload. They appear in the share's file list as they arrive.
 */
export function AddFilesCard({ meta }: { meta: TransferMeta }) {
  const [uploader, setUploader] = useState(() => contributions.get(meta.code));
  const [adding, setAdding] = useState(false);
  const folders = canPickFolder();
  useSyncExternalStore(uploader?.subscribe ?? subscribeNothing, uploader?.getVersion ?? versionZero, versionZero);

  const picker = useFilePickers(async (picked) => {
    if (!picked.length) return;
    setAdding(true);
    try {
      setUploader(await contribute(meta.code, picked));
    } catch (err) {
      toast(errorMessage(err), "err");
      // Most likely its owner stopped taking files since this page last looked.
      reloadTransfer(meta.code);
    } finally {
      setAdding(false);
    }
  });

  const snapshot = uploader?.snapshot;
  const running = !!uploader && !snapshot?.finished && !uploader.paused;
  const failed = snapshot?.counts.failed ?? 0;
  useWakeLock(running);
  useLeaveGuard(running);
  useNotifyWhen(!!snapshot?.finished && !failed, "Your files were added", meta.title);

  let status: StatusProps | undefined;
  if (uploader && snapshot) {
    status = uploader.gone
      ? {
          tone: "err",
          icon: <AlertIcon />,
          title: "This share is gone",
          subtitle: "It expired or was deleted before everything arrived.",
        }
      : snapshot.finished && failed
        ? {
            tone: "err",
            icon: <AlertIcon />,
            title: `${plural(failed, "file")} didn't make it`,
            subtitle: "Retry them, or leave the rest as they are.",
          }
        : snapshot.finished
          ? { tone: "ok", icon: <CheckIcon />, title: "Your files are in", subtitle: "Uploaded and verified." }
          : uploader.paused
            ? { tone: "warn", icon: <PauseIcon />, title: "Paused", subtitle: "Resume to finish adding your files." }
            : {
                tone: "accent",
                icon: <Spinner className="size-5" />,
                title: "Adding your files",
                subtitle: "Keep this page open until it finishes.",
              };
  }

  return (
    <>
      <Card>
        <SectionTitle icon={<PlusIcon className="size-4.5" />}>Add your files</SectionTitle>
        <p className="text-sm text-muted">
          The owner lets anyone add files here. Yours go into a folder named{" "}
          <span className="font-medium text-fg">{getDevice().name}</span>, and everyone can see and download them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => picker.open("files")} disabled={adding}>
            {adding || picker.waiting ? <Spinner className="size-4" /> : <UploadIcon className="size-4" />}
            {picker.waiting ? "Getting your files…" : uploader ? "Add more files" : "Add files"}
          </Button>
          {folders && (
            <Button onClick={() => picker.open("folder")} disabled={adding}>
              <PlusIcon className="size-4" />
              Add a folder
            </Button>
          )}
        </div>
        {picker.inputs}
      </Card>

      {uploader && snapshot && status && (
        <StatusCard
          {...status}
          percent={percent(snapshot.sent, snapshot.total)}
          progress={snapshot.total ? snapshot.sent / snapshot.total : 1}
          stats={[
            [
              "Files",
              `${snapshot.counts.done.toLocaleString()} / ${(uploader.items.length - snapshot.counts.canceled).toLocaleString()}`,
            ],
            ["Uploaded", `${formatBytes(snapshot.sent)} / ${formatBytes(snapshot.total)}`],
          ]}
          actions={
            !uploader.gone && (
              <>
                {!snapshot.finished && (
                  <Button onClick={() => (uploader.paused ? uploader.resume() : uploader.pause())}>
                    {uploader.paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
                    {uploader.paused ? "Resume" : "Pause"}
                  </Button>
                )}
                {failed > 0 && (
                  <Button variant="primary" onClick={() => uploader.retry()}>
                    <RetryIcon className="size-4" />
                    Retry failed
                  </Button>
                )}
              </>
            )
          }
        />
      )}
    </>
  );
}

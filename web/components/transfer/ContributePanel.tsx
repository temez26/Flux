"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { errorMessage, type TransferMeta } from "@/lib/api";
import { getDevice } from "@/lib/device";
import { formatBytes, plural } from "@/lib/format";
import { reloadTransfer, useLeaveGuard, useNotifyWhen, useTitle, useWakeLock } from "@/lib/hooks";
import { contribute, contributions } from "@/lib/session";
import { toast } from "@/lib/toast";
import { FileBrowser } from "../FileList";
import { AlertIcon, CheckIcon, FolderIcon, PauseIcon, PlayIcon, PlusIcon, RetryIcon, UploadIcon } from "../icons";
import { canPickFolder, useFilePickers } from "../picker";
import { PreviewDialog } from "../preview/Preview";
import { Button, Card, SectionTitle, Spinner, StatusCard, type StatusProps } from "../ui";
import { MetaRow, MetaTile, SelectionDownload, pageTitle, percent, subscribeNothing, versionZero } from "./common";

/**
 * Someone else's collection: add files to it, follow those uploads, and see what is already
 * there. Upload progress for each file shows in the listing as the server fills in.
 */
export function ContributePanel({ meta }: { meta: TransferMeta }) {
  const [uploader, setUploader] = useState(() => contributions.get(meta.code));
  const [adding, setAdding] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const paths = useMemo(() => meta.files.map((f) => f.path), [meta]);
  const folders = canPickFolder();
  useSyncExternalStore(uploader?.subscribe ?? subscribeNothing, uploader?.getVersion ?? versionZero, versionZero);
  useTitle(pageTitle(meta.code));

  const picker = useFilePickers(async (picked) => {
    if (!picked.length) return;
    setAdding(true);
    try {
      setUploader(await contribute(meta.code, picked));
    } catch (err) {
      toast(errorMessage(err), "err");
      // Most likely it was closed since this page last looked.
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
      ? { tone: "err", icon: <AlertIcon />, title: "This collection has closed", subtitle: "It expired or was deleted before everything arrived." }
      : snapshot.finished && failed
        ? { tone: "err", icon: <AlertIcon />, title: `${plural(failed, "file")} didn't make it`, subtitle: "Retry them, or leave the rest as they are." }
        : snapshot.finished
          ? { tone: "ok", icon: <CheckIcon />, title: "Your files are in", subtitle: "Uploaded and verified." }
          : uploader.paused
            ? { tone: "warn", icon: <PauseIcon />, title: "Paused", subtitle: "Resume to finish adding your files." }
            : { tone: "accent", icon: <Spinner className="size-5" />, title: "Adding your files", subtitle: "Keep this page open until it finishes." };
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<FolderIcon className="size-4.5" />}>{meta.title}</SectionTitle>
        {meta.closed ? (
          <p className="text-sm text-muted">
            This collection is closed, so nothing more can be added. Anyone with the code can still download what&apos;s here.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Someone is collecting files here. Yours go into a folder named <span className="font-medium text-fg">{getDevice().name}</span>, and
              anyone with the code can download what&apos;s here.
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
          </>
        )}
      </Card>

      {uploader && snapshot && status && (
        <StatusCard
          {...status}
          percent={percent(snapshot.sent, snapshot.total)}
          progress={snapshot.total ? snapshot.sent / snapshot.total : 1}
          stats={[
            ["Files", `${snapshot.counts.done.toLocaleString()} / ${(uploader.items.length - snapshot.counts.canceled).toLocaleString()}`],
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

      {meta.files.length ? (
        <FileBrowser
          paths={paths}
          renderRow={(i) => <MetaRow file={meta.files[i]} code={meta.code} downloadable counted onPreview={setPreviewing} />}
          renderTile={(i) => <MetaTile file={meta.files[i]} code={meta.code} onPreview={setPreviewing} />}
          select={(indices) => <SelectionDownload code={meta.code} files={indices.map((i) => meta.files[i])} counted />}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">Nothing here yet — yours can be the first.</p>
      )}
      <PreviewDialog code={meta.code} files={meta.files} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

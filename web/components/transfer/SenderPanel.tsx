"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { errorMessage } from "@/lib/api";
import { formatBytes, formatCode, formatDuration, plural } from "@/lib/format";
import { useLeaveGuard, useNotifyWhen, useNow, useTitle, useTransferMeta, useWakeLock } from "@/lib/hooks";
import { canPreview } from "@/lib/preview";
import type { Item, Uploader } from "@/lib/upload";
import { addFiles, type Session } from "@/lib/session";
import { toast } from "@/lib/toast";
import { FileBrowser, FileRow } from "../FileList";
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, PauseIcon, PlayIcon, PlusIcon, RetryIcon, ZapIcon } from "../icons";
import { useFilePickers } from "../picker";
import { InlinePreview, PreviewDialog } from "../preview/Preview";
import { ShareCard } from "../ShareCard";
import { Badge, Button, ConfirmButton, IconButton, Spinner, StatusCard, type StatusProps } from "../ui";
import { MetaRow, MetaTile, Pinned, inFlight, pageTitle, percent, removeOwnedFile, removeTransfer } from "./common";

function senderStatus(session: Session, uploader: Uploader): StatusProps {
  const { counts, finished, reconnecting } = uploader.snapshot;
  if (uploader.gone) {
    return { tone: "err", icon: <AlertIcon />, title: "Transfer no longer available", subtitle: "It expired or was deleted, so it can't be downloaded any more." };
  }
  if (finished && counts.failed) {
    return { tone: "err", icon: <AlertIcon />, title: `${plural(counts.failed, "file")} failed`, subtitle: "Retry them, or cancel them to share the rest." };
  }
  if (finished) return { tone: "ok", icon: <CheckIcon />, title: "Ready to receive", subtitle: "Every file is uploaded and verified." };
  if (session.delivered && uploader.paused) {
    return { tone: "ok", icon: <ZapIcon />, title: "Delivered directly", subtitle: "The receiver has everything. Resume to also keep a copy on the server." };
  }
  if (uploader.held) return { tone: "accent", icon: <ZapIcon />, title: "Sending directly", subtitle: "A receiver is downloading straight from this device." };
  if (uploader.paused) return { tone: "warn", icon: <PauseIcon />, title: "Paused", subtitle: "Resume to continue uploading." };
  if (reconnecting) return { tone: "warn", icon: <Spinner className="size-5" />, title: "Reconnecting…", subtitle: "The connection dropped. Retrying automatically." };
  return { tone: "accent", icon: <Spinner className="size-5" />, title: "Uploading", subtitle: "Keep this page open until it finishes." };
}

/** This tab's own upload, from the moment the files were picked until every one is stored. */
export function SenderPanel({ session, uploader, expiresAt }: { session: Session; uploader: Uploader; expiresAt?: string }) {
  const { host } = session;
  useSyncExternalStore(uploader.subscribe, uploader.getVersion, uploader.getVersion);
  useSyncExternalStore(host.subscribe, host.getVersion, host.getVersion);
  const now = useNow(30_000);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const { total, sent, counts, speed, finished } = uploader.snapshot;
  const running = !finished && !uploader.paused;
  const serving = host.receivers > 0;
  const expired = !!expiresAt && Date.parse(expiresAt) <= now;
  // Previews read the server's copy, so the sender only needs its metadata once the upload
  // is done; until then the uploader's own state is all this panel shows.
  const { meta } = useTransferMeta(uploader.code, finished);
  const previewable = useMemo(() => new Set(meta?.files.filter(canPreview).map((f) => f.idx) ?? []), [meta]);
  const single = meta?.files.length === 1 ? meta.files[0] : null;
  const metaPaths = useMemo(() => meta?.files.map((f) => f.path) ?? [], [meta]);
  // Files added part way through lengthen the same list, so its length is part of what it depends on.
  const itemCount = uploader.items.length;
  const itemPaths = useMemo(() => uploader.items.slice(0, itemCount).map((i) => i.path), [uploader, itemCount]);
  const [adding, setAdding] = useState(false);
  const adder = useFilePickers(async (picked) => {
    if (!picked.length) return;
    setAdding(true);
    try {
      await addFiles(uploader.code, uploader.token, picked);
      toast(`Added ${plural(picked.length, "file")}`);
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setAdding(false);
    }
  });
  useWakeLock(running || serving);
  useLeaveGuard(!finished || serving);
  const code = formatCode(uploader.code);
  useNotifyWhen(finished && !counts.failed && !uploader.gone, "Upload finished", `${code} is ready to receive`);
  useNotifyWhen(finished && counts.failed > 0 && !uploader.gone, "Upload stopped", `${plural(counts.failed, "file")} in ${code} failed`);
  useNotifyWhen(serving, "A device is downloading", `${code}, straight from this device`);
  useTitle(running ? `${percent(sent, total)}% uploaded · Flux` : pageTitle(uploader.code));

  // The server deletes expired transfers, so stop uploading and serving at the same moment.
  useEffect(() => {
    if (!expired) return;
    uploader.markGone();
    host.close();
  }, [expired, uploader, host]);

  const files = uploader.items.length - counts.canceled;
  const delivered = session.delivered && uploader.paused && !finished;
  const stats: [string, string][] = [
    ["Files", `${counts.done.toLocaleString()} / ${files.toLocaleString()}`],
    ["Uploaded", `${formatBytes(sent)} / ${formatBytes(total)}`],
  ];
  if (finished && meta) stats.push(["Downloads", meta.downloads.toLocaleString()]);
  if (running && !uploader.held) {
    stats.push(["Speed", speed > 0 ? `${formatBytes(speed)}/s` : "–"], ["Time left", speed > 0 ? formatDuration((total - sent) / speed) : "–"]);
  }

  return (
    <div className="space-y-4">
      <ShareCard code={uploader.code} expiresAt={expiresAt} />
      <StatusCard
        {...senderStatus(session, uploader)}
        percent={percent(sent, total)}
        progress={total ? sent / total : 1}
        stats={stats}
        actions={
          <>
            {!finished && (
              <Button onClick={() => (uploader.paused ? uploader.resume() : uploader.pause())}>
                {uploader.paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
                {uploader.paused ? "Resume" : "Pause"}
              </Button>
            )}
            {counts.failed > 0 && !uploader.gone && (
              <Button variant="primary" onClick={() => uploader.retry()}>
                <RetryIcon className="size-4" />
                Retry failed
              </Button>
            )}
            {!uploader.gone && (
              <Button onClick={() => adder.open("files")} disabled={adding}>
                {adding || adder.waiting ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
                Add files
              </Button>
            )}
          </>
        }
        danger={
          <ConfirmButton onConfirm={() => removeTransfer(uploader.code, uploader.token)}>
            {uploader.gone ? "Remove" : finished || delivered ? "Delete transfer" : "Cancel transfer"}
          </ConfirmButton>
        }
      >
        {adder.inputs}
        {serving && (
          <div className="mt-4">
            <Badge tone="ok" icon={<ZapIcon />}>
              Receiver connected directly{host.sent > 0 ? ` · ${formatBytes(host.sent)} sent` : ""}
            </Badge>
          </div>
        )}
        {single && previewable.has(single.idx) && <InlinePreview code={uploader.code} file={single} onExpand={() => setPreviewing(single.idx)} />}
      </StatusCard>
      <Pinned title="Now uploading">
        {inFlight(uploader.items, finished).map((item) => (
          <UploadRow key={item.idx} item={item} uploader={uploader} />
        ))}
      </Pinned>
      {meta && !counts.failed ? (
        <FileBrowser
          paths={metaPaths}
          renderRow={(i) => (
            <MetaRow
              file={meta.files[i]}
              code={uploader.code}
              downloadable={false}
              onPreview={setPreviewing}
              onRemove={meta.files.length > 1 ? () => removeOwnedFile(uploader.code, uploader.token, meta.files[i]) : undefined}
            />
          )}
          renderTile={(i) => <MetaTile file={meta.files[i]} code={uploader.code} onPreview={setPreviewing} />}
        />
      ) : (
        <FileBrowser
          paths={itemPaths}
          renderRow={(i) => (
            <UploadRow
              item={uploader.items[i]}
              uploader={uploader}
              onPreview={previewable.has(uploader.items[i].idx) ? () => setPreviewing(uploader.items[i].idx) : undefined}
            />
          )}
        />
      )}
      <PreviewDialog code={uploader.code} files={meta?.files ?? []} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

function UploadRow({ item, uploader, onPreview }: { item: Item; uploader: Uploader; onPreview?: () => void }) {
  const pct = item.size ? item.sent / item.size : 0;
  const label = `${Math.floor(pct * 100)}%`;
  const cancel = (
    <IconButton label={`Cancel ${item.path}`} onClick={() => uploader.cancel(item.idx)}>
      <CloseIcon className="size-4" />
    </IconButton>
  );
  switch (item.status) {
    case "active":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          badge={
            item.reconnecting ? (
              <Badge tone="warn" icon={<Spinner />}>
                Reconnecting
              </Badge>
            ) : (
              <Badge tone="accent" icon={<Spinner />}>
                {label}
              </Badge>
            )
          }
          progress={pct}
          progressTone={item.reconnecting ? "warn" : "accent"}
          actions={cancel}
        />
      );
    case "pending":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          badge={
            item.sent ? (
              <Badge tone="warn" icon={<PauseIcon />}>
                Paused {label}
              </Badge>
            ) : (
              <Badge icon={<ClockIcon />}>Waiting</Badge>
            )
          }
          actions={cancel}
        />
      );
    case "done":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          onOpen={onPreview}
          badge={
            <Badge tone="ok" icon={<CheckIcon />}>
              Uploaded
            </Badge>
          }
        />
      );
    case "canceled":
      return <FileRow path={item.path} size={item.size} badge={<Badge>Canceled</Badge>} />;
    case "failed":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          badge={
            <Badge tone="err" icon={<AlertIcon />}>
              {item.error ?? "Failed"}
            </Badge>
          }
          actions={
            !uploader.gone && (
              <>
                <IconButton label={`Retry ${item.path}`} onClick={() => uploader.retry(item.idx)}>
                  <RetryIcon className="size-4" />
                </IconButton>
                {cancel}
              </>
            )
          }
        />
      );
  }
}

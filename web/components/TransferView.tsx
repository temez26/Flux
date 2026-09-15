"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from "react";
import { deleteTransfer, errorMessage, fileUrl, zipUrl, type FileMeta, type TransferMeta } from "@/lib/api";
import { DirectClient } from "@/lib/direct";
import { basename, fromFileList } from "@/lib/files";
import { formatBytes, formatCode, formatDuration, formatRemaining, plural } from "@/lib/format";
import { useFilePicker, useLeaveGuard, useNow, useTitle, useTransferMeta, useWakeLock } from "@/lib/hooks";
import { getOwned, removeOwned } from "@/lib/owned";
import { canPreview } from "@/lib/preview";
import { Receiver, type ReceiveItem } from "@/lib/receive";
import { navigate } from "@/lib/router";
import { memorySink, saveMethod, streamSink, type SaveMethod } from "@/lib/save";
import { end, live, resume, type Session } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Item } from "@/lib/upload";
import { singleTarget, zipTarget } from "@/lib/zip";
import { FileBrowser, FileRow, FileTile } from "./FileList";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  FileTypeIcon,
  FolderIcon,
  PauseIcon,
  PlayIcon,
  RetryIcon,
  UploadIcon,
  ZapIcon,
} from "./icons";
import { FileThumb, InlinePreview, PreviewDialog } from "./Preview";
import { ShareCard } from "./ShareCard";
import { Badge, Button, Card, ConfirmButton, IconButton, Message, ProgressBar, Spinner, StatusCard, buttonClass, type StatusProps } from "./ui";

const pageTitle = (code: string) => `${formatCode(code)} · Flux`;

export default function TransferView({ code }: { code: string }) {
  const [session, setSession] = useState(() => live.get(code));
  const owned = useMemo(() => getOwned(code), [code]);
  const { meta, offline } = useTransferMeta(code, !session);
  // Panels set their own title (with progress); this covers the loading and error screens.
  useTitle(session || meta ? undefined : pageTitle(code));

  useEffect(() => {
    if (meta === null) removeOwned(code);
  }, [meta, code]);

  if (session) return <SenderPanel session={session} expiresAt={owned?.expiresAt} />;
  if (meta === undefined) {
    return offline ? (
      <Message icon={<AlertIcon />} title="Can't reach the Flux server">
        Check your connection. This page retries automatically.
      </Message>
    ) : (
      <Message icon={<Spinner className="size-5" />} title="Loading…" />
    );
  }
  if (meta === null) {
    return (
      <Message icon={<ClockIcon />} title="Transfer not found">
        It may have expired or been deleted.
      </Message>
    );
  }
  return (
    <>
      {offline && <ConnectionBanner />}
      {owned ? <OwnerPanel meta={meta} token={owned.token} onResume={setSession} /> : <ReceiverPanel meta={meta} />}
    </>
  );
}

/** Shown while the server can't be reached, so the page isn't mistaken for up to date. */
function ConnectionBanner() {
  return (
    <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
      <Spinner className="size-4 shrink-0" />
      Lost connection to the server. Retrying…
    </p>
  );
}

async function removeTransfer(code: string, token: string) {
  end(code);
  removeOwned(code);
  navigate("/", true);
  toast("Transfer deleted");
  await deleteTransfer(code, token).catch(() => {});
}

const percent = (part: number, whole: number) => (whole ? Math.floor((part / whole) * 100) : 100);
const small = "size-3";

/** In long lists the files in flight are rarely on screen, so they are pinned above the list. */
function inFlight<T extends { status: string }>(items: T[], finished: boolean): T[] {
  return items.length > 8 && !finished ? items.filter((item) => item.status === "active") : [];
}

function Pinned({ title, children }: { title: string; children: ReactNode[] }) {
  if (!children.length) return null;
  return (
    <section>
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {children.map((child, i) => (
        <div key={i} className="h-15">
          {child}
        </div>
      ))}
    </section>
  );
}

function senderStatus(session: Session): StatusProps {
  const { uploader } = session;
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

function SenderPanel({ session, expiresAt }: { session: Session; expiresAt?: string }) {
  const { uploader, host } = session;
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
  const itemPaths = useMemo(() => uploader.items.map((i) => i.path), [uploader]);
  useWakeLock(running || serving);
  useLeaveGuard(!finished || serving);
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
  if (running && !uploader.held) {
    stats.push(["Speed", speed > 0 ? `${formatBytes(speed)}/s` : "–"], ["Time left", speed > 0 ? formatDuration((total - sent) / speed) : "–"]);
  }

  return (
    <div className="space-y-4">
      <ShareCard code={uploader.code} expiresAt={expiresAt} />
      <StatusCard
        {...senderStatus(session)}
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
          </>
        }
        danger={
          <ConfirmButton onConfirm={() => removeTransfer(uploader.code, uploader.token)}>
            {uploader.gone ? "Remove" : finished || delivered ? "Delete transfer" : "Cancel transfer"}
          </ConfirmButton>
        }
      >
        {serving && (
          <div className="mt-4">
            <Badge tone="ok" icon={<ZapIcon className={small} />}>
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
          renderRow={(i) => <MetaRow file={meta.files[i]} code={uploader.code} downloadable={false} onPreview={setPreviewing} />}
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

function UploadRow({ item, uploader, onPreview }: { item: Item; uploader: Session["uploader"]; onPreview?: () => void }) {
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
              <Badge tone="warn" icon={<Spinner className={small} />}>
                Reconnecting
              </Badge>
            ) : (
              <Badge tone="accent" icon={<Spinner className={small} />}>
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
              <Badge tone="warn" icon={<PauseIcon className={small} />}>
                Paused {label}
              </Badge>
            ) : (
              <Badge icon={<ClockIcon className={small} />}>Waiting</Badge>
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
            <Badge tone="ok" icon={<CheckIcon className={small} />}>
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
            <Badge tone="err" icon={<AlertIcon className={small} />}>
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

function summarize(files: FileMeta[]) {
  let size = 0;
  let received = 0;
  let complete = 0;
  for (const f of files) {
    size += f.size;
    received += f.received;
    if (f.hash) complete++;
  }
  return { size, received, complete, ready: complete === files.length };
}

function MetaTile({ file, code, onPreview }: { file: FileMeta; code: string; onPreview: (idx: number) => void }) {
  return (
    <FileTile
      path={file.path}
      size={file.size}
      thumb={<FileThumb code={code} file={file} className="size-7" />}
      onOpen={canPreview(file) ? () => onPreview(file.idx) : undefined}
      badge={
        !file.hash && (
          <Badge icon={<ClockIcon className={small} />}>
            {file.received > 0 ? `${Math.floor((file.received / file.size) * 100)}%` : "Waiting"}
          </Badge>
        )
      }
    />
  );
}

function MetaRow({ file, code, downloadable, onPreview }: { file: FileMeta; code: string; downloadable: boolean; onPreview: (idx: number) => void }) {
  if (file.hash) {
    return (
      <FileRow
        path={file.path}
        size={file.size}
        thumb={<FileThumb code={code} file={file} className="size-4.5" />}
        onOpen={canPreview(file) ? () => onPreview(file.idx) : undefined}
        badge={
          !downloadable && (
            <Badge tone="ok" icon={<CheckIcon className={small} />}>
              Uploaded
            </Badge>
          )
        }
        actions={
          downloadable && (
            <a href={fileUrl(code, file.idx)} download className={buttonClass("ghost", "min-h-10 px-3 text-accent")} aria-label={`Download ${basename(file.path)}`}>
              <DownloadIcon className="size-4" />
            </a>
          )
        }
      />
    );
  }
  const pct = file.size ? file.received / file.size : 0;
  return file.received > 0 ? (
    <FileRow
      path={file.path}
      size={file.size}
      badge={
        <Badge tone="accent" icon={<Spinner className={small} />}>
          Uploading {Math.floor(pct * 100)}%
        </Badge>
      }
      progress={pct}
    />
  ) : (
    <FileRow path={file.path} size={file.size} badge={<Badge icon={<ClockIcon className={small} />}>Waiting</Badge>} />
  );
}

function checksumsUrl(meta: TransferMeta): string {
  // b3sum-compatible, so a download can be verified with `b3sum -c`.
  const lines = meta.files.filter((f) => f.hash).map((f) => `${f.hash}  ${f.path}\n`);
  return URL.createObjectURL(new Blob(lines, { type: "text/plain" }));
}

const subscribeNothing = () => () => {};
const versionZero = () => 0;

function TransferHeading({ meta, badges }: { meta: TransferMeta; badges?: ReactNode }) {
  const now = useNow(60_000);
  const { size } = summarize(meta.files);
  const single = meta.files.length === 1 ? meta.files[0] : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>
          <span className="font-mono">{formatCode(meta.code)}</span>
        </Badge>
        <Badge icon={<ClockIcon className={small} />}>{formatRemaining(meta.expiresAt, now)}</Badge>
        {badges}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          {single ? <FileTypeIcon path={single.path} className="size-6" /> : <FolderIcon className="size-6" />}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{single ? basename(single.path) : plural(meta.files.length, "file")}</h1>
          <p className="text-sm text-muted">{formatBytes(size)}</p>
        </div>
      </div>
    </>
  );
}

function ReceiverPanel({ meta }: { meta: TransferMeta }) {
  const { size, received, complete, ready } = summarize(meta.files);
  const [initial] = useState({ ready, size });
  const [method, setMethod] = useState<SaveMethod | null>(null);
  const [direct, setDirect] = useState<DirectClient>();
  const [receiver, setReceiver] = useState<Receiver>();
  const [error, setError] = useState<string>();
  const [previewing, setPreviewing] = useState<number | null>(null);
  const paths = useMemo(() => meta.files.map((f) => f.path), [meta]);
  useSyncExternalStore(direct?.subscribe ?? subscribeNothing, direct?.getVersion ?? versionZero, versionZero);
  useTitle(pageTitle(meta.code));

  useEffect(() => {
    let alive = true;
    let client: DirectClient | undefined;
    void saveMethod(initial.size).then((m) => {
      if (!alive) return;
      setMethod(m);
      // A direct connection is only useful while the server doesn't have everything yet.
      if (m && !initial.ready) setDirect((client = new DirectClient(meta.code)));
    });
    return () => {
      alive = false;
      client?.close();
    };
  }, [initial, meta.code]);

  useEffect(() => {
    receiver?.update(meta);
  }, [receiver, meta]);

  if (receiver) return <ReceivingPanel receiver={receiver} meta={meta} />;

  const single = meta.files.length === 1 ? meta.files[0] : null;
  const directOpen = direct?.state === "open";
  const viaDirect = directOpen && !ready;

  async function startDirect() {
    if (!direct || !method) return;
    setError(undefined);
    try {
      const name = single ? basename(single.path) : `flux-${meta.code}.zip`;
      const sink = method === "stream" ? await streamSink(name, single?.size) : memorySink(name);
      const next = new Receiver(meta, direct, single ? singleTarget(sink) : zipTarget(sink));
      next.start();
      setReceiver(next);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const label = (
    <>
      <DownloadIcon className="size-5" />
      {single ? "Download" : "Download all"}
    </>
  );
  const primary = "w-full min-h-12 text-base sm:w-auto sm:min-w-52";

  return (
    <div className="space-y-4">
      <Card>
        <TransferHeading
          meta={meta}
          badges={
            directOpen && (
              <Badge tone="ok" icon={<ZapIcon className={small} />}>
                Direct connection
              </Badge>
            )
          }
        />

        {viaDirect && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-ok/10 p-3 text-sm text-ok">
            <ZapIcon className="mt-0.5 size-4 shrink-0" />
            The sender is online, so files come straight from their device.
          </p>
        )}
        {!ready && !viaDirect && (
          <div className="mt-4 rounded-xl bg-hover p-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <Spinner className="size-4 text-accent" />
              <span className="flex-1">Waiting for the sender to finish uploading</span>
              <span className="font-medium tabular-nums">{percent(received, size)}%</span>
            </div>
            <ProgressBar value={size ? received / size : 0} />
            <p className="mt-2 text-xs text-muted">
              {complete.toLocaleString()} of {plural(meta.files.length, "file")} ready. Uploaded files can already be downloaded below.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {viaDirect ? (
            <Button variant="primary" className={primary} onClick={startDirect}>
              {label}
            </Button>
          ) : (
            <a href={single ? fileUrl(meta.code, single.idx) : zipUrl(meta.code)} download aria-disabled={!ready} className={buttonClass("primary", primary)}>
              {label}
            </a>
          )}
          {complete > 0 && (
            <a
              href="#"
              onClick={(e) => {
                e.currentTarget.href = checksumsUrl(meta);
              }}
              download={`flux-${meta.code}.b3`}
              className={buttonClass("ghost")}
            >
              Checksums
            </a>
          )}
        </div>
        {error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-err">
            <AlertIcon className="size-4 shrink-0" />
            {error}
          </p>
        )}
        {!single && (ready || viaDirect) && <p className="mt-3 text-xs text-muted">Everything downloads as one .zip file.</p>}
        {single && canPreview(single) && <InlinePreview code={meta.code} file={single} onExpand={() => setPreviewing(single.idx)} />}
      </Card>
      {!single && (
        <FileBrowser
          paths={paths}
          renderRow={(i) => <MetaRow file={meta.files[i]} code={meta.code} downloadable onPreview={setPreviewing} />}
          renderTile={(i) => <MetaTile file={meta.files[i]} code={meta.code} onPreview={setPreviewing} />}
        />
      )}
      <PreviewDialog code={meta.code} files={meta.files} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

function receivingStatus(receiver: Receiver): StatusProps {
  const { finished, paused, error } = receiver;
  if (finished && !error) return { tone: "ok", icon: <CheckIcon />, title: "Download complete", subtitle: "Saved to your downloads. Every file was verified." };
  if (error === "Canceled") return { tone: "muted", icon: <CloseIcon />, title: "Download canceled" };
  if (error) return { tone: "err", icon: <AlertIcon />, title: "Download failed", subtitle: error };
  if (paused) return { tone: "warn", icon: <PauseIcon />, title: "Paused", subtitle: "Resume to continue." };
  return { tone: "accent", icon: <Spinner className="size-5" />, title: "Downloading", subtitle: "Keep this page open until it finishes." };
}

function ReceivingPanel({ receiver, meta }: { receiver: Receiver; meta: TransferMeta }) {
  useSyncExternalStore(receiver.subscribe, receiver.getVersion, receiver.getVersion);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const { total, received, done, speed } = receiver.snapshot;
  const { finished, paused } = receiver;
  const running = !finished && !paused;
  // Previews read the server's copy, which can still be filling in while (and after) the
  // download runs, so this follows the polled metadata rather than the receiver's own state.
  const previewable = useMemo(() => new Set(meta.files.filter(canPreview).map((f) => f.idx)), [meta]);
  const single = meta.files.length === 1 ? meta.files[0] : null;
  const paths = useMemo(() => receiver.items.map((i) => i.path), [receiver]);
  useWakeLock(running);
  useLeaveGuard(!finished);
  useTitle(running ? `${percent(received, total)}% downloaded · Flux` : undefined);

  const stats: [string, string][] = [
    ["Files", `${done.toLocaleString()} / ${receiver.items.length.toLocaleString()}`],
    ["Received", `${formatBytes(received)} / ${formatBytes(total)}`],
  ];
  if (running) {
    stats.push(["Speed", speed > 0 ? `${formatBytes(speed)}/s` : "–"], ["Time left", speed > 0 ? formatDuration((total - received) / speed) : "–"]);
  }

  return (
    <div className="space-y-4">
      <StatusCard
        {...receivingStatus(receiver)}
        percent={percent(received, total)}
        progress={total ? received / total : 1}
        stats={stats}
        actions={
          !finished && (
            <Button onClick={() => (paused ? receiver.resume() : receiver.pause())}>
              {paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
          )
        }
        danger={!finished && <ConfirmButton onConfirm={() => receiver.cancel()}>Cancel</ConfirmButton>}
      >
        {receiver.items.some((item) => item.source === "direct") && (
          <div className="mt-4">
            <Badge tone="ok" icon={<ZapIcon className={small} />}>
              Direct from the sender · {formatCode(meta.code)}
            </Badge>
          </div>
        )}
        {finished && single && previewable.has(single.idx) && <InlinePreview code={meta.code} file={single} onExpand={() => setPreviewing(single.idx)} />}
      </StatusCard>
      <Pinned title="Now receiving">
        {inFlight(receiver.items, finished).map((item) => (
          <ReceiveRow key={item.idx} item={item} />
        ))}
      </Pinned>
      <FileBrowser
        paths={paths}
        renderRow={(i) => <ReceiveRow item={receiver.items[i]} onPreview={previewable.has(receiver.items[i].idx) ? () => setPreviewing(receiver.items[i].idx) : undefined} />}
      />
      <PreviewDialog code={meta.code} files={meta.files} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

function ReceiveRow({ item, onPreview }: { item: ReceiveItem; onPreview?: () => void }) {
  const pct = item.size ? item.received / item.size : 0;
  switch (item.status) {
    case "active":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          badge={
            item.reconnecting ? (
              <Badge tone="warn" icon={<Spinner className={small} />}>
                Reconnecting
              </Badge>
            ) : (
              <Badge tone="accent" icon={item.source === "direct" ? <ZapIcon className={small} /> : <Spinner className={small} />}>
                {Math.floor(pct * 100)}%
              </Badge>
            )
          }
          progress={pct}
          progressTone={item.reconnecting ? "warn" : "accent"}
        />
      );
    case "pending":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          badge={
            item.received ? (
              <Badge tone="warn" icon={<ClockIcon className={small} />}>
                Waiting for sender
              </Badge>
            ) : (
              <Badge icon={<ClockIcon className={small} />}>Waiting</Badge>
            )
          }
        />
      );
    case "done":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          onOpen={onPreview}
          badge={
            <Badge tone="ok" icon={<CheckIcon className={small} />}>
              Received
            </Badge>
          }
        />
      );
    case "failed":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          badge={
            <Badge tone="err" icon={<AlertIcon className={small} />}>
              {item.error ?? "Not received"}
            </Badge>
          }
        />
      );
  }
}

const folderInputProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;

function OwnerPanel({ meta, token, onResume }: { meta: TransferMeta; token: string; onResume: (s: Session) => void }) {
  const { complete, ready, size, received } = summarize(meta.files);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const canPickFolder = window.matchMedia("(pointer: fine)").matches;
  const [previewing, setPreviewing] = useState<number | null>(null);
  const paths = useMemo(() => meta.files.map((f) => f.path), [meta]);
  const picker = useFilePicker();
  useTitle(pageTitle(meta.code));

  function receive(e: { target: HTMLInputElement }) {
    picker.settle();
    const picked = fromFileList(e.target.files);
    e.target.value = "";
    if (picked.length) onResume(resume(meta, token, picked));
  }

  const status: StatusProps = ready
    ? { tone: "ok", icon: <CheckIcon />, title: "Ready to receive", subtitle: "Every file is uploaded and verified." }
    : { tone: "warn", icon: <AlertIcon />, title: "Upload interrupted", subtitle: "Add the same files again to continue where it stopped." };

  return (
    <div className="space-y-4">
      <ShareCard code={meta.code} expiresAt={meta.expiresAt} />
      <StatusCard
        {...status}
        percent={percent(received, size)}
        progress={size ? received / size : 1}
        stats={[
          ["Files", `${complete.toLocaleString()} / ${meta.files.length.toLocaleString()}`],
          ["Uploaded", `${formatBytes(received)} / ${formatBytes(size)}`],
        ]}
        actions={
          !ready && (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  picker.arm();
                  fileInput.current?.click();
                }}
              >
                {picker.waiting ? <Spinner className="size-4" /> : <UploadIcon className="size-4" />}
                {picker.waiting ? "Getting your files…" : "Add files"}
              </Button>
              {canPickFolder && (
                <Button
                  onClick={() => {
                    picker.arm();
                    folderInput.current?.click();
                  }}
                >
                  <FolderIcon className="size-4" />
                  Add folder
                </Button>
              )}
            </>
          )
        }
        danger={<ConfirmButton onConfirm={() => removeTransfer(meta.code, token)}>Delete transfer</ConfirmButton>}
      >
        <input ref={fileInput} type="file" multiple hidden onChange={receive} />
        <input ref={folderInput} type="file" hidden {...folderInputProps} onChange={receive} />
      </StatusCard>
      <FileBrowser
        paths={paths}
        renderRow={(i) => <MetaRow file={meta.files[i]} code={meta.code} downloadable={false} onPreview={setPreviewing} />}
        renderTile={(i) => <MetaTile file={meta.files[i]} code={meta.code} onPreview={setPreviewing} />}
      />
      <PreviewDialog code={meta.code} files={meta.files} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

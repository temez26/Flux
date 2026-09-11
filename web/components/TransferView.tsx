"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from "react";
import { deleteTransfer, errorMessage, fileUrl, zipUrl, type FileMeta, type TransferMeta } from "@/lib/api";
import { DirectClient } from "@/lib/direct";
import { basename, fromFileList } from "@/lib/files";
import { formatBytes, formatCode, formatDuration, formatRemaining, plural } from "@/lib/format";
import { useLeaveGuard, useNow, useTransferMeta, useWakeLock } from "@/lib/hooks";
import { getOwned, removeOwned } from "@/lib/owned";
import { Receiver, type ReceiveItem } from "@/lib/receive";
import { navigate } from "@/lib/router";
import { memorySink, saveMethod, streamSink, type SaveMethod } from "@/lib/save";
import { end, live, resume, type Session } from "@/lib/session";
import type { Item } from "@/lib/upload";
import { singleTarget, zipTarget } from "@/lib/zip";
import { FileList, FileRow } from "./FileList";
import { CheckIcon, CloseIcon, DownloadIcon, PauseIcon, PlayIcon, RetryIcon, UploadIcon } from "./icons";
import { ShareCard } from "./ShareCard";
import { Button, Card, ConfirmButton, Message, ProgressBar, buttonClass, iconButtonClass } from "./ui";

export default function TransferView({ code }: { code: string }) {
  const [session, setSession] = useState(() => live.get(code));
  const owned = useMemo(() => getOwned(code), [code]);
  const { meta, offline } = useTransferMeta(code, !session);

  useEffect(() => {
    document.title = `${formatCode(code)} · Flux`;
    return () => void (document.title = "Flux");
  }, [code]);

  useEffect(() => {
    if (meta === null) removeOwned(code);
  }, [meta, code]);

  if (session) return <SenderPanel session={session} expiresAt={owned?.expiresAt} />;
  if (meta === undefined) return <Message title={offline ? "Can't reach the Flux server" : "Loading…"} />;
  if (meta === null) return <Message title="Transfer not found">It may have expired or been deleted.</Message>;
  if (owned) return <OwnerPanel meta={meta} token={owned.token} onResume={setSession} />;
  return <ReceiverPanel meta={meta} />;
}

async function removeTransfer(code: string, token: string) {
  end(code);
  removeOwned(code);
  navigate("/", true);
  await deleteTransfer(code, token).catch(() => {});
}

const percent = (part: number, whole: number) => (whole ? Math.floor((part / whole) * 100) : 100);

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

function DirectBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-xs font-medium text-ok">
      <span className="size-1.5 rounded-full bg-ok" />
      Direct connection
    </span>
  );
}

function SenderPanel({ session, expiresAt }: { session: Session; expiresAt?: string }) {
  const { uploader, host } = session;
  useSyncExternalStore(uploader.subscribe, uploader.getVersion, uploader.getVersion);
  useSyncExternalStore(host.subscribe, host.getVersion, host.getVersion);
  const { total, sent, counts, speed, finished, reconnecting } = uploader.snapshot;
  const running = !finished && !uploader.paused;
  const serving = host.receivers > 0;
  useWakeLock(running || serving);
  useLeaveGuard(!finished || serving);

  const files = uploader.items.length - counts.canceled;
  const delivered = session.delivered && uploader.paused && !finished;
  const title = finished
    ? counts.failed
      ? `${plural(counts.failed, "file")} failed`
      : "Uploaded · ready to receive"
    : delivered
      ? "Delivered directly"
      : uploader.held
        ? "Sending directly…"
        : uploader.paused
          ? "Paused"
          : reconnecting
            ? "Reconnecting…"
            : "Uploading…";

  return (
    <div className="space-y-4">
      <ShareCard code={uploader.code} expiresAt={expiresAt} />
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="flex items-center gap-2 font-semibold">
            {(finished && !counts.failed) || delivered ? <CheckIcon className="size-5 text-ok" /> : null}
            {title}
          </h1>
          <span className="text-sm text-muted tabular-nums">{percent(sent, total)}%</span>
        </div>
        <div className="mt-3">
          <ProgressBar value={total ? sent / total : 1} />
        </div>
        <p className="mt-2 text-sm text-muted tabular-nums">
          {counts.done.toLocaleString()} of {plural(files, "file")} on the server · {formatBytes(sent)} of {formatBytes(total)}
          {running && !uploader.held && speed > 0 && ` · ${formatBytes(speed)}/s · ${formatDuration((total - sent) / speed)} left`}
        </p>
        {serving && (
          <p className="mt-2 flex items-center gap-2 text-sm text-ok">
            <span className="size-2 rounded-full bg-ok" />
            Receiver connected directly{host.sent > 0 && ` · ${formatBytes(host.sent)} sent`}
          </p>
        )}
        {delivered && (
          <p className="mt-2 text-sm text-muted">Server upload paused. Resume it to also keep a copy there for others.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!finished && (
            <Button onClick={() => (uploader.paused ? uploader.resume() : uploader.pause())}>
              {uploader.paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
              {uploader.paused ? "Resume" : "Pause"}
            </Button>
          )}
          {counts.failed > 0 && (
            <Button onClick={() => uploader.retry()}>
              <RetryIcon className="size-4" />
              Retry failed
            </Button>
          )}
          <ConfirmButton onConfirm={() => removeTransfer(uploader.code, uploader.token)}>
            {finished || delivered ? "Delete transfer" : "Cancel transfer"}
          </ConfirmButton>
        </div>
      </Card>
      <Pinned title="Now uploading">
        {inFlight(uploader.items, finished).map((item) => (
          <UploadRow key={item.idx} item={item} uploader={session.uploader} />
        ))}
      </Pinned>
      <FileList
        count={uploader.items.length}
        renderRow={(i) => <UploadRow item={uploader.items[i]} uploader={uploader} />}
      />
    </div>
  );
}

function UploadRow({ item, uploader }: { item: Item; uploader: Session["uploader"] }) {
  const pct = item.size ? item.sent / item.size : 0;
  const cancel = (
    <button type="button" className={iconButtonClass} onClick={() => uploader.cancel(item.idx)} aria-label={`Cancel ${item.path}`}>
      <CloseIcon className="size-4" />
    </button>
  );
  switch (item.status) {
    case "active":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          status={item.reconnecting ? "Reconnecting…" : `${Math.floor(pct * 100)}%`}
          tone="accent"
          progress={pct}
          actions={cancel}
        />
      );
    case "pending":
      return <FileRow path={item.path} size={item.size} status={item.sent ? `Paused at ${Math.floor(pct * 100)}%` : "Waiting"} actions={cancel} />;
    case "done":
      return <FileRow path={item.path} size={item.size} status="Uploaded" tone="ok" />;
    case "canceled":
      return <FileRow path={item.path} size={item.size} status="Canceled" />;
    case "failed":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          status={item.error}
          tone="err"
          actions={
            <>
              <button type="button" className={iconButtonClass} onClick={() => uploader.retry(item.idx)} aria-label={`Retry ${item.path}`}>
                <RetryIcon className="size-4" />
              </button>
              {cancel}
            </>
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

function MetaRow({ file, code, downloadable }: { file: FileMeta; code: string; downloadable: boolean }) {
  if (file.hash) {
    return (
      <FileRow
        path={file.path}
        size={file.size}
        status={downloadable ? undefined : "Uploaded"}
        tone="ok"
        actions={
          downloadable && (
            <a href={fileUrl(code, file.idx)} download className={iconButtonClass} aria-label={`Download ${basename(file.path)}`}>
              <DownloadIcon className="size-4" />
            </a>
          )
        }
      />
    );
  }
  const pct = file.size ? file.received / file.size : 0;
  return file.received > 0 ? (
    <FileRow path={file.path} size={file.size} status={`Uploading ${Math.floor(pct * 100)}%`} tone="accent" progress={pct} />
  ) : (
    <FileRow path={file.path} size={file.size} status="Waiting for sender" />
  );
}

function checksumsUrl(meta: TransferMeta): string {
  // b3sum-compatible, so a download can be verified with `b3sum -c`.
  const lines = meta.files.filter((f) => f.hash).map((f) => `${f.hash}  ${f.path}\n`);
  return URL.createObjectURL(new Blob(lines, { type: "text/plain" }));
}

const subscribeNothing = () => () => {};
const versionZero = () => 0;

function ReceiverPanel({ meta }: { meta: TransferMeta }) {
  const now = useNow(60_000);
  const { size, received, complete, ready } = summarize(meta.files);
  const [initial] = useState({ ready, size });
  const [method, setMethod] = useState<SaveMethod | null>(null);
  const [direct, setDirect] = useState<DirectClient>();
  const [receiver, setReceiver] = useState<Receiver>();
  const [error, setError] = useState<string>();
  useSyncExternalStore(direct?.subscribe ?? subscribeNothing, direct?.getVersion ?? versionZero, versionZero);

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
  const title = single ? basename(single.path) : plural(meta.files.length, "file");
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
      <DownloadIcon className="size-4" />
      {single ? "Download" : "Download all"}
    </>
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-wider text-muted uppercase">{formatCode(meta.code)}</p>
          {directOpen && <DirectBadge />}
        </div>
        <h1 className="mt-1 text-xl font-semibold break-all">{title}</h1>
        <p className="mt-1 text-sm text-muted">
          {formatBytes(size)} · {formatRemaining(meta.expiresAt, now)}
        </p>
        {!ready && !viaDirect && (
          <div className="mt-4">
            <div className="mb-2 flex justify-between text-sm text-muted tabular-nums">
              <span>
                Waiting for the sender · {complete.toLocaleString()} of {plural(meta.files.length, "file")} ready
              </span>
              <span>{percent(received, size)}%</span>
            </div>
            <ProgressBar value={size ? received / size : 0} />
          </div>
        )}
        {viaDirect && <p className="mt-3 text-sm text-muted">The sender is online. Files come straight from their device.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {viaDirect ? (
            <Button variant="primary" className="min-w-40" onClick={startDirect}>
              {label}
            </Button>
          ) : (
            <a
              href={single ? fileUrl(meta.code, single.idx) : zipUrl(meta.code)}
              download
              aria-disabled={!ready}
              className={buttonClass("primary", "min-w-40")}
            >
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
              className={buttonClass("secondary")}
            >
              Checksums
            </a>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-err">{error}</p>}
        {!single && (ready || viaDirect) && (
          <p className="mt-3 text-xs text-muted">Downloads as a .zip. Uploaded files can also be downloaded one by one below.</p>
        )}
      </Card>
      {!single && (
        <FileList count={meta.files.length} renderRow={(i) => <MetaRow file={meta.files[i]} code={meta.code} downloadable />} />
      )}
    </div>
  );
}

function ReceivingPanel({ receiver, meta }: { receiver: Receiver; meta: TransferMeta }) {
  useSyncExternalStore(receiver.subscribe, receiver.getVersion, receiver.getVersion);
  const { total, received, done, speed } = receiver.snapshot;
  const { finished, paused, error } = receiver;
  const running = !finished && !paused;
  useWakeLock(running);
  useLeaveGuard(!finished);

  const title = finished
    ? error
      ? error === "Canceled"
        ? "Download canceled"
        : "Download failed"
      : "Downloaded · verified"
    : paused
      ? "Paused"
      : "Downloading…";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-wider text-muted uppercase">{formatCode(meta.code)}</p>
          {receiver.items.some((item) => item.source === "direct") && <DirectBadge />}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h1 className="flex items-center gap-2 font-semibold">
            {finished && !error && <CheckIcon className="size-5 text-ok" />}
            {title}
          </h1>
          <span className="text-sm text-muted tabular-nums">{percent(received, total)}%</span>
        </div>
        <div className="mt-3">
          <ProgressBar value={total ? received / total : 1} />
        </div>
        <p className="mt-2 text-sm text-muted tabular-nums">
          {done.toLocaleString()} of {plural(receiver.items.length, "file")} · {formatBytes(received)} of {formatBytes(total)}
          {running && speed > 0 && ` · ${formatBytes(speed)}/s · ${formatDuration((total - received) / speed)} left`}
        </p>
        {finished && !error && <p className="mt-2 text-sm text-muted">Saved to your downloads.</p>}
        {error && error !== "Canceled" && <p className="mt-2 text-sm text-err">{error}</p>}
        {!finished && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => (paused ? receiver.resume() : receiver.pause())}>
              {paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <ConfirmButton onConfirm={() => receiver.cancel()}>Cancel</ConfirmButton>
          </div>
        )}
      </Card>
      <Pinned title="Now receiving">
        {inFlight(receiver.items, finished).map((item) => (
          <ReceiveRow key={item.idx} item={item} />
        ))}
      </Pinned>
      <FileList count={receiver.items.length} renderRow={(i) => <ReceiveRow item={receiver.items[i]} />} />
    </div>
  );
}

function ReceiveRow({ item }: { item: ReceiveItem }) {
  const pct = item.size ? item.received / item.size : 0;
  switch (item.status) {
    case "active":
      return (
        <FileRow
          path={item.path}
          size={item.size}
          status={item.reconnecting ? "Reconnecting…" : `${Math.floor(pct * 100)}% · ${item.source}`}
          tone="accent"
          progress={pct}
        />
      );
    case "pending":
      return <FileRow path={item.path} size={item.size} status={item.received ? "Waiting for sender" : "Waiting"} />;
    case "done":
      return <FileRow path={item.path} size={item.size} status="Received" tone="ok" />;
    case "failed":
      return <FileRow path={item.path} size={item.size} status={item.error ?? "Not received"} tone="err" />;
  }
}

const folderInputProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;

function OwnerPanel({ meta, token, onResume }: { meta: TransferMeta; token: string; onResume: (s: Session) => void }) {
  const { complete, ready } = summarize(meta.files);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const canPickFolder = window.matchMedia("(pointer: fine)").matches;

  function pick(list: FileList | null) {
    const picked = fromFileList(list);
    if (picked.length) onResume(resume(meta, token, picked));
  }

  return (
    <div className="space-y-4">
      <ShareCard code={meta.code} expiresAt={meta.expiresAt} />
      <Card>
        <h1 className="flex items-center gap-2 font-semibold">
          {ready && <CheckIcon className="size-5 text-ok" />}
          {ready ? "Uploaded · ready to receive" : "Upload interrupted"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {complete.toLocaleString()} of {plural(meta.files.length, "file")} uploaded.
          {!ready && " Add the same files again to continue where it stopped."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!ready && (
            <>
              <Button variant="primary" onClick={() => fileInput.current?.click()}>
                <UploadIcon className="size-4" />
                Add files
              </Button>
              {canPickFolder && <Button onClick={() => folderInput.current?.click()}>Add folder</Button>}
            </>
          )}
          <ConfirmButton onConfirm={() => removeTransfer(meta.code, token)}>Delete transfer</ConfirmButton>
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => pick(e.target.files)} />
        <input ref={folderInput} type="file" hidden {...folderInputProps} onChange={(e) => pick(e.target.files)} />
      </Card>
      <FileList count={meta.files.length} renderRow={(i) => <MetaRow file={meta.files[i]} code={meta.code} downloadable={false} />} />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { errorMessage, fileUrl, zipUrl, type FileMeta, type TransferMeta } from "@/lib/api";
import { DirectClient } from "@/lib/direct";
import { basename } from "@/lib/files";
import { formatBytes, formatCode, formatDuration, plural } from "@/lib/format";
import { useLeaveGuard, useTitle, useWakeLock } from "@/lib/hooks";
import { canPreview } from "@/lib/preview";
import { Receiver, type ReceiveItem } from "@/lib/receive";
import { memorySink, saveMethod, streamSink, type SaveMethod } from "@/lib/save";
import { singleTarget, zipTarget } from "@/lib/zip";
import { FileBrowser, FileRow } from "../FileList";
import { AlertIcon, BackIcon, CheckIcon, ClockIcon, CloseIcon, DeviceIcon, DownloadIcon, PauseIcon, PlayIcon, ZapIcon } from "../icons";
import { InlinePreview, PreviewDialog } from "../preview/Preview";
import { Badge, Button, Card, ConfirmButton, IconButton, Notice, ProgressBar, Spinner, StatusCard, buttonClass, type StatusProps } from "../ui";
import { MetaRow, MetaTile, Pinned, TransferHeading, inFlight, pageTitle, percent, summarize } from "./common";

function checksumsUrl(meta: TransferMeta): string {
  // b3sum-compatible, so a download can be verified with `b3sum -c`.
  const lines = meta.files.filter((f) => f.hash).map((f) => `${f.hash}  ${f.path}\n`);
  return URL.createObjectURL(new Blob(lines, { type: "text/plain" }));
}

const subscribeNothing = () => () => {};
const versionZero = () => 0;

/** What someone who opened a code sees before they start downloading. */
export function ReceiverPanel({ meta }: { meta: TransferMeta }) {
  const { size, received, complete, ready } = summarize(meta.files);
  const [initial] = useState({ ready: ready && !meta.hosted, size });
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
      // A hosted transfer has no other source, and otherwise a peer is only worth trying
      // while the server doesn't have everything yet.
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

  if (receiver) return <ReceivingPanel receiver={receiver} meta={meta} onBack={() => setReceiver(undefined)} />;

  const single = meta.files.length === 1 ? meta.files[0] : null;
  const directOpen = direct?.state === "open";
  const viaDirect = directOpen && (meta.hosted || !ready);
  // The sender's page is the only source, so its absence is the whole story.
  const senderMissing = meta.hosted && !directOpen;
  const tooLargeHere = meta.hosted && method === null;
  const unreachable = direct?.state === "unavailable";

  /** Receives `files` from the sender's device, as one file or as a zip of several. */
  async function startDirect(files: FileMeta[]) {
    if (!direct || !files.length) return;
    setError(undefined);
    try {
      const one = files.length === 1 ? files[0] : null;
      const method = await saveMethod(files.reduce((size, f) => size + f.size, 0));
      if (!method) throw new Error("This browser can't save a download that large.");
      const name = one ? basename(one.path) : `flux-${meta.code}.zip`;
      const sink = method === "stream" ? await streamSink(name, one?.size) : memorySink(name);
      const target = one ? singleTarget(sink) : zipTarget(sink);
      const next = new Receiver(meta, direct, target, new Set(files.map((f) => f.idx)));
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
              <Badge tone="ok" icon={<ZapIcon />}>
                Direct connection
              </Badge>
            )
          }
        />

        {viaDirect && (
          <Notice tone="ok" icon={<ZapIcon />} className="mt-4">
            {meta.hosted ? "Connected to the sender. These files come straight from their device." : "The sender is online, so files come straight from their device."}
          </Notice>
        )}
        {tooLargeHere && (
          <Notice tone="warn" icon={<AlertIcon />} className="mt-4">
            This browser can&apos;t save a transfer this large from another device. Ask the sender to upload it to the server instead.
          </Notice>
        )}
        {senderMissing && !tooLargeHere && (
          <Notice icon={unreachable ? <AlertIcon className="text-warn" /> : <Spinner className="text-accent" />} className="mt-4">
            {unreachable
              ? "Couldn't reach the sender's device. These files were never uploaded, so they can only come from there."
              : "Waiting for the sender. Nothing was uploaded, so their page has to be open for this to arrive."}
          </Notice>
        )}
        {!meta.hosted && !ready && !viaDirect && (
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
          {meta.hosted ? (
            <Button variant="primary" className={primary} onClick={() => startDirect(meta.files)} disabled={!viaDirect}>
              {label}
            </Button>
          ) : viaDirect ? (
            <Button variant="primary" className={primary} onClick={() => startDirect(meta.files)}>
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
          <Notice tone="err" icon={<AlertIcon />} className="mt-3">
            {error}
          </Notice>
        )}
        {!single && (ready || viaDirect) && <p className="mt-3 text-xs text-muted">Everything downloads as one .zip file.</p>}
        {single && canPreview(single) && <InlinePreview code={meta.code} file={single} onExpand={() => setPreviewing(single.idx)} />}
      </Card>
      {!single &&
        (meta.hosted ? (
          <FileBrowser
            paths={paths}
            renderRow={(i) => (
              <FileRow
                path={meta.files[i].path}
                size={meta.files[i].size}
                badge={<Badge icon={<DeviceIcon />}>On the sender</Badge>}
                actions={
                  <IconButton
                    label={`Download ${basename(meta.files[i].path)}`}
                    disabled={!viaDirect}
                    className="text-accent disabled:opacity-40"
                    onClick={() => startDirect([meta.files[i]])}
                  >
                    <DownloadIcon className="size-4" />
                  </IconButton>
                }
              />
            )}
          />
        ) : (
          <FileBrowser
            paths={paths}
            renderRow={(i) => <MetaRow file={meta.files[i]} code={meta.code} downloadable onPreview={setPreviewing} />}
            renderTile={(i) => <MetaTile file={meta.files[i]} code={meta.code} onPreview={setPreviewing} />}
          />
        ))}
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

function ReceivingPanel({ receiver, meta, onBack }: { receiver: Receiver; meta: TransferMeta; onBack: () => void }) {
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
          finished ? (
            // One file out of a listing is rarely the only one wanted.
            <Button onClick={onBack}>
              <BackIcon className="size-4" />
              Back to files
            </Button>
          ) : (
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
            <Badge tone="ok" icon={<ZapIcon />}>
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
              <Badge tone="warn" icon={<Spinner />}>
                Reconnecting
              </Badge>
            ) : (
              <Badge tone="accent" icon={item.source === "direct" ? <ZapIcon /> : <Spinner />}>
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
              <Badge tone="warn" icon={<ClockIcon />}>
                Waiting for sender
              </Badge>
            ) : (
              <Badge icon={<ClockIcon />}>Waiting</Badge>
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
            <Badge tone="ok" icon={<CheckIcon />}>
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
            <Badge tone="err" icon={<AlertIcon />}>
              {item.error ?? "Not received"}
            </Badge>
          }
        />
      );
  }
}

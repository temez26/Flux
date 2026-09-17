"use client";

import { useEffect, useRef, useState } from "react";
import { countDownload, errorMessage, type FileMeta, type TransferMeta } from "@/lib/api";
import { toast } from "@/lib/alerts/toast";
import { useLeaveGuard, useWakeLock } from "@/lib/hooks";
import { basename } from "@/lib/platform/files";
import { memorySink, saveMethod, streamSink } from "@/lib/save/save";
import { singleTarget, zipTarget } from "@/lib/save/zip";
import { markReceived } from "@/lib/storage/received";
import type { DirectClient } from "@/lib/transfer/direct";
import { Receiver } from "@/lib/transfer/receive";

/**
 * Starts receiving `files` from the sender's device, as one file or as a zip of several.
 * `onSaved` runs once they are on disk: only a finished receive has put anything there, as a
 * zip lands as one file at the very end, so a run that failed part way saved none of it.
 */
export async function receiveDirect(
  meta: TransferMeta,
  direct: DirectClient,
  files: FileMeta[],
  onSaved: () => void,
): Promise<Receiver> {
  const one = files.length === 1 ? files[0] : null;
  const method = await saveMethod(files.reduce((size, f) => size + f.size, 0));
  if (!method) throw new Error("This browser can't save a download that large.");
  const name = one ? basename(one.path) : `flux-${meta.code}.zip`;
  const sink = method === "stream" ? await streamSink(name, one?.size) : memorySink(name);
  const receiver = new Receiver(
    meta,
    direct,
    one ? singleTarget(sink) : zipTarget(sink),
    new Set(files.map((f) => f.idx)),
  );
  countDownload(meta.code);
  const stop = receiver.subscribe(() => {
    if (!receiver.finished) return;
    stop();
    if (receiver.error) return;
    markReceived(
      meta.code,
      meta.expiresAt,
      files.map((f) => f.idx),
    );
    onSaved();
  });
  receiver.start();
  return receiver;
}

/**
 * Single files taken from the sender's device while the file list stays in view, the way a
 * file the server holds downloads straight from its row.
 */
export function useFileDownloads(meta: TransferMeta, direct: DirectClient | undefined, onSaved: () => void) {
  /** Each file's receive, or null while the browser is still working out how it can save it. */
  const [running, setRunning] = useState<ReadonlyMap<number, Receiver | null>>(new Map());
  // Progress lives in the receivers, so each change of theirs draws the rows again.
  const [, redraw] = useState(0);
  const active = running.size > 0;
  useWakeLock(active);
  useLeaveGuard(active);

  // The connection closes with the page, and a receive can't outlive it.
  const latest = useRef(running);
  useEffect(() => {
    latest.current = running;
  });
  useEffect(() => () => latest.current.forEach((receiver) => receiver?.cancel()), []);

  function finish(idx: number) {
    setRunning((current) => {
      const next = new Map(current);
      next.delete(idx);
      return next;
    });
  }

  async function download(file: FileMeta) {
    if (!direct || running.has(file.idx)) return;
    const name = basename(file.path);
    // Shown at once: finding out how this browser saves can take a few seconds.
    setRunning((current) => new Map(current).set(file.idx, null));
    try {
      const receiver = await receiveDirect(meta, direct, [file], onSaved);
      const stop = receiver.subscribe(() => {
        redraw((n) => n + 1);
        if (!receiver.finished) return;
        stop();
        finish(file.idx);
        if (receiver.error && receiver.error !== "Canceled")
          toast(`Couldn't download ${name}: ${receiver.error}`, "err");
      });
      setRunning((current) => new Map(current).set(file.idx, receiver));
    } catch (err) {
      finish(file.idx);
      toast(errorMessage(err), "err");
    }
  }

  /** How far a file's download has got, while one runs. */
  function progress(idx: number): number | undefined {
    if (!running.has(idx)) return undefined;
    const receiver = running.get(idx);
    if (!receiver) return 0;
    const { total, received } = receiver.snapshot;
    return total ? received / total : 0;
  }

  const cancel = (idx: number) => running.get(idx)?.cancel();

  return { download, progress, cancel };
}

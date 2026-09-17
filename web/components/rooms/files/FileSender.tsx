"use client";

import { useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { nextPaint } from "@/lib/hooks";
import { offerTitle, type Peer } from "@/lib/nearby/nearby";
import type { Picked } from "@/lib/platform/files";
import { navigate } from "@/lib/platform/router";
import { send } from "@/lib/transfer/session";
import { formatCode, plural } from "@/lib/util/format";
import { useFilePickers } from "../../files/picker";
import { NearbyDevices } from "../../nearby";
import { ExpiryNote } from "../../settings/ExpiryNote";
import { useExpiry } from "../../settings/expiry";
import { AlertIcon, DeviceIcon, GlobeIcon } from "../../ui/icons";
import { Notice } from "../../ui/ui";
import { useHandoff } from "../handoff";
import { usePaste, useWindowDrop } from "../incoming";
import { offerTo } from "../offer";
import { DropOverlay, DropZone } from "./DropZone";
import { SharedFiles } from "./SharedFiles";

// Files sent to a device end with the page, so the code behind them only needs to outlast any
// plausible sitting; the row holds a file list and nothing else.
const HOSTED_EXPIRY = 604_800;

/**
 * Sends files one of two ways: `public` uploads them for anyone who opens Flux, `device` sends
 * them straight from this device to a nearby one, without uploading anything.
 */
export function FileSender({ mode }: { mode: "public" | "device" }) {
  const toDevice = mode === "device";
  const [expiresIn] = useExpiry();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Peer | null>(null);
  /** Files dropped, pasted or handed over, waiting for the go-ahead. */
  const [staged, setStaged] = useState<Picked[] | null>(null);

  async function start(files: Picked[]) {
    if (!files.length || (toDevice && !target)) return;
    setError(null);
    setBusy(`Preparing ${plural(files.length, "file")}…`);
    try {
      // Reading every file's metadata blocks the main thread, so let the spinner land first.
      await nextPaint();
      const code = await send(files, toDevice ? HOSTED_EXPIRY : expiresIn, !toDevice, toDevice);
      offerTo(target, code, {
        title: offerTitle(files.map((f) => f.path)),
        files: files.length,
        size: files.reduce((sum, f) => sum + f.file.size, 0),
      });
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  /** What arrives without the picker is shown first, so nothing is shared by a stray drop or paste. */
  async function stage(picked: Picked[] | Promise<Picked[]>) {
    setError(null);
    setBusy("Reading files…");
    try {
      const files = await picked;
      if (files.length) setStaged(files);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const picker = useFilePickers((picked) => void start(picked));
  const status = busy ?? (picker.waiting ? "Getting your files…" : null);
  const dragging = useWindowDrop((picked) => void stage(picked));
  usePaste({ files: (picked) => void stage(picked) });
  useHandoff(mode, (files) => void stage(files));

  const blocked = toDevice && !target;
  const files =
    staged && !status ? (
      <SharedFiles
        files={staged}
        action={toDevice ? (target ? `Send to ${target.name}` : "Send") : "Share publicly"}
        disabled={blocked}
        hint={blocked ? "Choose a device above first." : undefined}
        onSend={() => {
          setStaged(null);
          void start(staged);
        }}
        onCancel={() => setStaged(null)}
      />
    ) : (
      <DropZone
        status={status}
        stalled={picker.stalled}
        disabled={blocked}
        title={
          blocked
            ? "Choose a device first"
            : target
              ? `Choose files to send to ${target.name}`
              : "Choose files to share publicly"
        }
        hint="Photos, videos or any files, of any size"
        onPick={picker.open}
        onDrop={(picked) => void stage(picked)}
      />
    );

  return (
    <>
      {dragging && <DropOverlay label={toDevice ? "Drop to send to a device" : "Drop to share publicly"} />}
      {toDevice ? (
        <div className="space-y-5">
          <Step number={1} title="Choose a device">
            <NearbyDevices
              target={target}
              onChoose={(peer) => setTarget(target?.device === peer.device ? null : peer)}
            />
          </Step>
          <Step number={2} title="Choose files">
            {files}
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted">
              <DeviceIcon className="mt-0.5 size-4 shrink-0" />
              Sent straight from this device. Keep this page open until they have arrived.
            </p>
          </Step>
        </div>
      ) : (
        <>
          {files}
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
            <GlobeIcon className="size-4 shrink-0" />
            Listed in Public shares below.
          </p>
          <ExpiryNote />
        </>
      )}

      {error && (
        <Notice tone="err" role="alert" icon={<AlertIcon />} className="mt-4">
          {error}
        </Notice>
      )}
      {picker.inputs}
    </>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={`Step ${number}: ${title}`}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full bg-accent/10 text-xs text-accent"
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

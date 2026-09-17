"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api";
import { nextPaint } from "@/lib/hooks";
import { offerTitle, type Peer } from "@/lib/nearby/nearby";
import type { Picked } from "@/lib/platform/files";
import { navigate } from "@/lib/platform/router";
import { send } from "@/lib/transfer/session";
import { formatCode, plural } from "@/lib/util/format";
import { useFilePickers } from "../../files/picker";
import { NearbyDevices } from "../../nearby";
import { AlertIcon, DeviceIcon } from "../../ui/icons";
import { Notice } from "../../ui/ui";
import { useExpiry } from "../../settings/expiry";
import { useHandoff } from "../handoff";
import { usePaste, useWindowDrop } from "../incoming";
import { offerTo } from "../offer";
import { DropOverlay, DropZone } from "./DropZone";
import { SendOptions } from "./SendOptions";
import { SharedFiles } from "./SharedFiles";

// A share from this device ends with the page, so its code only needs to outlast any
// plausible sitting; the row holds a file list and nothing else.
const HOSTED_EXPIRY = 604_800;

/**
 * Sends files privately or publicly. `global` makes it take files dropped or pasted anywhere on
 * the page, which only the one sender on a page may do.
 */
export function FileSender({ isPublic, global }: { isPublic: boolean; global: boolean }) {
  const [expiresIn] = useExpiry();
  // Deliberately not remembered: sharing from this device only lasts as long as the page stays open.
  const [hosted, setHosted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A nearby device the next files are offered to, instead of only handing out a code. */
  const [target, setTarget] = useState<Peer | null>(null);
  /** Files handed over from elsewhere, waiting to be told to go. */
  const [shared, setShared] = useState<Picked[] | null>(null);

  async function start(picked: Picked[] | Promise<Picked[]>, to = target) {
    setError(null);
    setBusy("Reading files…");
    try {
      const files = await picked;
      if (!files.length) return setBusy(null);
      setBusy(`Preparing ${plural(files.length, "file")}…`);
      // Reading every file's metadata blocks the main thread, so let the spinner land first.
      await nextPaint();
      const code = await send(files, hosted ? HOSTED_EXPIRY : expiresIn, isPublic, hosted);
      offerTo(to, code, {
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

  const picker = useFilePickers((picked) => void start(picked));
  const status = busy ?? (picker.waiting ? "Getting your files…" : null);
  const dragging = useWindowDrop(global ? (picked) => void start(picked) : undefined);
  usePaste({ files: global ? (picked) => void start(picked) : undefined });
  useHandoff(isPublic ? "public" : "private", setShared);

  // Choosing a device goes straight on to choosing files; choosing it again lets it go.
  function chooseDevice(peer: Peer) {
    if (target?.device === peer.device) return setTarget(null);
    setTarget(peer);
    if (shared) sendShared(peer);
    else picker.open("files");
  }

  function sendShared(to = target) {
    if (!shared) return;
    setShared(null);
    void start(shared, to);
  }

  return (
    <>
      {global && dragging && <DropOverlay label={isPublic ? "Drop to share publicly" : "Drop to share privately"} />}
      {shared && !status ? (
        <SharedFiles
          files={shared}
          target={target}
          nearby={!isPublic}
          onSend={() => sendShared()}
          onCancel={() => setShared(null)}
        />
      ) : (
        <DropZone
          status={status}
          stalled={picker.stalled}
          busy={!!busy}
          target={target}
          isPublic={isPublic}
          highlight={!global && dragging}
          onPick={picker.open}
          onDrop={(picked) => void start(picked)}
        />
      )}

      {target && (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <DeviceIcon className="size-4 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            Sending to <span className="font-medium">{target.name}</span>
          </span>
          <button type="button" onClick={() => setTarget(null)} className="text-muted transition hover:text-fg">
            Cancel
          </button>
        </p>
      )}
      {!isPublic && <NearbyDevices target={target} onChoose={chooseDevice} />}

      <SendOptions hosted={hosted} onHosted={setHosted} />

      {error && (
        <Notice tone="err" role="alert" icon={<AlertIcon />} className="mt-4">
          {error}
        </Notice>
      )}
      {picker.inputs}
    </>
  );
}

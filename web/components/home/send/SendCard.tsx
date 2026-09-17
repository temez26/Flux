"use client";

import { useCallback, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/lib/alerts/toast";
import { nextPaint } from "@/lib/hooks";
import { offerTitle, type Peer } from "@/lib/nearby/nearby";
import type { Picked } from "@/lib/platform/files";
import { navigate } from "@/lib/platform/router";
import { send, sendNote } from "@/lib/transfer/session";
import { formatCode, plural } from "@/lib/util/format";
import { useFilePickers } from "../../files/picker";
import { getNearby, NearbyDevices } from "../../nearby";
import { AlertIcon, DeviceIcon, UploadIcon } from "../../ui/icons";
import { Card, Notice, SectionTitle } from "../../ui/ui";
import { DropOverlay, DropZone } from "./DropZone";
import { SendOptions } from "./SendOptions";
import { SharedFiles } from "./SharedFiles";
import { TextComposer } from "./TextComposer";
import { useIncoming } from "./useIncoming";

// A share from this device ends with the page, so its code only needs to outlast any
// plausible sitting; the row holds a file list and nothing else.
const HOSTED_EXPIRY = 604_800;

/** Offers a transfer just made to the nearby device chosen for it, if there was one and it's still here. */
function offerTo(to: Peer | null, code: string, offer: { title: string; files: number; size: number }) {
  if (!to) return;
  const nearby = getNearby();
  // The transfer exists either way, so a device that left only costs the offer.
  if (nearby.peers.some((p) => p.device === to.device)) {
    nearby.offer(to, { code, ...offer });
    toast(`Offered to ${to.name}`);
  } else {
    toast(`${to.name} is no longer nearby — share the code instead`, "err");
  }
}

export function SendCard({ expiresIn, onExpiresIn }: { expiresIn: number; onExpiresIn: (seconds: number) => void }) {
  // Deliberately not remembered: publishing should always be a conscious choice, and so
  // should sharing from this device, which only lasts as long as the page stays open.
  const [isPublic, setIsPublic] = useState(false);
  const [hosted, setHosted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A nearby device the next files are offered to, instead of only handing out a code. */
  const [target, setTarget] = useState<Peer | null>(null);
  /** Text being written to send instead of files; null while choosing files. */
  const [text, setText] = useState<string | null>(null);
  const [textEditable, setTextEditable] = useState(false);
  /** Files another app shared to Flux, waiting to be told where to go. */
  const [shared, setShared] = useState<Picked[] | null>(null);
  // Read by the window listeners, which are set up once and would otherwise see stale choices.
  const options = useRef({ expiresIn, isPublic, hosted, target: null as Peer | null });

  const start = useCallback(async (picked: Picked[] | Promise<Picked[]>) => {
    setError(null);
    setBusy("Reading files…");
    try {
      const files = await picked;
      if (!files.length) return setBusy(null);
      setBusy(`Preparing ${plural(files.length, "file")}…`);
      // Reading every file's metadata blocks the main thread, so let the spinner land first.
      await nextPaint();
      const { current } = options;
      const code = await send(
        files,
        current.hosted ? HOSTED_EXPIRY : current.expiresIn,
        current.isPublic,
        current.hosted,
      );
      offerTo(current.target, code, {
        title: offerTitle(files.map((f) => f.path)),
        files: files.length,
        size: files.reduce((sum, f) => sum + f.file.size, 0),
      });
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }, []);

  const picker = useFilePickers((picked) => void start(picked));
  const status = busy ?? (picker.waiting ? "Getting your files…" : null);
  const dragging = useIncoming(start, setText, setShared);

  function chooseTarget(peer: Peer | null) {
    options.current.target = peer;
    setTarget(peer);
  }

  // Choosing a device goes straight on to choosing files; choosing it again lets it go.
  function chooseDevice(peer: Peer) {
    if (target?.device === peer.device) return chooseTarget(null);
    chooseTarget(peer);
    // Something already waiting goes straight to the device; otherwise choosing one comes first.
    if (shared) sendShared();
    else if (text === null) picker.open("files");
  }

  function sendShared() {
    if (!shared) return;
    setShared(null);
    void start(shared);
  }

  async function sendText() {
    if (!text?.trim()) return;
    setError(null);
    setBusy("Sending text…");
    try {
      const code = await sendNote(text, textEditable, options.current.expiresIn, options.current.isPublic);
      const title = text.trim().split(/\r?\n/)[0].slice(0, 80);
      offerTo(options.current.target, code, { title, files: 0, size: new TextEncoder().encode(text).length });
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <>
      {dragging && <DropOverlay />}
      <Card>
        <SectionTitle icon={<UploadIcon className="size-4.5" />}>Send</SectionTitle>
        {shared && !status ? (
          <SharedFiles files={shared} target={target} onSend={sendShared} onCancel={() => setShared(null)} />
        ) : text !== null && !status ? (
          <TextComposer
            text={text}
            onText={setText}
            editable={textEditable}
            onEditable={setTextEditable}
            target={target}
            onSend={sendText}
            onCancel={() => setText(null)}
          />
        ) : (
          <DropZone
            status={status}
            stalled={picker.stalled}
            busy={!!busy}
            target={target}
            onPick={picker.open}
            onText={() => setText("")}
          />
        )}

        {target && (
          <p className="mt-3 flex items-center gap-2 text-sm">
            <DeviceIcon className="size-4 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              Sending to <span className="font-medium">{target.name}</span>
            </span>
            <button type="button" onClick={() => chooseTarget(null)} className="text-muted transition hover:text-fg">
              Cancel
            </button>
          </p>
        )}
        <NearbyDevices target={target} onChoose={chooseDevice} />

        <SendOptions
          showDelivery={text === null}
          hosted={hosted}
          isPublic={isPublic}
          expiresIn={expiresIn}
          onHosted={(value) => {
            options.current.hosted = value;
            setHosted(value);
          }}
          onPublic={(value) => {
            options.current.isPublic = value;
            setIsPublic(value);
          }}
          onExpiresIn={(seconds) => {
            options.current.expiresIn = seconds;
            onExpiresIn(seconds);
          }}
        />

        {error && (
          <Notice tone="err" icon={<AlertIcon />} className="mt-4">
            {error}
          </Notice>
        )}
        {picker.inputs}
      </Card>
    </>
  );
}

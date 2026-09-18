"use client";

import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "@/lib/api";
import type { Peer } from "@/lib/nearby/nearby";
import { navigate } from "@/lib/platform/router";
import { sendNote } from "@/lib/transfer/session";
import { formatCode } from "@/lib/util/format";
import { NearbyDevices } from "../../nearby";
import { AlertIcon, DeviceIcon, GlobeIcon, LinkIcon, LockIcon, TextIcon, UsersIcon } from "../../ui/icons";
import { Button, Field, Notice, Segmented, Spinner, Switch } from "../../ui/ui";
import { ExpiryNote } from "../../settings/ExpiryNote";
import { useExpiry } from "../../settings/expiry";
import { useHandoff } from "../handoff";
import { usePaste } from "../incoming";
import { offerTo } from "../offer";

const VISIBILITY = [
  { label: "Link only", value: "link", icon: <LinkIcon className="size-4" /> },
  { label: "Listed publicly", value: "public", icon: <GlobeIcon className="size-4" /> },
];
const EDITORS = [
  { label: "Read only", value: "owner", icon: <LockIcon className="size-4" /> },
  { label: "Edit together", value: "anyone", icon: <UsersIcon className="size-4" /> },
];

/**
 * Writes text to share. It always lives on the server, where it can be listed, opened by link or
 * QR code, and edited by its owner or by everyone with the link. It can also be offered to a nearby
 * device, which then opens it from the server like anyone else. Text pasted anywhere on the page
 * lands in it.
 */
export function TextComposer() {
  const [text, setText] = useState("");
  // Neither is remembered: publishing and handing out editing should always be conscious choices.
  const [isPublic, setIsPublic] = useState(false);
  const [editable, setEditable] = useState(false);
  const [expiresIn] = useExpiry();
  /** Whether to offer it to a nearby device too, and which one. */
  const [toDevice, setToDevice] = useState(false);
  const [target, setTarget] = useState<Peer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const append = (more: string) => setText((current) => current + more);
  useHandoff("text", append);
  usePaste({ text: append });

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim() || busy || (toDevice && !target)) return;
    setError(null);
    setBusy(true);
    try {
      const code = await sendNote(text, editable, expiresIn, isPublic);
      if (toDevice) {
        const title = text.trim().split(/\r?\n/)[0].slice(0, 80);
        offerTo(target, code, { title, files: 0, size: new TextEncoder().encode(text).length });
      }
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={id} className="sr-only">
        Text to share
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
        }}
        placeholder="Paste a link, a note, a password…"
        spellCheck={false}
        className="block min-h-40 w-full resize-y rounded-inset border-2 border-line bg-bg p-3 text-base outline-none! transition-colors placeholder:text-muted focus:border-accent"
      />
      <p className="mt-1.5 hidden text-xs text-muted pointer-fine:block">Ctrl+Enter to share</p>

      <div className="mt-4 grid gap-4 @xl:grid-cols-2">
        <Field label="Who can find it">
          <Segmented
            label="Who can find it"
            value={isPublic ? "public" : "link"}
            options={VISIBILITY}
            onChange={(v) => setIsPublic(v === "public")}
          />
        </Field>
        <Field label="Who can edit">
          <Segmented
            label="Who can edit"
            value={editable ? "anyone" : "owner"}
            options={EDITORS}
            onChange={(v) => setEditable(v === "anyone")}
          />
        </Field>
      </div>
      <ExpiryNote className="mt-2" />

      {error && (
        <Notice tone="err" role="alert" icon={<AlertIcon />} className="mt-4">
          {error}
        </Notice>
      )}
      <div className="mt-5 rounded-inset border border-line p-3">
        <div className="flex min-h-11 items-center gap-3">
          <p id={`${id}-device`} className="min-w-0 flex-1 text-sm font-medium">
            Send to a device too
          </p>
          <Switch checked={toDevice} onChange={setToDevice} labelledBy={`${id}-device`} />
        </div>
        {toDevice && (
          <div className="mt-3 animate-view-in">
            <NearbyDevices
              target={target}
              onChoose={(peer) => setTarget(target?.device === peer.device ? null : peer)}
            />
          </div>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        className="mt-5 w-full @md:w-auto"
        disabled={!text.trim() || busy || (toDevice && !target)}
      >
        {busy ? (
          <Spinner className="size-4" />
        ) : toDevice ? (
          <DeviceIcon className="size-4" />
        ) : (
          <TextIcon className="size-4" />
        )}
        {toDevice && target ? `Share and send to ${target.name}` : toDevice ? "Choose a device first" : "Share text"}
      </Button>
    </form>
  );
}

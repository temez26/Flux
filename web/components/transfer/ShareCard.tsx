"use client";

import { useMemo, useState } from "react";
import { EXPIRY_OPTIONS, errorMessage, updateTransfer } from "@/lib/api";
import { encode } from "uqr";
import { copyText } from "@/lib/platform/clipboard";
import { formatCode, formatRemaining } from "@/lib/util/format";
import { reloadTransfer, useNow, useOwned } from "@/lib/hooks";
import { saveOwned } from "@/lib/storage/owned";
import { toast } from "@/lib/alerts/toast";
import { ClockIcon, CopyIcon, GlobeIcon, LinkIcon, LockIcon, QrIcon } from "../ui/icons";
import { Badge, Button, Card, IconButton } from "../ui/ui";

function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const { data, size } = encode(text, { ecc: "M", border: 0 });
    let path = "";
    data.forEach((row, y) => row.forEach((on, x) => on && (path += `M${x} ${y}h1v1h-1z`)));
    return { path, size };
  }, [text]);
  // Always dark-on-light: many scanners can't read inverted codes.
  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      className="size-full rounded-xl bg-white"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code for the transfer link"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

export function ShareCard({ code, expiresAt, hosted }: { code: string; expiresAt?: string; hosted?: boolean }) {
  const now = useNow(60_000);
  const [showQr, setShowQr] = useState(false);
  const owned = useOwned(code);
  const isPublic = owned?.public;
  // What this device last set wins over what the page was handed, which can be a poll behind.
  const expires = owned?.expiresAt ?? expiresAt;
  const [choosing, setChoosing] = useState(false);
  const formatted = formatCode(code);
  const link = `${window.location.origin}/${formatted}`;
  const canShare = typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;

  async function copy(text: string, what: string) {
    try {
      await copyText(text);
      toast(`${what} copied`);
    } catch {
      toast(`Couldn't copy the ${what.toLowerCase()}`, "err");
    }
  }

  async function keep(seconds: number, label: string) {
    if (!owned) return;
    try {
      const { expiresAt } = await updateTransfer(code, owned.token, { expiresIn: seconds });
      saveOwned(code, { ...owned, expiresAt });
      reloadTransfer(code);
      setChoosing(false);
      toast(`Kept for ${label} from now`);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }

  function shareLink() {
    if (canShare) navigator.share({ title: "Flux transfer", url: link }).catch(() => {});
    else void copy(link, "Link");
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Share</h2>
        <Badge tone={isPublic ? "accent" : "muted"} icon={isPublic ? <GlobeIcon /> : <LockIcon />}>
          {isPublic ? "Public" : "Private"}
        </Badge>
        {hosted ? (
          <Badge icon={<ClockIcon />}>While this page is open</Badge>
        ) : owned && expires ? (
          <button
            type="button"
            onClick={() => setChoosing(!choosing)}
            aria-expanded={choosing}
            className="rounded-full transition hover:brightness-95"
          >
            <Badge icon={<ClockIcon />}>{formatRemaining(expires, now)} · Change</Badge>
          </button>
        ) : (
          expires && <Badge icon={<ClockIcon />}>{formatRemaining(expires, now)}</Badge>
        )}
      </div>
      {choosing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Keep it for</span>
          {EXPIRY_OPTIONS.map(({ label, value }) => (
            <Button key={value} className="min-h-9 px-3" onClick={() => keep(value, label)}>
              {label}
            </Button>
          ))}
          <span className="text-muted">from now</span>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-bg py-1 pr-1 pl-4">
            <span className="flex-1 font-mono text-2xl font-semibold tracking-widest sm:text-3xl">{formatted}</span>
            <IconButton label="Copy code" onClick={() => copy(formatted, "Code")}>
              <CopyIcon className="size-5" />
            </IconButton>
          </div>
          <p className="mt-2 text-sm text-muted">
            Enter this code on the other device, scan the QR code, or send the link.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={shareLink}>
              <LinkIcon className="size-4" />
              {canShare ? "Share link" : "Copy link"}
            </Button>
            <Button className="sm:hidden" onClick={() => setShowQr((v) => !v)} aria-pressed={showQr}>
              <QrIcon className="size-4" />
              {showQr ? "Hide QR code" : "Show QR code"}
            </Button>
          </div>
        </div>
        <div className={`${showQr ? "block" : "hidden"} mx-auto size-52 shrink-0 sm:block sm:size-36`}>
          <QrCode text={link} />
        </div>
      </div>
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import { encode } from "uqr";
import { copyText } from "@/lib/clipboard";
import { formatCode, formatRemaining } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { getOwned } from "@/lib/owned";
import { toast } from "@/lib/toast";
import { ClockIcon, CopyIcon, GlobeIcon, LinkIcon, LockIcon, QrIcon } from "./icons";
import { Badge, Button, Card, IconButton } from "./ui";

function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const { data, size } = encode(text, { ecc: "M", border: 0 });
    let path = "";
    data.forEach((row, y) => row.forEach((on, x) => on && (path += `M${x} ${y}h1v1h-1z`)));
    return { path, size };
  }, [text]);
  // Always dark-on-light: many scanners can't read inverted codes.
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className="size-full rounded-xl bg-white" shapeRendering="crispEdges" role="img" aria-label="QR code for the transfer link">
      <path d={path} fill="#000" />
    </svg>
  );
}

export function ShareCard({ code, expiresAt, hosted }: { code: string; expiresAt?: string; hosted?: boolean }) {
  const now = useNow(60_000);
  const [showQr, setShowQr] = useState(false);
  const isPublic = useMemo(() => getOwned(code)?.public, [code]);
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
        ) : (
          expiresAt && <Badge icon={<ClockIcon />}>{formatRemaining(expiresAt, now)}</Badge>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-bg py-1 pr-1 pl-4">
            <span className="flex-1 font-mono text-2xl font-semibold tracking-widest sm:text-3xl">{formatted}</span>
            <IconButton label="Copy code" onClick={() => copy(formatted, "Code")}>
              <CopyIcon className="size-5" />
            </IconButton>
          </div>
          <p className="mt-2 text-sm text-muted">Enter this code on the other device, scan the QR code, or send the link.</p>
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

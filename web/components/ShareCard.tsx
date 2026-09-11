"use client";

import { useMemo, useState } from "react";
import { encode } from "uqr";
import { formatCode, formatRemaining } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { getOwned } from "@/lib/owned";
import { LinkIcon, QrIcon } from "./icons";
import { Button, Card } from "./ui";

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // Plain-HTTP LAN deployments have no Clipboard API.
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

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

export function ShareCard({ code, expiresAt }: { code: string; expiresAt?: string }) {
  const now = useNow(60_000);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [showQr, setShowQr] = useState(false);
  const isPublic = useMemo(() => getOwned(code)?.public, [code]);
  const formatted = formatCode(code);
  const link = `${window.location.origin}/${formatted}`;
  const canShare = typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;

  async function copy(what: "code" | "link") {
    await copyText(what === "code" ? formatted : link).catch(() => {});
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1500);
  }

  function shareLink() {
    if (canShare) navigator.share({ title: "Flux transfer", url: link }).catch(() => {});
    else void copy("link");
  }

  return (
    <Card className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Transfer code</p>
        <button
          type="button"
          onClick={() => copy("code")}
          className="mt-1 block font-mono text-3xl font-semibold tracking-wider sm:text-4xl"
          aria-label={`Copy code ${formatted}`}
        >
          {copied === "code" ? <span className="text-accent">copied</span> : formatted}
        </button>
        {expiresAt && (
          <p className="mt-1 text-xs text-muted">
            {formatRemaining(expiresAt, now)}
            {isPublic && " · Public, listed for everyone"}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={shareLink}>
            <LinkIcon className="size-4" />
            {copied === "link" ? "Link copied" : canShare ? "Share link" : "Copy link"}
          </Button>
          <Button className="sm:hidden" onClick={() => setShowQr((v) => !v)} aria-pressed={showQr}>
            <QrIcon className="size-4" />
            QR
          </Button>
        </div>
      </div>
      <div className={`${showQr ? "block" : "hidden"} size-28 shrink-0 sm:block sm:size-36`}>
        <QrCode text={link} />
      </div>
    </Card>
  );
}

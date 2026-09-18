"use client";

import { useId, useMemo, useState } from "react";
import { EXPIRY_OPTIONS, errorMessage, updateTransfer } from "@/lib/api";
import { encode } from "uqr";
import { copyText } from "@/lib/platform/clipboard";
import { formatCode, formatRemaining } from "@/lib/util/format";
import { reloadTransfer, useNow, useOwned } from "@/lib/hooks";
import { saveOwned } from "@/lib/storage/owned";
import { toast } from "@/lib/alerts/toast";
import { ClockIcon, GlobeIcon, LinkIcon, LockIcon, QrIcon } from "../ui/icons";
import { Badge, Button, Card, Switch } from "../ui/ui";

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

export function ShareCard({
  code,
  expiresAt,
  hosted,
  uploading = false,
  open,
}: {
  code: string;
  expiresAt?: string;
  hosted?: boolean;
  /** Its files are still uploading, so its lifetime hasn't started counting yet. */
  uploading?: boolean;
  /** Whether others may add files; absent where that can't be offered. */
  open?: boolean;
}) {
  const now = useNow(60_000);
  const [showQr, setShowQr] = useState(false);
  const owned = useOwned(code);
  const isPublic = owned?.public;
  // What this device last set wins over what the page was handed, which can be a poll behind.
  const expires = owned?.expiresAt ?? expiresAt;
  const afterUpload = uploading ? owned?.lifetime : null;
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
      const { expiresAt, lifetime } = await updateTransfer(code, owned.token, { expiresIn: seconds });
      saveOwned(code, { ...owned, expiresAt, lifetime: lifetime ?? undefined });
      reloadTransfer(code);
      setChoosing(false);
      toast(uploading ? `Kept for ${label} after the upload` : `Kept for ${label} from now`);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }

  const [opening, setOpening] = useState(false);
  const openId = useId();

  async function setOpen(value: boolean) {
    if (!owned) return;
    setOpening(true);
    try {
      await updateTransfer(code, owned.token, { open: value });
      reloadTransfer(code);
      toast(value ? "Anyone can add files now" : "Only you can add files now");
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setOpening(false);
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
            className="group cursor-pointer rounded-full transition hover:brightness-95"
          >
            <Badge icon={<ClockIcon />}>
              {formatRemaining(expires, now, afterUpload)} ·{" "}
              {/* Styled as the link it is, like Change beside a new share's expiry. */}
              <span className="font-medium text-accent group-hover:underline">Change</span>
            </Badge>
          </button>
        ) : (
          expires && <Badge icon={<ClockIcon />}>{formatRemaining(expires, now, afterUpload)}</Badge>
        )}
      </div>
      {choosing && (
        <div className="mt-3 flex animate-view-in flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Keep it for</span>
          {EXPIRY_OPTIONS.map(({ label, value }) => (
            <Button key={value} className="min-h-9 pointer-coarse:min-h-11 px-3" onClick={() => keep(value, label)}>
              {label}
            </Button>
          ))}
          <span className="text-muted">{uploading ? "after the upload" : "from now"}</span>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted">Code</p>
          {/* Read out or typed after the address, so it is shown large and without mixed case. */}
          <p className="mt-1 font-mono text-3xl font-semibold tracking-wider uppercase">{formatted}</p>
          <div className="mt-4 flex items-center gap-1 rounded-inset border border-line bg-bg p-1 pl-3">
            <span className="min-w-0 flex-1 truncate text-sm text-muted" title={link}>
              {link.replace(/^https?:\/\//, "")}
            </span>
            <Button variant="primary" className="shrink-0 !rounded-inset-inner" onClick={shareLink}>
              <LinkIcon className="size-4" />
              {canShare ? "Share link" : "Copy link"}
            </Button>
          </div>
          <Button className="mt-2 w-full sm:hidden" onClick={() => setShowQr((v) => !v)} aria-pressed={showQr}>
            <QrIcon className="size-4" />
            {showQr ? "Hide QR code" : "Show QR code"}
          </Button>
        </div>
        <figure className={`${showQr ? "flex" : "hidden"} shrink-0 flex-col items-center gap-2 sm:flex`}>
          <div className="size-52 sm:size-36">
            <QrCode text={link} />
          </div>
          <figcaption className="text-xs text-muted">Scan to open</figcaption>
        </figure>
      </div>
      {owned && open !== undefined && (
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <p id={`${openId}-label`} className="min-w-0 flex-1 text-sm font-medium">
            Let others add files
          </p>
          <Switch checked={open} onChange={setOpen} disabled={opening} labelledBy={`${openId}-label`} />
        </div>
      )}
    </Card>
  );
}

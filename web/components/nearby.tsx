"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { formatBytes, formatCode, plural } from "@/lib/format";
import { Nearby, type Peer, type SocketLike } from "@/lib/nearby";
import { notify } from "@/lib/notify";
import { navigate } from "@/lib/router";
import { toast } from "@/lib/toast";
import { CloseIcon, DeviceIcon, DownloadIcon } from "./icons";
import { Button, IconButton } from "./ui";

let instance: Nearby | undefined;

/** The page's one connection to the other devices, opened the first time anything needs it. */
export function getNearby(): Nearby {
  return (instance ??= new Nearby(
    () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      return new WebSocket(`${scheme}://${window.location.host}/api/nearby`) as unknown as SocketLike;
    },
    ({ from, accepted }) => toast(accepted ? `${from.name} is opening it` : `${from.name} declined`, accepted ? "ok" : "err"),
    (offer) =>
      notify(`${offer.from.name} wants to send you files`, `${offer.title} · ${plural(offer.files, "file")} · ${formatBytes(offer.size)}`, `offer-${offer.code}`),
  ));
}

export function useNearby(): Nearby {
  const nearby = getNearby();
  useSyncExternalStore(nearby.subscribe, nearby.getVersion, nearby.getVersion);
  return nearby;
}

/** Offers from other devices, shown over whichever page is open when they arrive. */
export function IncomingOffers() {
  const nearby = useNearby();
  if (!nearby.offers.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex max-w-2xl flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {nearby.offers.map((offer) => (
        <div
          key={offer.code}
          className="pointer-events-auto flex animate-[toast-in_.2s_ease-out] items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <DownloadIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {offer.from.name} wants to send you {offer.title}
            </p>
            <p className="truncate text-xs text-muted">
              {plural(offer.files, "file")} · {formatBytes(offer.size)}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              nearby.answer(offer, true);
              navigate(`/${formatCode(offer.code)}`);
            }}
          >
            Open
          </Button>
          <IconButton label={`Decline ${offer.title} from ${offer.from.name}`} onClick={() => nearby.answer(offer, false)}>
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

/** Devices to send to directly, and the name this one goes by. */
export function NearbyDevices({ target, onChoose }: { target: Peer | null; onChoose: (peer: Peer) => void }) {
  const nearby = useNearby();
  const [draft, setDraft] = useState<string | null>(null);

  function rename(e: FormEvent) {
    e.preventDefault();
    if (draft !== null) nearby.rename(draft);
    setDraft(null);
  }

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">Send to a nearby device</p>
        {draft === null ? (
          <button type="button" onClick={() => setDraft(nearby.device.name)} className="text-xs text-muted transition hover:text-fg">
            You appear as <span className="font-medium text-fg">{nearby.device.name}</span> · Rename
          </button>
        ) : (
          <form onSubmit={rename} className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={rename}
              maxLength={40}
              aria-label="This device's name"
              enterKeyHint="done"
              className="min-h-9 w-44 rounded-lg border border-line bg-bg px-2 text-sm outline-none focus:border-accent"
            />
          </form>
        )}
      </div>
      {!nearby.connected ? (
        <p className="text-sm text-muted">Looking for devices…</p>
      ) : nearby.peers.length ? (
        <div role="radiogroup" aria-label="Nearby devices" className="flex flex-wrap gap-2">
          {nearby.peers.map((peer) => {
            const chosen = target?.device === peer.device;
            return (
              <button
                key={peer.device}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => onChoose(peer)}
                className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${
                  chosen ? "border-accent bg-accent/10 text-accent" : "border-line bg-bg hover:border-accent/60"
                }`}
              >
                <DeviceIcon className="size-4" />
                {peer.name}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-3 text-center text-sm text-muted">
          No other devices right now. Open Flux on another device on this network.
        </p>
      )}
    </div>
  );
}

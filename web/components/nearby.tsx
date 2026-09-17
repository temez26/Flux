"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { formatBytes, formatCode, plural } from "@/lib/util/format";
import { Nearby, type Offer, type Peer, type SocketLike } from "@/lib/nearby/nearby";
import { notify } from "@/lib/alerts/notify";
import { navigate } from "@/lib/platform/router";
import { toast } from "@/lib/alerts/toast";
import { CheckIcon, CloseIcon, DeviceIcon, DownloadIcon } from "./ui/icons";
import { Button, IconButton, Spinner } from "./ui/ui";

let instance: Nearby | undefined;

/** A text transfer is offered with no files, and is described as what it is. */
const offerDetail = (offer: Offer) =>
  offer.files ? `${plural(offer.files, "file")} · ${formatBytes(offer.size)}` : "Text";

/** The page's one connection to the other devices, opened the first time anything needs it. */
export function getNearby(): Nearby {
  return (instance ??= new Nearby(
    () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      return new WebSocket(`${scheme}://${window.location.host}/api/nearby`) as unknown as SocketLike;
    },
    ({ from, accepted }) =>
      toast(accepted ? `${from.name} is opening it` : `${from.name} declined`, accepted ? "ok" : "err"),
    (offer) =>
      notify(
        `${offer.from.name} wants to send you ${offer.files ? "files" : "text"}`,
        `${offer.title} · ${offerDetail(offer)}`,
        `offer-${offer.code}`,
        `/${formatCode(offer.code)}`,
      ),
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
  return (
    // Always there, empty or not: a live region that arrives along with its message goes unread.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto max-w-2xl p-3 pt-[max(0.75rem,env(safe-area-inset-top))] empty:hidden"
    >
      {nearby.offers.length > 0 && (
        <section aria-label="Offers from nearby devices" className="flex flex-col gap-2">
          {nearby.offers.map((offer) => (
            <div
              key={offer.code}
              className="pointer-events-auto flex animate-[toast-in_.2s_ease-out] surface floating items-center gap-3 rounded-2xl p-3"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <DownloadIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {offer.from.name} wants to send you {offer.title}
                </p>
                <p className="truncate text-xs text-muted">{offerDetail(offer)}</p>
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
              <IconButton
                label={`Decline ${offer.title} from ${offer.from.name}`}
                onClick={() => nearby.answer(offer, false)}
              >
                <CloseIcon className="size-4" />
              </IconButton>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Devices to send to directly, and the name this one goes by to them. */
export function NearbyDevices({ target, onChoose }: { target: Peer | null; onChoose: (peer: Peer) => void }) {
  const nearby = useNearby();
  const [draft, setDraft] = useState<string | null>(null);

  function rename(e: FormEvent) {
    e.preventDefault();
    if (draft !== null) nearby.rename(draft);
    setDraft(null);
  }

  return (
    <div>
      {nearby.connected && nearby.peers.length ? (
        <div role="radiogroup" aria-label="Nearby devices" className="grid gap-2 sm:grid-cols-2">
          {nearby.peers.map((peer) => {
            const chosen = target?.device === peer.device;
            return (
              <button
                key={peer.device}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => onChoose(peer)}
                className={`flex min-h-14 items-center gap-3 rounded-xl border-2 px-3 text-left font-medium transition ${
                  chosen ? "border-accent bg-accent/10 text-accent" : "border-line bg-bg hover:border-accent/60"
                }`}
              >
                <DeviceIcon className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{peer.name}</span>
                {chosen && <CheckIcon className="size-5 shrink-0" />}
              </button>
            );
          })}
        </div>
      ) : (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-dashed border-line p-4 text-sm">
          <Spinner className="mt-0.5 size-4 shrink-0 text-muted" />
          <div>
            <p className="font-medium">Looking for devices…</p>
            <p className="mt-0.5 text-muted">Open Flux on another device on this network.</p>
          </div>
        </div>
      )}
      <div className="mt-2 flex min-h-9 pointer-coarse:min-h-11 flex-wrap items-center gap-x-1 text-sm text-muted">
        {draft === null ? (
          <>
            Visible as <span className="font-medium text-fg">{nearby.device.name}</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setDraft(nearby.device.name)}
              className="min-h-9 pointer-coarse:min-h-11 font-medium text-accent hover:underline"
              aria-label={`Rename this device, now ${nearby.device.name}`}
            >
              Rename
            </button>
          </>
        ) : (
          <form onSubmit={rename} className="flex items-center gap-2">
            <label htmlFor="device-name">This device&apos;s name</label>
            <input
              id="device-name"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={rename}
              maxLength={40}
              enterKeyHint="done"
              className="min-h-9 pointer-coarse:min-h-11 w-44 rounded-lg border border-line bg-bg px-2 text-base text-fg outline-none focus:border-accent"
            />
          </form>
        )}
      </div>
    </div>
  );
}

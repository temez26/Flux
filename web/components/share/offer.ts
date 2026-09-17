import { toast } from "@/lib/alerts/toast";
import type { Peer } from "@/lib/nearby/nearby";
import { getNearby } from "../nearby";

/** Offers a share just made to the nearby device chosen for it, if there was one and it's still here. */
export function offerTo(to: Peer | null, code: string, offer: { title: string; files: number; size: number }) {
  if (!to) return;
  const nearby = getNearby();
  // The share exists either way, so a device that left only costs the offer.
  if (nearby.peers.some((p) => p.device === to.device)) {
    nearby.offer(to, { code, ...offer });
    toast(`Offered to ${to.name}`);
  } else {
    toast(`${to.name} is no longer nearby — share the link instead`, "err");
  }
}

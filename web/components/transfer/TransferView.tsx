"use client";

import { useEffect, useState } from "react";
import { useOwned, useTitle, useTransferMeta } from "@/lib/hooks";
import { removeOwned } from "@/lib/storage/owned";
import { live } from "@/lib/transfer/session";
import { AlertIcon, ClockIcon } from "../ui/icons";
import { Message, Notice, Spinner } from "../ui/ui";
import { AddFilesCard } from "./AddFilesCard";
import { HostedPanel } from "./HostedPanel";
import { NotePanel } from "./note/NotePanel";
import { OwnerPanel } from "./OwnerPanel";
import { ReceiverPanel } from "./ReceiverPanel";
import { SenderPanel } from "./SenderPanel";

/**
 * One transfer, seen from wherever this device stands in it: the tab that is sending,
 * the sender returning to a transfer it no longer holds, or someone with the code.
 */
export default function TransferView({ code }: { code: string }) {
  const [session, setSession] = useState(() => live.get(code));
  // Followed rather than read once: keeping a transfer longer changes when its sender stops.
  const owned = useOwned(code);
  const { meta, offline } = useTransferMeta(code, !session);
  // Panels set their own title (with progress); this covers the loading and error screens.
  useTitle(session || meta ? undefined : "Flux");

  useEffect(() => {
    if (meta === null) removeOwned(code);
  }, [meta, code]);

  if (session) {
    return session.uploader ? (
      <SenderPanel uploader={session.uploader} expiresAt={owned?.expiresAt} />
    ) : (
      <HostedPanel session={session} expiresAt={owned?.expiresAt} />
    );
  }
  if (meta === undefined) {
    return offline ? (
      <Message icon={<AlertIcon />} title="Can't reach the Flux server">
        Retrying…
      </Message>
    ) : (
      <Message icon={<Spinner className="size-5" />} title="Loading…" />
    );
  }
  if (meta === null) {
    return (
      <Message icon={<ClockIcon />} title="Transfer not found">
        It may have expired or been deleted.
      </Message>
    );
  }
  return (
    <>
      {/* Shown while the server can't be reached, so the page isn't mistaken for up to date. */}
      {offline && (
        <Notice tone="warn" role="status" icon={<Spinner />} className="mb-4">
          Lost connection to the server. Retrying…
        </Notice>
      )}
      {meta.note !== undefined ? (
        <NotePanel meta={meta} token={owned?.token} />
      ) : owned ? (
        <OwnerPanel meta={meta} token={owned.token} onResume={setSession} />
      ) : (
        <ReceiverPanel meta={meta}>{meta.open && <AddFilesCard meta={meta} />}</ReceiverPanel>
      )}
    </>
  );
}

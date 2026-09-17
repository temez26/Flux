"use client";

import { useState } from "react";
import { useMediaQuery } from "@/lib/hooks";
import type { Picked } from "@/lib/platform/files";
import { navigate } from "@/lib/platform/router";
import { OwnedList } from "../lists/OwnedList";
import { PublicList } from "../lists/PublicList";
import { RecentList } from "../lists/RecentList";
import { DropOverlay } from "../rooms/files/DropZone";
import { handOff, type Handoffs, type Target } from "../rooms/handoff";
import { usePaste, useSharedFromApps, useWindowDrop } from "../rooms/incoming";
import { RoomPanel } from "../rooms/RoomViews";
import { room, WIDE_QUERY, type RoomId } from "../rooms/rooms";
import { Card } from "../ui/ui";
import { IncomingChooser } from "./IncomingChooser";
import { ReceiveForm } from "./ReceiveForm";
import { RoomLinks } from "./RoomLinks";

/**
 * The start page. Where it fits, every room is shown on it side by side; otherwise it links to
 * each room's own page.
 */
export default function Home() {
  const wide = useMediaQuery(WIDE_QUERY);
  /** Files dropped, pasted or shared here, waiting to be told which room they are for. */
  const [incoming, setIncoming] = useState<Picked[] | null>(null);

  function goTo<T extends Target>(id: T, payload: NonNullable<Handoffs[T]>) {
    handOff(id, payload);
    if (wide) reveal(id);
    else navigate(room(id).path);
  }

  const receive = (files: Picked[]) => {
    if (files.length) setIncoming(files);
  };
  const dragging = useWindowDrop((picked) => void picked.then(receive));
  usePaste({ files: receive, text: (text) => goTo("text", text) });
  useSharedFromApps(receive, (text) => goTo("text", text));

  const chooser = incoming && (
    <IncomingChooser
      files={incoming}
      onChoose={(isPublic) => {
        setIncoming(null);
        goTo(isPublic ? "public" : "private", incoming);
      }}
      onCancel={() => setIncoming(null)}
    />
  );

  if (wide) {
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Flux</h1>
        {chooser}
        <div className="grid grid-cols-2 items-start gap-4">
          <div className="space-y-4">
            <RoomPanel id="private" />
            <RoomPanel id="public" />
          </div>
          <div className="space-y-4">
            <Card aria-label="Open a share">
              <ReceiveForm />
            </Card>
            <RoomPanel id="text" />
            <RoomPanel id="collect" />
            <OwnedList />
            <RecentList />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dragging && <DropOverlay label="Drop to choose how to share" />}
      <h1 className="sr-only">Flux</h1>
      {chooser}
      <RoomLinks />
      <Card aria-label="Open a share">
        <ReceiveForm />
      </Card>
      <Card aria-label="Public shares">
        <PublicList heading="h2" preview />
      </Card>
      <OwnedList />
      <RecentList />
    </div>
  );
}

/** Brings a room shown beside the others into view, with focus, once it has what was handed to it. */
function reveal(id: RoomId) {
  const panel = document.getElementById(`room-${id}`);
  panel?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  panel?.focus({ preventScroll: true });
}

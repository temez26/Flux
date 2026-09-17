"use client";

import { useState } from "react";
import { useTitle } from "@/lib/hooks";
import type { Picked } from "@/lib/platform/files";
import { navigate } from "@/lib/platform/router";
import { OwnedList } from "../lists/OwnedList";
import { PublicShares } from "../lists/PublicShares";
import { RecentList } from "../lists/RecentList";
import { DropOverlay } from "../rooms/files/DropZone";
import { handOff, type Handoffs, type Target } from "../rooms/handoff";
import { usePaste, useSharedFromApps, useWindowDrop } from "../rooms/incoming";
import { tabById, type ShareTab } from "../rooms/tabs";
import { Card } from "../ui/ui";
import { IncomingChooser } from "./IncomingChooser";
import { ShareTabs } from "./ShareTabs";

/** The start page: the ways to share on top, what is shared publicly below, then this device's own. */
export default function Home({ tab }: { tab: ShareTab }) {
  useTitle(tab.id === "public" ? "Flux" : `${tab.name} · Flux`);
  /** Files from another app's Share sheet, or dropped on a tab that doesn't send files, asking where to go. */
  const [incoming, setIncoming] = useState<Picked[] | null>(null);
  // The file tabs take what is dropped or pasted on them themselves.
  const sendsFiles = tab.id === "public" || tab.id === "device";

  function goTo<T extends Target>(id: T, payload: NonNullable<Handoffs[T]>) {
    handOff(id, payload);
    if (tab.id !== id) navigate(tabById(id).path);
  }

  const receive = (files: Picked[]) => {
    if (files.length) setIncoming(files);
  };
  const dragging = useWindowDrop(sendsFiles ? undefined : (picked) => void picked.then(receive));
  usePaste({
    files: sendsFiles ? undefined : receive,
    text: tab.id === "text" ? undefined : (text) => goTo("text", text),
  });
  useSharedFromApps(receive, (text) => goTo("text", text));

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Flux</h1>
      {dragging && !sendsFiles && <DropOverlay label="Drop to choose how to share" />}
      {incoming && (
        <IncomingChooser
          files={incoming}
          onChoose={(target) => {
            setIncoming(null);
            goTo(target, incoming);
          }}
          onCancel={() => setIncoming(null)}
        />
      )}
      <ShareTabs tab={tab} />
      <Card>
        <PublicShares />
      </Card>
      <OwnedList />
      <RecentList />
    </div>
  );
}

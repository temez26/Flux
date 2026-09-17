"use client";

import { useTitle } from "@/lib/hooks";
import { ArrowIcon, ExpandIcon, GlobeIcon } from "../ui/icons";
import { Card, Link, SectionTitle, iconButtonClass } from "../ui/ui";
import { CollectForm } from "./collect/CollectForm";
import { FileSender } from "./files/FileSender";
import { room as roomById, type Room, type RoomId } from "./rooms";
import { TextComposer } from "./text/TextComposer";

/**
 * What a room is for, wherever it is shown. `standalone` means it is the only room on the page,
 * so it takes what is dropped or pasted anywhere on it.
 */
function RoomBody({ id, standalone }: { id: RoomId; standalone: boolean }) {
  switch (id) {
    case "private":
      return <FileSender isPublic={false} global={standalone} />;
    case "public":
      return <FileSender isPublic global={standalone} />;
    case "text":
      return <TextComposer global={standalone} />;
    case "collect":
      return <CollectForm />;
  }
}

/** A room on a page of its own. */
export function RoomPage({ room }: { room: Room }) {
  useTitle(`${room.name} · Flux`);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <room.Icon className="size-5.5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{room.name}</h1>
          <p className="mt-0.5 text-sm text-muted">{room.summary}</p>
        </div>
      </div>
      <Card aria-label={room.name}>
        <RoomBody id={room.id} standalone />
      </Card>
      {room.id === "public" && (
        <Link
          href="/browse"
          className="flex min-h-12 items-center gap-2 rounded-xl px-1 text-sm font-medium text-accent transition hover:underline"
        >
          <GlobeIcon className="size-4" />
          Browse public shares
          <ArrowIcon className="size-4" />
        </Link>
      )}
    </div>
  );
}

/** A room shown beside the others on the home page, where there is room for them all. */
export function RoomPanel({ id }: { id: RoomId }) {
  const room = roomById(id);
  return (
    <Card id={`room-${id}`} aria-label={room.name} tabIndex={-1} className="scroll-mt-4 outline-none">
      <SectionTitle
        icon={<room.Icon className="size-4.5" />}
        aside={
          <Link href={room.path} className={iconButtonClass} aria-label={`Open ${room.name} on its own page`}>
            <ExpandIcon className="size-4" />
          </Link>
        }
      >
        {room.name}
      </SectionTitle>
      <RoomBody id={id} standalone={false} />
    </Card>
  );
}

import { ChevronRightIcon } from "../ui/icons";
import { Link } from "../ui/ui";
import { ROOMS } from "../rooms/rooms";

/** Each room, as a way in. */
export function RoomLinks() {
  return (
    <nav aria-label="Ways to share">
      <ul className="grid gap-3 sm:grid-cols-2">
        {ROOMS.map((room) => (
          <li key={room.id}>
            <Link
              href={room.path}
              className="flex h-full min-h-20 items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:border-accent/60 hover:bg-hover active:scale-[0.99]"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <room.Icon className="size-5.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{room.name}</span>
                <span className="mt-0.5 block text-sm text-muted">{room.summary}</span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

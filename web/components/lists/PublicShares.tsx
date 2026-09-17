"use client";

import { useId, useState } from "react";
import { listPublic, type Summary } from "@/lib/api";
import { useNow, usePolling } from "@/lib/hooks";
import { formatBytes, formatRemaining, plural } from "@/lib/util/format";
import { DeviceIcon, FileTypeIcon, FolderIcon, GlobeIcon, SearchIcon, TextIcon } from "../ui/icons";
import { Badge, Button, Spinner } from "../ui/ui";
import { TransferRow } from "./TransferRow";
import { LIST_POLL_MS } from "./useSummaries";

/** One page of a public listing. */
const PUBLIC_PAGE = 100;

const GROUPS = {
  files: { heading: "Files", noun: "files", Icon: FolderIcon },
  text: { heading: "Texts", noun: "texts", Icon: TextIcon },
} as const;

type Kind = keyof typeof GROUPS;

/**
 * Everything shared publicly, newest first, searchable, in one place but kept apart: files in
 * one group, texts in the other, side by side where there is room.
 */
export function PublicShares() {
  const [query, setQuery] = useState("");
  const needle = query.trim();

  return (
    <div>
      <div className="mb-3 flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <GlobeIcon className="size-5.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Public shares</h2>
          <p className="mt-0.5 text-sm text-muted">
            What anyone on this Flux shared publicly. Open one to see or download it.
          </p>
        </div>
      </div>

      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search public files and texts"
          aria-label="Search public files and texts"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-xl border border-line bg-bg pr-3 pl-9 text-base outline-none placeholder:text-muted/60 focus:border-accent"
        />
      </div>

      <div className="grid gap-x-8 gap-y-5 @2xl:grid-cols-2">
        <PublicGroup kind="files" needle={needle} />
        <PublicGroup kind="text" needle={needle} />
      </div>
    </div>
  );
}

/** One kind of public share, with its own count, paging and empty state. */
function PublicGroup({ kind, needle }: { kind: Kind; needle: string }) {
  const group = GROUPS[kind];
  const now = useNow(60_000);
  const [list, setList] = useState<Summary[] | null>(null);
  const [pages, setPages] = useState(1);
  const limit = PUBLIC_PAGE * pages;
  const id = useId();

  // Asking for the pages already on screen keeps a refresh from dropping what was opened up.
  usePolling(async () => setList(await listPublic({ q: needle, limit, kind })), LIST_POLL_MS, `${limit}:${needle}`);

  // A full page is the only sign there may be more; the server doesn't count the rest.
  const more = !!list && list.length === limit;

  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-1 flex items-center gap-2 border-b border-line pb-2">
        <group.Icon className="size-4 text-muted" />
        <h3 id={id} className="text-sm font-semibold">
          {group.heading}
        </h3>
        {!!list?.length && <Badge>{more ? `${list.length}+` : list.length}</Badge>}
      </div>
      {!list ? (
        <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted">
          <Spinner /> Loading public {group.noun}…
        </p>
      ) : list.length ? (
        <ul>
          {list.map((t) => (
            <li key={t.code}>
              <PublicRow transfer={t} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          {needle ? `No public ${group.noun} match “${needle}”.` : `No public ${group.noun} right now.`}
        </p>
      )}
      {more && (
        <Button className="mt-2 w-full" onClick={() => setPages((n) => n + 1)}>
          Show more {group.noun}
        </Button>
      )}
    </section>
  );
}

function PublicRow({ transfer: t, now }: { transfer: Summary; now: number }) {
  return (
    <TransferRow
      code={t.code}
      icon={
        t.note ? (
          <TextIcon className="size-4.5" />
        ) : t.files > 1 ? (
          <FolderIcon className="size-4.5" />
        ) : (
          <FileTypeIcon path={t.title} className="size-4.5" />
        )
      }
      title={t.title}
      detail={`${t.note ? "Text" : plural(t.files, "file")} · ${formatBytes(t.size)} · ${formatRemaining(t.expiresAt, now, t.complete ? null : t.lifetime)}`}
      badge={
        t.hosted ? (
          <Badge icon={<DeviceIcon />}>From a device</Badge>
        ) : (
          !t.complete && (
            <Badge tone="accent" icon={<Spinner />}>
              Uploading
            </Badge>
          )
        )
      }
    />
  );
}

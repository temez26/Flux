"use client";

import { useState } from "react";
import { listPublic, type Summary } from "@/lib/api";
import { useNow, usePolling } from "@/lib/hooks";
import { formatBytes, formatRemaining, plural } from "@/lib/util/format";
import { ArrowIcon, DeviceIcon, FileTypeIcon, FolderIcon, GlobeIcon, SearchIcon, TextIcon } from "../ui/icons";
import { Badge, Button, Link, Spinner } from "../ui/ui";
import { TransferRow } from "./TransferRow";
import { LIST_POLL_MS } from "./useSummaries";

/** One page of the public listing, and how many make a listing worth searching. */
const PUBLIC_PAGE = 100;
const PUBLIC_SEARCH_FROM = 12;
/** How many a preview shows before pointing to the whole listing. */
const PREVIEW_LIMIT = 5;

/**
 * What is shared publicly, newest first. A preview shows the newest few and links to the Public
 * share room, where the listing can be searched and paged through.
 */
export function PublicList({ heading: Heading, preview = false }: { heading: "h2" | "h3"; preview?: boolean }) {
  const now = useNow(60_000);
  const [list, setList] = useState<Summary[] | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(preview ? PREVIEW_LIMIT : PUBLIC_PAGE);
  const needle = query.trim();

  // Asking for the pages already on screen keeps a refresh from dropping what was opened up.
  usePolling(async () => setList(await listPublic({ q: needle, limit })), LIST_POLL_MS);

  if (!list) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading public shares…
      </p>
    );
  }
  // A full page is the only sign there may be more; the server doesn't count the rest.
  const more = list.length === limit;
  const searchable = !preview && (needle !== "" || list.length >= PUBLIC_SEARCH_FROM);

  return (
    <div>
      <Heading className="mb-2 flex items-center gap-2 text-sm font-medium">
        <GlobeIcon className="size-4 text-muted" />
        Public shares
        {list.length > 0 && <Badge>{more ? `${list.length}+` : list.length}</Badge>}
      </Heading>
      {searchable && (
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PUBLIC_PAGE);
            }}
            placeholder="Search public files"
            aria-label="Search public files"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-xl border border-line bg-bg pr-3 pl-9 text-base outline-none placeholder:text-muted/60 focus:border-accent"
          />
        </div>
      )}
      {list.length ? (
        list.map((t) => (
          <TransferRow
            key={t.code}
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
            detail={`${t.note ? "Text" : plural(t.files, "file")} · ${formatBytes(t.size)} · ${formatRemaining(t.expiresAt, now)}`}
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
        ))
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          {needle ? `Nothing public matches “${needle}”.` : "Nothing is shared publicly right now."}
        </p>
      )}
      {preview ? (
        <Link
          href="/public"
          className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium text-accent transition hover:bg-hover"
        >
          See all public shares
          <ArrowIcon className="size-4" />
        </Link>
      ) : (
        more && (
          <Button className="mt-2 w-full" onClick={() => setLimit((n) => n + PUBLIC_PAGE)}>
            Show more
          </Button>
        )
      )}
    </div>
  );
}

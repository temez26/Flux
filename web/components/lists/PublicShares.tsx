"use client";

import { useId, useState } from "react";
import { listPublic, type Summary } from "@/lib/api";
import { useNow, usePolling } from "@/lib/hooks";
import { formatBytes, formatRemaining, plural } from "@/lib/util/format";
import {
  ArrowIcon,
  ChevronRightIcon,
  DeviceIcon,
  FileTypeIcon,
  FolderIcon,
  GlobeIcon,
  SearchIcon,
  TextIcon,
} from "../ui/icons";
import { Badge, Button, Link, Spinner } from "../ui/ui";
import { TransferRow } from "./TransferRow";
import { LIST_POLL_MS } from "./useSummaries";

/** One page of a public listing. */
const PUBLIC_PAGE = 100;
/** How many of each kind a preview shows before pointing to the whole listing. */
const PREVIEW_LIMIT = 5;
const BROWSE_PATH = "/browse";

const GROUPS = {
  files: { heading: "Files", noun: "files", Icon: FolderIcon },
  text: { heading: "Texts", noun: "texts", Icon: TextIcon },
} as const;

type Kind = keyof typeof GROUPS;

/**
 * Everything shared publicly, newest first, in one place but kept apart: files in one group,
 * texts in the other, side by side where there is room.
 * - `full`: every public share, searchable and paged.
 * - `preview`: the newest few of each, under a heading that leads to the whole listing.
 */
export function PublicShares({ heading: Heading, variant }: { heading: "h1" | "h2"; variant: "full" | "preview" }) {
  const [query, setQuery] = useState("");
  const needle = query.trim();
  const preview = variant === "preview";
  const groupHeading = Heading === "h1" ? "h2" : "h3";

  const tile = (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
      <GlobeIcon className="size-5.5" />
    </span>
  );
  const title = (
    <span className="min-w-0 flex-1">
      <Heading className={`font-semibold ${Heading === "h1" ? "text-xl tracking-tight" : ""}`}>Public shares</Heading>
      <span className="mt-0.5 block text-sm text-muted">
        Files and texts anyone on this Flux shared publicly. Open one to see or download it.
      </span>
    </span>
  );

  return (
    <div>
      {preview ? (
        <Link href={BROWSE_PATH} className="-m-2 mb-2 flex items-center gap-3 rounded-xl p-2 transition hover:bg-hover">
          {tile}
          {title}
          <ChevronRightIcon className="size-5 shrink-0 text-muted" />
        </Link>
      ) : (
        <div className="mb-3 flex items-start gap-3">
          {tile}
          {title}
        </div>
      )}

      {!preview && (
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
      )}

      <div className="grid gap-x-8 gap-y-5 @3xl:grid-cols-2">
        <PublicGroup kind="files" heading={groupHeading} needle={needle} preview={preview} />
        <PublicGroup kind="text" heading={groupHeading} needle={needle} preview={preview} />
      </div>

      {preview && (
        <Link
          href={BROWSE_PATH}
          className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium text-accent transition hover:bg-hover"
        >
          See all public shares
          <ArrowIcon className="size-4" />
        </Link>
      )}
    </div>
  );
}

/** One kind of public share, with its own count, paging and empty state. */
function PublicGroup({
  kind,
  heading: Heading,
  needle,
  preview,
}: {
  kind: Kind;
  heading: "h2" | "h3";
  needle: string;
  preview: boolean;
}) {
  const group = GROUPS[kind];
  const now = useNow(60_000);
  const [list, setList] = useState<Summary[] | null>(null);
  const [pages, setPages] = useState(1);
  const limit = preview ? PREVIEW_LIMIT : PUBLIC_PAGE * pages;
  const id = useId();

  // Asking for the pages already on screen keeps a refresh from dropping what was opened up.
  usePolling(async () => setList(await listPublic({ q: needle, limit, kind })), LIST_POLL_MS, `${limit}:${needle}`);

  // A full page is the only sign there may be more; the server doesn't count the rest.
  const more = !!list && list.length === limit;

  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-1 flex items-center gap-2 border-b border-line pb-2">
        <group.Icon className="size-4 text-muted" />
        <Heading id={id} className="text-sm font-semibold">
          {group.heading}
        </Heading>
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
      {!preview && more && (
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

"use client";

import { useState, type ReactNode } from "react";
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

/** One page of the public listing, and how many make a listing worth searching. */
const PUBLIC_PAGE = 100;
const PUBLIC_SEARCH_FROM = 12;
/** How many a preview shows before pointing to the whole listing. */
const PREVIEW_LIMIT = 5;

const WORDING = {
  files: {
    heading: "Public files",
    summary: "Files anyone on this Flux shared publicly. Open one to preview or download it.",
    path: "/browse",
    noun: "files",
  },
  text: {
    heading: "Public texts",
    summary: "Notes and links anyone on this Flux shared publicly.",
    path: "/text",
    noun: "texts",
  },
};

type Heading = "h1" | "h2" | "h3";

/**
 * Files or texts shared publicly, newest first.
 * - `full`: the whole listing, searchable and paged, under a heading that says what it is.
 * - `preview`: the newest few, under a heading that leads to the whole listing.
 * - `compact`: the whole listing under a small heading, inside a card that already has one.
 */
export function PublicList({
  kind,
  heading,
  variant,
}: {
  kind: "files" | "text";
  heading: Heading;
  variant: "full" | "preview" | "compact";
}) {
  const wording = WORDING[kind];
  const preview = variant === "preview";
  const now = useNow(60_000);
  const [list, setList] = useState<Summary[] | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(preview ? PREVIEW_LIMIT : PUBLIC_PAGE);
  const needle = query.trim();

  // Asking for the pages already on screen keeps a refresh from dropping what was opened up.
  usePolling(async () => setList(await listPublic({ q: needle, limit, kind })), LIST_POLL_MS);

  // A full page is the only sign there may be more; the server doesn't count the rest.
  const more = !!list && list.length === limit;
  const count = list?.length ? <Badge>{more ? `${list.length}+` : list.length}</Badge> : null;
  const searchable = !preview && (needle !== "" || (list?.length ?? 0) >= PUBLIC_SEARCH_FROM);

  return (
    <div>
      <ListHeading variant={variant} heading={heading} wording={wording} count={count} />
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
            placeholder={`Search public ${wording.noun}`}
            aria-label={`Search public ${wording.noun}`}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-xl border border-line bg-bg pr-3 pl-9 text-base outline-none placeholder:text-muted/60 focus:border-accent"
          />
        </div>
      )}
      {!list ? (
        <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted">
          <Spinner /> Loading public {wording.noun}…
        </p>
      ) : list.length ? (
        <ul className={`grid gap-x-6 ${variant === "full" ? "@3xl:grid-cols-2" : ""}`}>
          {list.map((t) => (
            <li key={t.code} className="min-w-0">
              <PublicRow transfer={t} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          {needle ? `No public ${wording.noun} match “${needle}”.` : `No public ${wording.noun} right now.`}
        </p>
      )}
      {preview
        ? !!list?.length && (
            <Link
              href={wording.path}
              className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium text-accent transition hover:bg-hover"
            >
              See all public {wording.noun}
              <ArrowIcon className="size-4" />
            </Link>
          )
        : more && (
            <Button className="mt-2 w-full" onClick={() => setLimit((n) => n + PUBLIC_PAGE)}>
              Show more
            </Button>
          )}
    </div>
  );
}

function ListHeading({
  variant,
  heading: Heading,
  wording,
  count,
}: {
  variant: "full" | "preview" | "compact";
  heading: Heading;
  wording: (typeof WORDING)[keyof typeof WORDING];
  count: ReactNode;
}) {
  if (variant === "compact") {
    return (
      <div className="mb-2 flex items-center gap-2">
        <GlobeIcon className="size-4 text-muted" />
        <Heading className="text-sm font-medium">{wording.heading}</Heading>
        {count}
      </div>
    );
  }

  const tile = (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
      <GlobeIcon className="size-5.5" />
    </span>
  );
  const text = (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <Heading className={`font-semibold ${Heading === "h1" ? "text-xl tracking-tight" : ""}`}>
          {wording.heading}
        </Heading>
        {count}
      </span>
      <span className="mt-0.5 block text-sm text-muted">{wording.summary}</span>
    </span>
  );

  if (variant === "preview") {
    return (
      <Link href={wording.path} className="-m-2 mb-2 flex items-center gap-3 rounded-xl p-2 transition hover:bg-hover">
        {tile}
        {text}
        <ChevronRightIcon className="size-5 shrink-0 text-muted" />
      </Link>
    );
  }
  return (
    <div className="mb-3 flex items-start gap-3">
      {tile}
      {text}
    </div>
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
  );
}

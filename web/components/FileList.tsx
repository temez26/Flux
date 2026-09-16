"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { basename } from "@/lib/files";
import { formatBytes, plural } from "@/lib/format";
import { FileTypeIcon, GridIcon, ListIcon, SearchIcon } from "./icons";
import { Badge, ProgressBar, type Tone } from "./ui";

const ROW_HEIGHT = 60;
// Kept off screen above and below, in pixels rather than rows: a grid row is twice the
// height of a list row, and each of its tiles may fetch an image to draw itself.
const OVERSCAN_PX = 480;
const TILE_GAP = 8;
// Tiles stretch to fill the width, never narrower than this.
const MIN_TILE = 104;
/** Name and size under a tile's thumbnail. */
const TILE_LABEL = 40;
// Under a screenful or so, a search box is more clutter than help.
const SEARCH_FROM = 12;
const VIEW_KEY = "flux.view";

export type FileView = "list" | "grid";

function storedView(): FileView {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

/**
 * The rows near the viewport. Both views scroll with the page rather than a box of their
 * own, so lists of tens of thousands of files stay cheap to update.
 */
function useVisibleRows(ref: RefObject<HTMLDivElement | null>, rowHeight: number, rows: number): [number, number] {
  const [range, setRange] = useState<[number, number]>([0, 24]);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const overscan = Math.ceil(OVERSCAN_PX / rowHeight);
    const start = Math.max(0, Math.floor(-top / rowHeight) - overscan);
    const end = Math.min(rows, Math.ceil((window.innerHeight - top) / rowHeight) + overscan);
    setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
  }, [ref, rowHeight, rows]);

  // Content above the list can change height on any render, so re-measure every time.
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return range;
}

export function FileList({ count, renderRow }: { count: number; renderRow: (index: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, end] = useVisibleRows(ref, ROW_HEIGHT, count);

  const rows: ReactNode[] = [];
  // The range is measured in an effect, so a render that shrinks the list sees the old one.
  for (let i = start; i < Math.min(end, count); i++) {
    rows.push(
      // Only the rows near the viewport exist, so each one has to say where it sits in the
      // whole list; without that a reader announces twenty files and calls it the lot.
      <div
        key={i}
        role="listitem"
        aria-setsize={count}
        aria-posinset={i + 1}
        className="absolute inset-x-0"
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
      >
        {renderRow(i)}
      </div>,
    );
  }
  return (
    <div ref={ref} role="list" className="relative" style={{ height: count * ROW_HEIGHT }}>
      {rows}
    </div>
  );
}

function FileGrid({ count, renderTile }: { count: number; renderTile: (index: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(2, Math.floor((width + TILE_GAP) / (MIN_TILE + TILE_GAP)));
  const tile = width ? (width - TILE_GAP * (columns - 1)) / columns : MIN_TILE;
  const rowHeight = tile + TILE_LABEL + TILE_GAP;
  const rows = Math.ceil(count / columns);
  const [start, end] = useVisibleRows(ref, rowHeight, rows);

  const tiles: ReactNode[] = [];
  for (let row = start; row < Math.min(end, rows); row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      if (i >= count) break;
      tiles.push(
        <div
          key={i}
          role="listitem"
          aria-setsize={count}
          aria-posinset={i + 1}
          className="absolute"
          style={{ top: row * rowHeight, left: column * (tile + TILE_GAP), width: tile, height: rowHeight - TILE_GAP }}
        >
          {renderTile(i)}
        </div>,
      );
    }
  }
  return (
    <div ref={ref} role="list" className="relative" style={{ height: rows * rowHeight }}>
      {tiles}
    </div>
  );
}

/**
 * A transfer's files, as a list or a grid of thumbnails, with a search box once there are
 * enough of them to make scrolling to one impractical. `renderRow` and `renderTile` are
 * called with an index into the full set, so searching never shifts what a caller sees.
 */
export function FileBrowser({
  paths,
  renderRow,
  renderTile,
}: {
  /** One path per file, in listing order. Memoize it: searching walks the whole array. */
  paths: string[];
  renderRow: (index: number) => ReactNode;
  /** Omitted where a thumbnail says nothing useful, which also hides the view switch. */
  renderTile?: (index: number) => ReactNode;
}) {
  const [view, setView] = useState<FileView>(storedView);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!needle) return null;
    const found: number[] = [];
    for (let i = 0; i < paths.length; i++) if (paths[i].toLowerCase().includes(needle)) found.push(i);
    return found;
  }, [paths, needle]);

  const count = matches ? matches.length : paths.length;
  const at = (position: number) => (matches ? matches[position] : position);

  function choose(next: FileView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }

  return (
    <section>
      {/* Stays reachable while scrolling a long list, which is exactly when it is needed. */}
      <div className="sticky top-0 z-10 -mx-1 bg-bg px-1 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            Files
            <Badge>{matches ? `${count.toLocaleString()} of ${paths.length.toLocaleString()}` : count.toLocaleString()}</Badge>
          </h2>
          {renderTile && (
            <div role="radiogroup" aria-label="Layout" className="ml-auto flex gap-1 rounded-xl border border-line bg-bg p-1">
              {(
                [
                  ["list", "List", <ListIcon key="l" className="size-4" />],
                  ["grid", "Grid", <GridIcon key="g" className="size-4" />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  aria-label={label}
                  title={label}
                  onClick={() => choose(value)}
                  className={`flex size-9 items-center justify-center rounded-lg transition ${
                    view === value ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          )}
        </div>
        {paths.length >= SEARCH_FROM && (
          <div className="relative mt-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or folder"
              aria-label="Search files"
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11 w-full rounded-xl border border-line bg-bg pr-3 pl-9 text-base outline-none placeholder:text-muted/60 focus:border-accent"
            />
          </div>
        )}
      </div>
      {/* The heading carries the count too, but only a live region reports it changing. */}
      <p role="status" className="sr-only">
        {matches
          ? `${count.toLocaleString()} of ${plural(paths.length, "file")} ${count === 1 ? "matches" : "match"} “${needle}”`
          : plural(count, "file")}
      </p>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No files match that search.</p>
      ) : view === "grid" && renderTile ? (
        <FileGrid count={count} renderTile={(position) => renderTile(at(position))} />
      ) : (
        <FileList count={count} renderRow={(position) => renderRow(at(position))} />
      )}
    </section>
  );
}

export function FileRow({
  path,
  size,
  thumb,
  badge,
  progress,
  progressTone = "accent",
  actions,
  onOpen,
}: {
  path: string;
  size: number;
  /** Replaces the file-type icon, e.g. with the image itself. */
  thumb?: ReactNode;
  badge?: ReactNode;
  progress?: number;
  progressTone?: Tone;
  actions?: ReactNode;
  /** Makes the row a button, e.g. to preview the file. */
  onOpen?: () => void;
}) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = slash > 0 ? path.slice(0, slash) : "";
  const details = (
    <>
      <span
        className={`flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg ${
          onOpen ? "bg-accent/10 text-accent" : "bg-hover text-muted"
        }`}
      >
        {thumb ?? <FileTypeIcon path={path} className="size-4.5" />}
      </span>
      <div className="min-w-0 flex-1">
        {onOpen && <span className="sr-only">Preview </span>}
        <p className="truncate text-sm font-medium transition-colors group-hover:text-accent">{name}</p>
        <p className="mt-0.5 flex min-w-0 gap-1.5 text-xs text-muted">
          <span className="shrink-0 tabular-nums">{formatBytes(size)}</span>
          {dir && <span className="truncate">· {dir}</span>}
        </p>
        {progress !== undefined && (
          <div className="mt-1.5">
            <ProgressBar value={progress} tone={progressTone} thin />
          </div>
        )}
      </div>
      {badge && <div className="flex max-w-[45%] min-w-0 shrink-0 justify-end">{badge}</div>}
    </>
  );
  return (
    <div className="flex h-full items-center gap-3 border-b border-line">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="group flex h-full min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
          {details}
        </button>
      ) : (
        details
      )}
      {actions && <div className="-mr-2 flex shrink-0">{actions}</div>}
    </div>
  );
}

export function FileTile({
  path,
  size,
  thumb,
  badge,
  onOpen,
}: {
  path: string;
  size: number;
  thumb?: ReactNode;
  badge?: ReactNode;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-hover text-muted">
        {thumb ?? <FileTypeIcon path={path} className="size-7" />}
        {badge && <span className="absolute top-1 right-1">{badge}</span>}
      </span>
      <span className="mt-1.5 block truncate text-xs font-medium transition-colors group-hover:text-accent">{basename(path)}</span>
      <span className="block truncate text-[11px] text-muted tabular-nums">{formatBytes(size)}</span>
    </>
  );
  const className = "flex size-full flex-col text-left";
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`group cursor-pointer ${className}`}>
      <span className="sr-only">Preview </span>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatBytes } from "@/lib/format";
import { ProgressBar } from "./ui";

const ROW_HEIGHT = 60;
const OVERSCAN = 8;

/**
 * Renders only the rows near the viewport, scrolling with the page, so lists of
 * tens of thousands of files stay cheap to update.
 */
export function FileList({ count, renderRow }: { count: number; renderRow: (index: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 24]);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const start = Math.max(0, Math.floor(-top / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(count, Math.ceil((window.innerHeight - top) / ROW_HEIGHT) + OVERSCAN);
    setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
  }, [count]);

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

  const rows: ReactNode[] = [];
  for (let i = range[0]; i < Math.min(range[1], count); i++) {
    rows.push(
      <div key={i} className="absolute inset-x-0" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}>
        {renderRow(i)}
      </div>,
    );
  }
  return (
    <div ref={ref} className="relative" style={{ height: count * ROW_HEIGHT }}>
      {rows}
    </div>
  );
}

type Tone = "muted" | "ok" | "err" | "accent";
const tones: Record<Tone, string> = { muted: "text-muted", ok: "text-ok", err: "text-err", accent: "text-accent" };

export function FileRow({
  path,
  size,
  status,
  tone = "muted",
  progress,
  actions,
}: {
  path: string;
  size: number;
  status?: string;
  tone?: Tone;
  progress?: number;
  actions?: ReactNode;
}) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = slash > 0 ? path.slice(0, slash) : "";
  return (
    <div className="flex h-full items-center gap-2 border-b border-line">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{name}</p>
        <p className="mt-0.5 flex gap-2 text-xs text-muted">
          <span className="shrink-0 tabular-nums">{formatBytes(size)}</span>
          {dir && <span className="truncate">{dir}</span>}
          {status && <span className={`ml-auto shrink-0 truncate tabular-nums ${tones[tone]}`}>{status}</span>}
        </p>
        {progress !== undefined && (
          <div className="mt-1.5">
            <ProgressBar value={progress} thin />
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0">{actions}</div>}
    </div>
  );
}

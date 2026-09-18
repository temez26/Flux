"use client";

import { useState, type ReactNode } from "react";
import { formatCode } from "@/lib/util/format";
import { ArrowIcon } from "../ui/icons";
import { Link } from "../ui/ui";

export function TransferRow({
  code,
  icon,
  thumb,
  title,
  detail,
  badge,
}: {
  code: string;
  icon: ReactNode;
  /** Drawn over the icon once it loads; the icon stays where it can't. */
  thumb?: string;
  title: string;
  detail: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={`/${formatCode(code)}`}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-hover"
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-hover text-muted">
        {icon}
        {thumb && <Thumb key={thumb} src={thumb} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      {badge && <span className="shrink-0">{badge}</span>}
      <ArrowIcon className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

function Thumb({ src }: { src: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  if (status === "failed") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => setStatus("ready")}
      onError={() => setStatus("failed")}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`}
    />
  );
}

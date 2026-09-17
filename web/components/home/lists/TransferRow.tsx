"use client";

import type { ReactNode } from "react";
import { navigate } from "@/lib/platform/router";
import { formatCode } from "@/lib/util/format";
import { ArrowIcon } from "../../ui/icons";

export function TransferRow({
  code,
  icon,
  title,
  detail,
  badge,
  mono = false,
}: {
  code: string;
  icon: ReactNode;
  title: string;
  detail: string;
  badge?: ReactNode;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/${formatCode(code)}`)}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-hover"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${mono ? "font-mono" : ""}`}>{title}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      {badge && <span className="shrink-0">{badge}</span>}
      <ArrowIcon className="size-4 shrink-0 text-muted" />
    </button>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { toasts } from "@/lib/toast";
import { AlertIcon, CheckIcon } from "./icons";

export default function Toaster() {
  useSyncExternalStore(toasts.subscribe, toasts.getVersion, toasts.getVersion);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {toasts.list.map((t) => (
        <div
          key={t.id}
          className="flex animate-[toast-in_.2s_ease-out] items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium shadow-lg"
        >
          {t.tone === "ok" ? <CheckIcon className="size-4 text-ok" /> : <AlertIcon className="size-4 text-err" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

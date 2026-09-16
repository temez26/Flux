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
          className="pointer-events-auto flex animate-[toast-in_.2s_ease-out] items-center gap-2 rounded-xl border border-line bg-surface py-2.5 pr-2 pl-4 text-sm font-medium shadow-lg"
        >
          {t.tone === "ok" ? <CheckIcon className="size-4 text-ok" /> : <AlertIcon className="size-4 text-err" />}
          {t.message}
          {t.action && (
            <button
              type="button"
              onClick={() => {
                toasts.dismiss(t.id);
                t.action?.run();
              }}
              className="-my-1 rounded-lg px-2 py-1 font-semibold text-accent transition hover:bg-hover"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

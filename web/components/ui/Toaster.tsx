"use client";

import { useRef, useSyncExternalStore } from "react";
import { toasts, type Toast } from "@/lib/alerts/toast";
import { AlertIcon, CheckIcon } from "./icons";

function ToastItem({ toast }: { toast: Toast }) {
  return (
    <div className="pointer-events-auto flex animate-[toast-in_.2s_ease-out] items-center gap-2 rounded-xl border border-line bg-surface py-2.5 pr-2 pl-4 text-sm font-medium shadow-lg">
      {toast.tone === "ok" ? <CheckIcon className="size-4 text-ok" /> : <AlertIcon className="size-4 text-err" />}
      {toast.message}
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toasts.dismiss(toast.id);
            toast.action?.run();
          }}
          className="-my-1 min-h-9 rounded-lg px-2 font-semibold text-accent transition hover:bg-hover"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export default function Toaster() {
  useSyncExternalStore(toasts.subscribe, toasts.getVersion, toasts.getVersion);
  const hovered = useRef(false);
  const focused = useRef(false);
  const sync = () => (hovered.current || focused.current ? toasts.hold() : toasts.release());

  return (
    <div
      onPointerEnter={() => {
        hovered.current = true;
        sync();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={(e) => {
        focused.current = e.currentTarget.contains(e.relatedTarget);
        sync();
      }}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {/* Both regions are always there, as a live region added along with its message goes unread. */}
      <div aria-live="polite" className="flex flex-col items-center gap-2 empty:hidden">
        {toasts.list
          .filter((t) => t.tone === "ok")
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
      {/* Something going wrong is worth interrupting for. */}
      <div aria-live="assertive" className="flex flex-col items-center gap-2 empty:hidden">
        {toasts.list
          .filter((t) => t.tone === "err")
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
    </div>
  );
}

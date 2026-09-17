"use client";

import { ClockIcon } from "../ui/icons";
import { expiryLabel, useExpiry } from "./expiry";
import { openSettings } from "./SettingsMenu";

/** How long what is about to be shared will last, with the way to change it. */
export function ExpiryNote({ className = "" }: { className?: string }) {
  const [expiresIn] = useExpiry();
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 text-sm text-muted ${className}`}>
      <ClockIcon className="size-4" />
      Deleted after <span className="font-medium text-fg">{expiryLabel(expiresIn)}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={openSettings}
        className="min-h-11 font-medium text-accent hover:underline"
        aria-label={`Change how long shares last, now ${expiryLabel(expiresIn)}`}
      >
        Change
      </button>
    </p>
  );
}

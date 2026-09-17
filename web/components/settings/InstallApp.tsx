"use client";

import { useSyncExternalStore } from "react";
import { toast } from "@/lib/alerts/toast";
import { canInstall, install, isAppleTouch, isInstalled, subscribeInstall } from "@/lib/platform/install";
import { DownloadIcon } from "../ui/icons";
import { Button } from "../ui/ui";

/** Installing Flux as an app, where it isn't already: a button where the browser offers it, steps on iOS. */
export function InstallApp() {
  const offered = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  if (isInstalled() || (!offered && !isAppleTouch())) return null;

  async function start() {
    try {
      if (await install()) toast("Flux is installed");
    } catch {
      toast("Couldn't install Flux", "err");
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm font-medium">Install Flux</p>
      {offered ? (
        <>
          <p className="text-xs text-muted">Opens like an app, and shows up when you share from other apps.</p>
          <Button onClick={start} className="mt-2 w-full">
            <DownloadIcon className="size-4" />
            Install
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted">
          Tap Share in the browser, then Add to Home Screen. Flux then opens like an app and can send you notifications.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { countDownload, errorMessage, fileUrl, type FileMeta } from "@/lib/api";
import { toast } from "@/lib/alerts/toast";
import { basename } from "@/lib/platform/files";
import { SHARE_LIMIT, canShareFiles } from "@/lib/platform/share";
import { overlayButton } from "../preview/chrome";
import { CheckIcon, ShareIcon } from "../ui/icons";
import { Spinner, buttonClass } from "../ui/ui";

type State = { step: "idle" } | { step: "loading" } | { step: "ready"; key: string; files: File[] };

const isDom = (err: unknown, name: string) => err instanceof DOMException && err.name === name;

async function load(code: string, files: FileMeta[]): Promise<File[]> {
  return Promise.all(
    files.map(async (file) => {
      const response = await fetch(fileUrl(code, file.idx));
      if (!response.ok) throw new Error(`Couldn't load ${basename(file.path)}`);
      const blob = await response.blob();
      return new File([blob], basename(file.path), { type: blob.type });
    }),
  );
}

/**
 * Hands files the server holds to the device's Share sheet: on a phone, the way to put photos
 * in the library or open a file in another app. Renders nothing where that isn't on offer.
 */
export function ShareFilesButton({
  code,
  files,
  counted = false,
  overlay = false,
  className = "",
}: {
  code: string;
  files: FileMeta[];
  /** Records the share as a download, for anyone who isn't the transfer's owner. */
  counted?: boolean;
  /** Drawn as an icon for the full-screen viewer's toolbar. */
  overlay?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<State>({ step: "idle" });
  const key = files.map((f) => f.idx).join(",");
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const shareable =
    files.length > 0 &&
    size <= SHARE_LIMIT &&
    files.every((f) => f.hash) &&
    canShareFiles(files.map((f) => basename(f.path)));
  if (!shareable) return null;

  const ready = state.step === "ready" && state.key === key ? state.files : null;
  const loading = state.step === "loading";

  async function share(shared: File[], retried: boolean) {
    try {
      await navigator.share({ files: shared });
      setState({ step: "idle" });
    } catch (err) {
      // Safari only opens the sheet straight after a tap, and loading the files can outlast
      // that, so the files wait here for a second one.
      if (isDom(err, "NotAllowedError") && !retried) return setState({ step: "ready", key, files: shared });
      setState({ step: "idle" });
      if (isDom(err, "AbortError")) return;
      toast(retried ? "This browser won't share these files. Download them instead." : errorMessage(err), "err");
    }
  }

  async function start() {
    if (ready) return share(ready, true);
    setState({ step: "loading" });
    try {
      const loaded = await load(code, files);
      if (counted) countDownload(code);
      await share(loaded, false);
    } catch (err) {
      setState({ step: "idle" });
      toast(errorMessage(err), "err");
    }
  }

  const label = ready ? "Ready, tap to share" : loading ? "Getting files…" : "Save or share";
  const icon = loading ? (
    <Spinner className={overlay ? "size-5" : "size-4"} />
  ) : ready ? (
    <CheckIcon className={overlay ? "size-5" : "size-4"} />
  ) : (
    <ShareIcon className={overlay ? "size-5" : "size-4"} />
  );

  return (
    <>
      {overlay ? (
        <button
          type="button"
          onClick={start}
          disabled={loading}
          aria-label={label}
          title={label}
          className={`${overlayButton} ${ready ? "bg-white/15 text-white" : ""} ${className}`}
        >
          {icon}
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={loading}
          className={buttonClass(ready ? "primary" : "secondary", className)}
        >
          {icon}
          {label}
        </button>
      )}
      <span role="status" className="sr-only">
        {ready ? "Files ready. Press the share button again to share them." : ""}
      </span>
    </>
  );
}

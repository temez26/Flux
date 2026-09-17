"use client";

import { useEffect } from "react";
import { normalizeCode } from "@/lib/util/format";
import { useMounted, useOnline } from "@/lib/hooks";
import { navigate, usePath } from "@/lib/platform/router";
import Home from "./home/Home";
import { AlertIcon, BackIcon, LogoIcon } from "./ui/icons";
import { IncomingOffers } from "./nearby";
import { NotificationToggle } from "./notifications";
import Toaster from "./ui/Toaster";
import TransferView from "./transfer/TransferView";
import { Badge, IconButton, Message } from "./ui/ui";

export default function App() {
  const mounted = useMounted();
  const online = useOnline();
  const path = usePath();
  const code = path === "/" ? null : normalizeCode(path);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Some installed apps ignore media-specific theme-color tags, so one plain tag always
  // matches the current page background and follows the system light/dark switch.
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const meta =
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])') ??
      document.createElement("meta");
    if (!meta.isConnected) {
      meta.name = "theme-color";
      document.head.prepend(meta);
    }
    const sync = () => {
      meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    };
    sync();
    dark.addEventListener("change", sync);
    // The theme is usually switched in system settings while the app is in the background.
    document.addEventListener("visibilitychange", sync);
    return () => {
      dark.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  let view = null;
  if (mounted) {
    if (code) view = <TransferView key={code} code={code} />;
    else if (path === "/") view = <Home />;
    else
      view = (
        <Message icon={<AlertIcon />} title="Nothing here">
          Check the link or code and try again.
        </Message>
      );
  }

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex h-12 items-center gap-1">
        {path !== "/" && (
          <IconButton label="Back to home" className="-ml-2" onClick={() => navigate("/")}>
            <BackIcon />
          </IconButton>
        )}
        {/* Views are routed by lib/router, not Next's router, so running uploads survive navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex items-center gap-2 rounded-lg p-1 text-lg font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <LogoIcon className="size-5" />
          </span>
          Flux
        </a>
        <div className="ml-auto flex items-center gap-1">
          {!online && (
            <Badge tone="warn" icon={<AlertIcon />}>
              Offline
            </Badge>
          )}
          {mounted && <NotificationToggle />}
        </div>
      </header>
      <main className="flex-1 pt-4">{view}</main>
      {/* Offers can arrive on any page, and there is nothing to connect for before hydration. */}
      {mounted && <IncomingOffers />}
      <Toaster />
    </div>
  );
}

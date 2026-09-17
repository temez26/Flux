"use client";

import { useEffect, useRef } from "react";
import { normalizeCode } from "@/lib/util/format";
import { useMediaQuery, useMounted, useOnline } from "@/lib/hooks";
import { navigate, usePath } from "@/lib/platform/router";
import Home from "./home/Home";
import { BrowsePage } from "./lists/BrowsePage";
import { RoomPage } from "./rooms/RoomViews";
import { roomAt, WIDE_QUERY } from "./rooms/rooms";
import { AlertIcon, BackIcon, LogoIcon } from "./ui/icons";
import { IncomingOffers } from "./nearby";
import { NotificationToggle } from "./notifications";
import Toaster from "./ui/Toaster";
import TransferView from "./transfer/TransferView";
import { Badge, IconButton, Link, Message } from "./ui/ui";

export default function App() {
  const mounted = useMounted();
  const online = useOnline();
  const path = usePath();
  const code = path === "/" ? null : normalizeCode(path);
  const room = roomAt(path);
  const wide = useMediaQuery(WIDE_QUERY);
  const main = useRef<HTMLElement>(null);
  const firstPath = useRef(path);

  // A new view replaces the page without a load, which a screen reader wouldn't otherwise
  // notice, so focus moves to the start of it. The view the app opens on keeps the browser's focus.
  useEffect(() => {
    if (path === firstPath.current) return;
    firstPath.current = "";
    main.current?.focus({ preventScroll: true });
  }, [path]);

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
    else if (room) view = <RoomPage key={room.id} room={room} />;
    else if (path === "/browse") view = <BrowsePage />;
    else
      view = (
        <Message icon={<AlertIcon />} title="Nothing here">
          Check the link or code and try again.
        </Message>
      );
  }

  return (
    <div
      className={`safe-area mx-auto flex min-h-dvh w-full flex-col ${path === "/" && wide ? "max-w-6xl" : "max-w-2xl"}`}
    >
      <a
        href="#main"
        className="sr-only rounded-lg bg-accent-solid px-3 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <header className="flex h-12 items-center gap-1">
        {path !== "/" && (
          <IconButton label="Back to home" className="-ml-2" onClick={() => navigate("/")}>
            <BackIcon />
          </IconButton>
        )}
        <Link href="/" className="flex items-center gap-2 rounded-lg p-1 text-lg font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <LogoIcon className="size-5" />
          </span>
          Flux
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {!online && (
            <Badge tone="warn" icon={<AlertIcon />}>
              Offline
            </Badge>
          )}
          {mounted && <NotificationToggle />}
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="flex-1 pt-4 outline-none">
        {view}
      </main>
      {/* Offers can arrive on any page, and there is nothing to connect for before hydration. */}
      {mounted && <IncomingOffers />}
      <Toaster />
    </div>
  );
}

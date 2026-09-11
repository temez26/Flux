"use client";

import { useEffect } from "react";
import { normalizeCode } from "@/lib/format";
import { useMounted, useOnline } from "@/lib/hooks";
import { navigate, usePath } from "@/lib/router";
import Home from "./Home";
import { LogoIcon } from "./icons";
import TransferView from "./TransferView";
import { Message } from "./ui";

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

  let view = null;
  if (mounted) {
    if (code) view = <TransferView key={code} code={code} />;
    else if (path === "/") view = <Home />;
    else view = <Message title="Nothing here">Check the link or code and try again.</Message>;
  }

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex h-12 items-center justify-between">
        {/* Views are routed by lib/router, not Next's router, so running uploads survive navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="-ml-1 flex items-center gap-2 rounded-lg p-1 text-lg font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <LogoIcon className="size-5" />
          </span>
          Flux
        </a>
        {!online && <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">Offline</span>}
      </header>
      <main className="flex-1 pt-4">{view}</main>
    </div>
  );
}

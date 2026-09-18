"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { navigate } from "@/lib/platform/router";
import { FileSender } from "../share/files/FileSender";
import { TABS, type ShareTab, type TabId } from "../share/tabs";
import { TextComposer } from "../share/text/TextComposer";
import { Card, Thumb } from "../ui/ui";

const RESIZE_MS = 320;

function TabBody({ id }: { id: TabId }) {
  switch (id) {
    case "public":
      return <FileSender mode="public" />;
    case "device":
      return <FileSender mode="device" />;
    case "text":
      return <TextComposer />;
  }
}

/**
 * Eases `ref`'s height from what it was to what it is whenever `key` changes, rather than jumping.
 * The height is only held for the length of the transition, and left to the content otherwise.
 */
function useHeightTransition(ref: RefObject<HTMLElement | null>, key: string) {
  const last = useRef(0);
  const resizing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!resizing.current) last.current = el.offsetHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  // A layout effect runs after the new content is in but before it is painted, while `last`
  // still holds the height of the old.
  useLayoutEffect(() => {
    const el = ref.current;
    const from = last.current;
    const to = el?.offsetHeight ?? 0;
    if (!el || !from || from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    resizing.current = true;
    el.style.height = `${from}px`;
    el.style.overflowY = "clip";
    void el.offsetHeight;
    el.style.transition = `height ${RESIZE_MS}ms var(--ease-out)`;
    el.style.height = `${to}px`;

    // Transitions inside the panel end here too, so only its own height counts.
    const onEnd = (e: TransitionEvent) => e.target === el && e.propertyName === "height" && done();
    const done = () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
      el.style.height = el.style.overflowY = el.style.transition = "";
      resizing.current = false;
      last.current = el.offsetHeight;
    };
    // transitionend never comes for a hidden tab, so a timer finishes the job too.
    const timer = window.setTimeout(done, RESIZE_MS + 50);
    el.addEventListener("transitionend", onEnd);
    return done;
  }, [ref, key]);
}

/**
 * The ways to share, one at a time. Each tab has its own address, so a tab can be linked to and
 * the Back button returns to the tab chosen before.
 */
export function ShareTabs({ tab }: { tab: ShareTab }) {
  const id = useId();
  const tabId = (t: ShareTab) => `${id}-${t.id}`;
  const index = TABS.indexOf(tab);
  const panel = useRef<HTMLDivElement>(null);
  // Which way the new tab's content slides in follows where it sits from the one before.
  const [shown, setShown] = useState({ index, direction: 0 });
  if (shown.index !== index) setShown({ index, direction: Math.sign(index - shown.index) });
  useHeightTransition(panel, tab.id);

  // Arrow keys move between tabs as in any tab list. They replace the address rather than add to
  // it, so walking along the tabs doesn't fill the Back button's history.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    let next = step === undefined ? -1 : (index + step + TABS.length) % TABS.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    navigate(TABS[next].path, true);
    document.getElementById(tabId(TABS[next]))?.focus();
  }

  const enter = shown.direction > 0 ? "animate-panel-from-right" : shown.direction < 0 ? "animate-panel-from-left" : "";

  return (
    <Card>
      <div
        role="tablist"
        aria-label="How to share"
        onKeyDown={onKeyDown}
        className="relative grid grid-cols-3 gap-1 rounded-inset border border-line bg-bg p-1"
      >
        <Thumb count={TABS.length} index={index} className="rounded-inset-inner" />
        {TABS.map((t) => {
          const selected = t.id === tab.id;
          return (
            <button
              key={t.id}
              id={tabId(t)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => !selected && navigate(t.path)}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-inset-inner px-1 text-sm font-medium transition sm:min-h-12 sm:flex-row sm:gap-2 ${
                selected ? "text-accent" : "text-muted hover:bg-hover hover:text-fg"
              }`}
            >
              <t.Icon className="size-5" />
              {t.name}
            </button>
          );
        })}
      </div>
      <div ref={panel} role="tabpanel" id={`${id}-panel`} aria-labelledby={tabId(tab)}>
        <div key={tab.id} className={`pt-4 ${enter}`}>
          <p className="mb-4 text-sm text-muted">{tab.summary}</p>
          <TabBody id={tab.id} />
        </div>
      </div>
    </Card>
  );
}

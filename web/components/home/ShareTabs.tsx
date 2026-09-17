"use client";

import { useId, type KeyboardEvent } from "react";
import { navigate } from "@/lib/platform/router";
import { CollectForm } from "../rooms/collect/CollectForm";
import { FileSender } from "../rooms/files/FileSender";
import { TABS, type ShareTab, type TabId } from "../rooms/tabs";
import { TextComposer } from "../rooms/text/TextComposer";
import { Card } from "../ui/ui";

function TabBody({ id }: { id: TabId }) {
  switch (id) {
    case "public":
      return <FileSender mode="public" />;
    case "device":
      return <FileSender mode="device" />;
    case "text":
      return <TextComposer />;
    case "collect":
      return <CollectForm />;
  }
}

/**
 * The ways to share, one at a time. Each tab has its own address, so a tab can be linked to and
 * the Back button returns to the tab chosen before.
 */
export function ShareTabs({ tab }: { tab: ShareTab }) {
  const id = useId();
  const tabId = (t: ShareTab) => `${id}-${t.id}`;

  // Arrow keys move between tabs as in any tab list. They replace the address rather than add to
  // it, so walking along the tabs doesn't fill the Back button's history.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const at = TABS.indexOf(tab);
    let next = step === undefined ? -1 : (at + step + TABS.length) % TABS.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    navigate(TABS[next].path, true);
    document.getElementById(tabId(TABS[next]))?.focus();
  }

  return (
    <Card>
      <div
        role="tablist"
        aria-label="How to share"
        onKeyDown={onKeyDown}
        className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-bg p-1"
      >
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
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-sm font-medium transition sm:min-h-12 sm:flex-row sm:gap-2 ${
                selected
                  ? "bg-surface text-accent shadow-sm ring-1 ring-line"
                  : "text-muted hover:bg-hover hover:text-fg"
              }`}
            >
              <t.Icon className="size-5" />
              {t.name}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={tabId(tab)} className="mt-4">
        <p className="mb-4 text-sm text-muted">{tab.summary}</p>
        <TabBody key={tab.id} id={tab.id} />
      </div>
    </Card>
  );
}

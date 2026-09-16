"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { readSlides, readWorkbook, renderDocx } from "@/lib/office";
import { loadText, TEXT_PREVIEW_BYTES } from "@/lib/preview";
import { CopyButton, InlineFrame, Loading, Note, Panel, Unavailable, scrollArea, useLoad, type Status, type ViewProps } from "./chrome";

export function TextView(view: ViewProps) {
  const { data, failed } = useLoad(view.url, loadText);
  if (failed) return <Unavailable {...view} message="This file couldn't be loaded" />;
  if (!data) return <Loading inline={view.inline} />;
  return (
    // Copying part of a file would pass for all of it, so only a complete one offers to.
    <Panel inline={view.inline} onExpand={view.onExpand} aside={data.text && !data.truncated ? <CopyButton text={data.text} /> : undefined}>
      {data.truncated && <Note>Showing the first {formatBytes(TEXT_PREVIEW_BYTES)}. Download the file to see all of it.</Note>}
      <pre className={`${scrollArea} p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap [tab-size:4] sm:p-6`}>
        {data.text || <span className="text-muted">This file is empty.</span>}
      </pre>
    </Panel>
  );
}

export function DocxView(view: ViewProps) {
  const { url, inline, onExpand } = view;
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const controller = new AbortController();
    renderDocx(url, controller.signal, el.shadowRoot ?? el.attachShadow({ mode: "open" })).then(
      () => setStatus("ready"),
      () => controller.signal.aborted || setStatus("failed"),
    );
    return () => controller.abort();
  }, [url]);

  // Pages keep their paper width, so scale them down to fit narrow screens.
  useEffect(() => {
    const el = host.current;
    const wrapper = el?.shadowRoot?.querySelector<HTMLElement>(".docx-wrapper");
    const page = wrapper?.querySelector<HTMLElement>("section.docx");
    if (status !== "ready" || !el || !wrapper || !page) return;
    wrapper.style.zoom = "";
    const width = page.offsetWidth;
    const fit = () => void (wrapper.style.zoom = String(Math.min(1, el.clientWidth / width)));
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [status]);

  if (status === "failed") return <Unavailable {...view} message="This document can't be previewed" />;
  const pages = (
    <div className={inline ? "relative max-h-[60vh] min-h-48 overflow-auto overscroll-contain bg-hover p-3" : "absolute inset-0 overflow-auto overscroll-contain px-2 pt-2 pb-6 sm:px-16"}>
      {status === "loading" && <Loading inline={false} />}
      <div ref={host} className={`transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
  return inline ? <InlineFrame onExpand={onExpand}>{pages}</InlineFrame> : pages;
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const isNumeric = (value: string) => /^[-+]?[\d\s.,]+%?$/.test(value);
const headerCell = "sticky bg-hover px-2.5 py-1 text-xs font-medium text-muted border-line";

export function SheetView(view: ViewProps) {
  const { data: sheets, failed } = useLoad(view.url, readWorkbook);
  const [active, setActive] = useState(0);
  if (failed || sheets?.length === 0) return <Unavailable {...view} message="This spreadsheet can't be previewed" />;
  if (!sheets) return <Loading inline={view.inline} />;
  const sheet = sheets[active];

  return (
    <Panel inline={view.inline} onExpand={view.onExpand} wide>
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-1.5">
          {sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                i === active ? "bg-accent/10 text-accent" : "text-muted hover:bg-hover hover:text-fg"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.truncated && <Note>Showing the first 1,000 rows and 100 columns.</Note>}
      {sheet.rows.length ? (
        <div className={scrollArea}>
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={`${headerCell} top-0 left-0 z-20 border-r border-b`} />
                {sheet.rows[0].map((_, c) => (
                  <th key={c} className={`${headerCell} top-0 z-10 border-r border-b`}>
                    {columnName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th className={`${headerCell} left-0 z-10 border-r border-b text-right tabular-nums`}>{r + 1}</th>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      title={cell.length > 40 ? cell : undefined}
                      className={`max-w-72 truncate border-r border-b border-line px-2.5 py-1.5 whitespace-nowrap ${isNumeric(cell) ? "text-right tabular-nums" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-8 text-center text-sm text-muted">This sheet is empty.</p>
      )}
    </Panel>
  );
}

export function SlidesView(view: ViewProps) {
  const { data: slides, failed } = useLoad(view.url, readSlides);
  if (failed || slides?.length === 0) return <Unavailable {...view} message="This presentation can't be previewed" />;
  if (!slides) return <Loading inline={view.inline} />;
  return (
    <Panel inline={view.inline} onExpand={view.onExpand}>
      <Note>Text only. Download the file to see the slides as designed.</Note>
      <ol className={`${scrollArea} space-y-3 p-3 sm:p-5`}>
        {slides.map((texts, i) => (
          <li key={i} className="rounded-xl border border-line bg-bg p-4 sm:p-5">
            <p className="text-xs font-medium text-muted">Slide {i + 1}</p>
            {texts.length ? (
              <>
                <p className="mt-1.5 font-semibold text-balance">{texts[0]}</p>
                {texts.slice(1).map((text, j) => (
                  <p key={j} className="mt-1 text-sm whitespace-pre-wrap text-muted">
                    {text}
                  </p>
                ))}
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted italic">No text on this slide</p>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

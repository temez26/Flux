import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { fromClipboard, fromDataTransfer, type Picked } from "@/lib/platform/files";
import { takeShared } from "@/lib/platform/share";

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

/** The latest callback, for listeners set up once. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Files dropped anywhere on the window. A drop target on the page that handles a drop itself
 * stops it reaching the window. Returns whether files are being dragged over the window, which
 * holds even without `onDrop`, so drop targets can show where to drop.
 */
export function useWindowDrop(onDrop?: (picked: Promise<Picked[]>) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useLatest(onDrop);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    // Taken even where nothing handles the drop: the browser would open the file in place of
    // Flux, and with it end every transfer running on the page.
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && --depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    // Captured, so a drop target that stops the drop still ends the drag.
    const ended = () => {
      depth = 0;
      setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      latest.current?.(fromDataTransfer(e.dataTransfer));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", ended, true);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", ended, true);
      window.removeEventListener("drop", drop);
    };
  }, [latest]);

  return dragging;
}

/**
 * Pasting a copied screenshot or file, or text, anywhere but into a field on the page, which is
 * left to that field. What there is no callback for is left alone.
 */
export function usePaste(handlers: { files?: (picked: Picked[]) => void; text?: (text: string) => void }) {
  const latest = useLatest(handlers);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const into = e.target instanceof Element ? e.target : null;
      if (!e.clipboardData || into?.closest("input, textarea, [contenteditable]")) return;
      const { files, text } = latest.current;
      if (e.clipboardData.files.length) {
        if (!files) return;
        e.preventDefault();
        files(fromClipboard(e.clipboardData.files));
        return;
      }
      const pasted = e.clipboardData.getData("text/plain");
      if (!pasted.trim() || !text) return;
      e.preventDefault();
      text(pasted);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [latest]);
}

/** Arriving from another app's Share sheet: picks up what it shared, once, and tidies the address. */
export function useSharedFromApps(onFiles: (picked: Picked[]) => void, onText: (text: string) => void) {
  const latest = useLatest({ onFiles, onText });
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("shared")) return;
    window.history.replaceState(window.history.state, "", "/");
    void takeShared().then((received) => {
      if (received?.files.length) latest.current.onFiles(received.files);
      else if (received?.text) latest.current.onText(received.text);
    });
  }, [latest]);
}

/** Props that make an element take dropped files itself, instead of the window. */
export function dropTarget(onDrop: (picked: Promise<Picked[]>) => void) {
  return {
    onDragOver: (e: ReactDragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: ReactDragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(fromDataTransfer(e.dataTransfer));
    },
  };
}

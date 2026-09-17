import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { fromClipboard, fromDataTransfer, type Picked } from "@/lib/platform/files";
import { takeShared } from "@/lib/platform/share";

/**
 * What reaches the send card without its picker: files dropped anywhere on the window, files or
 * text pasted, and whatever another app's Share sheet handed over. Returns whether files are
 * being dragged over the window.
 */
export function useIncoming(
  start: (picked: Picked[] | Promise<Picked[]>) => Promise<void>,
  setText: Dispatch<SetStateAction<string | null>>,
  setShared: (files: Picked[]) => void,
): boolean {
  const [dragging, setDragging] = useState(false);

  // The whole window is a drop target on devices with drag and drop.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && --depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void start(fromDataTransfer(e.dataTransfer));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [start]);

  // Arriving from another app's Share sheet: pick up what it shared, once, and tidy the address.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("shared")) return;
    window.history.replaceState(window.history.state, "", "/");
    void takeShared().then((received) => {
      if (received?.files.length) setShared(received.files);
      else if (received?.text) setText(received.text);
    });
  }, [setShared, setText]);

  // Pasting a copied screenshot or file sends it the way dropping it would, and pasted text
  // opens the text box. A paste into a field on the page is left to that field.
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const into = e.target instanceof Element ? e.target : null;
      if (!e.clipboardData || into?.closest("input, textarea, [contenteditable]")) return;
      if (e.clipboardData.files.length) {
        e.preventDefault();
        void start(fromClipboard(e.clipboardData.files));
        return;
      }
      const pasted = e.clipboardData.getData("text/plain");
      if (!pasted.trim()) return;
      e.preventDefault();
      setText((current) => (current ?? "") + pasted);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [start, setText]);

  return dragging;
}

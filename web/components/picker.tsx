"use client";

import { useRef, type InputHTMLAttributes } from "react";
import { fromFileList, type Picked } from "@/lib/files";
import { useFilePicker } from "@/lib/hooks";

const folderInputProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;

/** Only devices with a real pointer have a folder picker worth offering. */
export const canPickFolder = () => window.matchMedia("(pointer: fine)").matches;

/**
 * The hidden file and folder inputs behind a "choose files" button, together with the wait
 * the native picker can leave behind (see `useFilePicker`). Render `inputs` anywhere in the
 * view and call `open` from whatever opens the picker.
 */
export function useFilePickers(onPick: (picked: Picked[]) => void) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const picker = useFilePicker();

  function open(kind: "files" | "folder") {
    picker.arm();
    (kind === "files" ? files : folder).current?.click();
  }

  function receive(e: { target: HTMLInputElement }) {
    picker.settle();
    const picked = fromFileList(e.target.files);
    e.target.value = "";
    onPick(picked);
  }

  const inputs = (
    <>
      <input ref={files} type="file" multiple hidden onChange={receive} />
      <input ref={folder} type="file" hidden {...folderInputProps} onChange={receive} />
    </>
  );

  return { open, inputs, waiting: picker.waiting, stalled: picker.stalled };
}

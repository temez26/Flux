"use client";

import { useRef, type InputHTMLAttributes } from "react";
import { fromFileList, type Picked } from "@/lib/platform/files";
import { useFilePicker } from "@/lib/hooks";
import { isAppleTouch } from "@/lib/platform/install";

const folderInputProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;

/** Only devices with a real pointer have a folder picker worth offering. */
export const canPickFolder = () => window.matchMedia("(pointer: fine)").matches;

/**
 * Android opens a plain file input on its file manager, a long way from the camera roll, while
 * asking for photos and videos opens its photo picker. iOS already offers the library either way.
 */
export const canPickMedia = () => window.matchMedia("(pointer: coarse)").matches && !isAppleTouch();

export type PickerKind = "files" | "folder" | "media";

/**
 * The hidden file and folder inputs behind a "choose files" button, together with the wait
 * the native picker can leave behind (see `useFilePicker`). Render `inputs` anywhere in the
 * view and call `open` from whatever opens the picker.
 */
export function useFilePickers(onPick: (picked: Picked[]) => void) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const picker = useFilePicker();

  function open(kind: PickerKind) {
    picker.arm();
    ({ files, folder, media })[kind].current?.click();
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
      <input ref={media} type="file" accept="image/*,video/*" multiple hidden onChange={receive} />
    </>
  );

  return { open, inputs, waiting: picker.waiting, stalled: picker.stalled };
}

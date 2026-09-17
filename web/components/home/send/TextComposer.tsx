"use client";

import type { Peer } from "@/lib/nearby/nearby";
import { LockIcon, TextIcon } from "../../ui/icons";
import { Button, Field, Segmented } from "../../ui/ui";

const EDITORS = [
  { label: "Only me", value: "owner", icon: <LockIcon className="size-4" /> },
  { label: "Anyone with the code", value: "anyone", icon: <TextIcon className="size-4" /> },
];

export function TextComposer({
  text,
  onText,
  editable,
  onEditable,
  target,
  onSend,
  onCancel,
}: {
  text: string;
  onText: (text: string) => void;
  /** Whether anyone with the code may edit the text, not only this device. */
  editable: boolean;
  onEditable: (editable: boolean) => void;
  target: Peer | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-line p-3 focus-within:border-accent/60">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend();
        }}
        placeholder="Paste a link, a note, a password…"
        aria-label="Text to send"
        spellCheck={false}
        className="block min-h-40 w-full resize-y bg-transparent text-base outline-none placeholder:text-muted/60"
      />
      <div className="mt-3">
        <Field label="Who can edit" hint="Anyone with the code can read it. You can change who can edit after sending.">
          <Segmented
            label="Who can edit"
            value={editable ? "anyone" : "owner"}
            options={EDITORS}
            onChange={(v) => onEditable(v === "anyone")}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onSend} disabled={!text.trim()}>
          <TextIcon className="size-4" />
          {target ? `Send text to ${target.name}` : "Send text"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Send files instead
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TransferMeta } from "@/lib/api";
import { toast } from "@/lib/alerts/toast";
import { useNoteLive, useNow, useTitle } from "@/lib/hooks";
import { copyText } from "@/lib/platform/clipboard";
import { formatRemaining } from "@/lib/util/format";
import { linkify } from "@/lib/util/links";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  TextIcon,
  UsersIcon,
} from "../../ui/icons";
import { Badge, Button, Card, ConfirmButton, Notice, Spinner } from "../../ui/ui";
import { pageTitle, removeTransfer, useRememberRecent } from "../common";
import { ShareCard } from "../ShareCard";
import { NoteSettings } from "./NoteSettings";
import { useNoteEditor, type SaveStatus } from "./useNoteEditor";

const STATUS: Record<SaveStatus, { label: string; icon: ReactNode }> = {
  saved: { label: "All changes saved", icon: <CheckIcon className="size-4" /> },
  unsaved: { label: "Editing…", icon: null },
  saving: { label: "Saving…", icon: <Spinner className="size-4" /> },
  failed: { label: "Couldn't save. Trying again…", icon: <AlertIcon className="size-4" /> },
};

/** Text as it reads, with its web addresses made into links that open outside Flux. */
function Reading({ text }: { text: string }) {
  if (!text) return <p className="text-muted italic">This text is empty.</p>;
  return (
    <p className="text-[15px] leading-7 break-words whitespace-pre-wrap">
      {linkify(text).map((piece, i) =>
        typeof piece === "string" ? (
          piece
        ) : (
          <a
            key={i}
            href={piece.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            {piece.url}
          </a>
        ),
      )}
    </p>
  );
}

/**
 * A text transfer, for whoever opens it: the text to read and copy, kept up to date as it
 * changes, and to edit where that is allowed — always for its owner, and for anyone with the
 * link while the owner says so. Edits save by themselves and reach everyone who has it open.
 */
export function NotePanel({ meta, token }: { meta: TransferMeta; token?: string }) {
  const owner = !!token;
  const canEdit = owner || meta.editable;
  const now = useNow(60_000);
  const viewers = useNoteLive(meta.code);
  const editor = useNoteEditor(meta, token, canEdit);
  const textarea = useRef<HTMLTextAreaElement>(null);
  /** Said to screen readers: what changed that can't be seen from where focus is. */
  const [announcement, setAnnouncement] = useState("");
  const [seen, setSeen] = useState({ version: meta.noteVersion, editable: meta.editable });
  useTitle(pageTitle(meta.title));
  useRememberRecent(meta, !owner);

  if (seen.version !== meta.noteVersion || seen.editable !== meta.editable) {
    setSeen({ version: meta.noteVersion, editable: meta.editable });
    if (seen.editable !== meta.editable && !owner) {
      setAnnouncement(meta.editable ? "You can edit this text now." : "This text is read only now.");
    } else if (seen.version !== meta.noteVersion && !editor.editing) {
      setAnnouncement("The text was updated.");
    }
  }

  // Grows with what is typed, so a long text is edited in place rather than in a small box.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editor.text, editor.editing]);

  async function copy() {
    try {
      await copyText(editor.text);
      toast("Copied");
    } catch {
      toast("Couldn't copy the text", "err");
    }
  }

  const status = STATUS[editor.status];

  return (
    <div className="space-y-4">
      {owner && <ShareCard code={meta.code} expiresAt={meta.expiresAt} />}
      <Card>
        <p className="sr-only" role="status">
          {announcement}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge icon={<TextIcon />}>Text</Badge>
          <Badge icon={meta.public ? <GlobeIcon /> : <LinkIcon />}>
            {meta.public ? "Listed publicly" : "Link only"}
          </Badge>
          <Badge icon={meta.editable ? <UsersIcon /> : <LockIcon />}>
            {meta.editable ? "Edit together" : "Read only"}
          </Badge>
          {viewers > 1 && (
            <Badge tone="accent" icon={<UsersIcon />}>
              {viewers} people here
            </Badge>
          )}
          {!owner && <Badge icon={<ClockIcon />}>{formatRemaining(meta.expiresAt, now)}</Badge>}
        </div>

        {editor.editing ? (
          // The box shows focus rather than the field inside it, whose ring would sit right against the text.
          <div className="mt-4 rounded-xl border-2 border-accent/60 bg-bg p-3 transition-colors focus-within:border-accent sm:p-4">
            <textarea
              ref={textarea}
              autoFocus
              value={editor.text}
              onChange={(e) => editor.change(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") editor.done();
              }}
              aria-label="Text"
              aria-describedby="note-save-status"
              spellCheck={false}
              className="block min-h-48 w-full resize-none bg-transparent text-[15px] leading-7 outline-none!"
            />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-line bg-bg p-4 sm:p-5">
            <Reading text={editor.text} />
          </div>
        )}

        {editor.stranded && (
          <Notice tone="warn" role="alert" icon={<AlertIcon />} className="mt-3">
            Its owner has made this text read-only, so your changes can&apos;t be saved. Copy them first if you need
            them.
          </Notice>
        )}
        {editor.conflict && (
          <div role="alert" className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-warn">
              <AlertIcon className="size-4 shrink-0" />
              Someone else changed this text at the same time. This is what they saved:
            </p>
            <div className="mt-2 max-h-48 overflow-auto rounded-lg bg-bg p-3">
              <Reading text={editor.conflict.text} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={editor.keepMine}>
                Keep mine
              </Button>
              <Button onClick={editor.takeTheirs}>Use theirs</Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editor.editing ? (
            <>
              <Button variant="primary" onClick={editor.done}>
                Done
              </Button>
              {!editor.stranded && !editor.conflict && (
                <span
                  id="note-save-status"
                  className={`flex items-center gap-1.5 text-sm ${editor.status === "failed" ? "text-err" : "text-muted"}`}
                >
                  {status.icon}
                  {status.label}
                </span>
              )}
            </>
          ) : (
            <>
              <Button variant="primary" onClick={copy} disabled={!editor.text}>
                <CopyIcon className="size-4" />
                Copy
              </Button>
              {canEdit && <Button onClick={editor.edit}>Edit</Button>}
            </>
          )}
          {editor.editing && (
            <Button variant="ghost" onClick={copy} disabled={!editor.text}>
              <CopyIcon className="size-4" />
              Copy
            </Button>
          )}
          {owner && (
            <span className="ml-auto">
              <ConfirmButton onConfirm={() => removeTransfer(meta.code, token)}>Delete</ConfirmButton>
            </span>
          )}
        </div>

        {owner && <NoteSettings meta={meta} token={token} />}
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, saveNote, updateTransfer, type NoteState, type TransferMeta } from "@/lib/api";
import { copyText } from "@/lib/platform/clipboard";
import { formatCode, formatRemaining } from "@/lib/util/format";
import { reloadTransfer, useNow, useTitle } from "@/lib/hooks";
import { linkify } from "@/lib/util/links";
import { toast } from "@/lib/alerts/toast";
import { AlertIcon, ClockIcon, CopyIcon, LockIcon, TextIcon } from "../ui/icons";
import { ShareCard } from "./ShareCard";
import { Badge, Button, Card, ConfirmButton, Field, Notice, Segmented, Spinner } from "../ui/ui";
import { pageTitle, removeTransfer, useRememberRecent } from "./common";

const EDITORS = [
  { label: "Only me", value: "owner", icon: <LockIcon className="size-4" /> },
  { label: "Anyone with the code", value: "anyone", icon: <TextIcon className="size-4" /> },
];

/** Text as it reads, with its web addresses made into links that open outside Flux. */
function Reading({ text }: { text: string }) {
  if (!text) return <p className="text-muted italic">This text is empty.</p>;
  return (
    <p className="text-[15px] leading-7 break-words whitespace-pre-wrap">
      {linkify(text).map((piece, i) =>
        typeof piece === "string" ? (
          piece
        ) : (
          <a key={i} href={piece.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            {piece.url}
          </a>
        ),
      )}
    </p>
  );
}

/**
 * A text transfer, for whoever opens it: the text to read and copy, and to edit where that is
 * allowed — always for its owner, and for anyone with the code while the owner says so. There is
 * nothing to download; the text is the whole of it.
 */
export function NotePanel({ meta, token }: { meta: TransferMeta; token?: string }) {
  const owner = !!token;
  const canEdit = owner || meta.editable;
  const text = meta.note ?? "";
  const now = useNow(60_000);
  /** The text being edited, or null while reading. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The version the draft was started from, which a save has to name. */
  const [base, setBase] = useState(meta.noteVersion);
  /** What someone else saved while this device was editing. */
  const [conflict, setConflict] = useState<NoteState | null>(null);
  const [saving, setSaving] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  useTitle(pageTitle(meta.code));
  useRememberRecent(meta, !owner);

  // Grows with what is typed, so a long text is edited in place rather than in a small box.
  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function edit() {
    setBase(meta.noteVersion);
    setConflict(null);
    setDraft(text);
  }

  async function save(version = base) {
    if (draft === null) return;
    setSaving(true);
    try {
      const result = await saveNote(meta.code, token, draft, version);
      if ("conflict" in result) return setConflict(result.conflict);
      setDraft(null);
      setConflict(null);
      reloadTransfer(meta.code);
      toast("Saved");
    } catch (err) {
      toast(errorMessage(err), "err");
      reloadTransfer(meta.code);
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await copyText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy the text", "err");
    }
  }

  async function chooseEditors(value: string) {
    if (!token) return;
    try {
      await updateTransfer(meta.code, token, { editable: value === "anyone" });
      reloadTransfer(meta.code);
      toast(value === "anyone" ? "Anyone with the code can edit it now" : "Only you can edit it now");
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }

  const changedMeanwhile = draft !== null && !conflict && meta.noteVersion !== base;

  return (
    <div className="space-y-4">
      {owner && <ShareCard code={meta.code} expiresAt={meta.expiresAt} />}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge icon={<TextIcon />}>Text</Badge>
          <Badge icon={<LockIcon />}>{meta.editable ? "Anyone with the code can edit" : "Read only"}</Badge>
          {!owner && <Badge icon={<ClockIcon />}>{formatRemaining(meta.expiresAt, now)}</Badge>}
          {!owner && (
            <Badge>
              <span className="font-mono">{formatCode(meta.code)}</span>
            </Badge>
          )}
        </div>

        {draft === null ? (
          <div className="mt-4 rounded-xl border border-line bg-bg p-4 sm:p-5">
            <Reading text={text} />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border-2 border-accent/60 bg-bg p-3 sm:p-4">
            <textarea
              ref={editor}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canEdit) void save();
                if (e.key === "Escape" && draft === text) setDraft(null);
              }}
              aria-label="Text"
              spellCheck={false}
              className="block min-h-48 w-full resize-none bg-transparent text-[15px] leading-7 outline-none"
            />
          </div>
        )}

        {draft !== null && !canEdit && (
          <Notice tone="warn" icon={<AlertIcon />} className="mt-3">
            Its owner has made this text read-only, so your changes can&apos;t be saved. Copy them first if you need them.
          </Notice>
        )}
        {changedMeanwhile && (
          <Notice tone="warn" icon={<AlertIcon />} className="mt-3">
            Someone else changed this text while you were editing. Saving will ask which to keep.
          </Notice>
        )}
        {conflict && (
          <div className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-warn">
              <AlertIcon className="size-4 shrink-0" />
              Someone else saved first. This is what they saved:
            </p>
            <div className="mt-2 max-h-48 overflow-auto rounded-lg bg-bg p-3">
              <Reading text={conflict.text} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => save(conflict.version)} disabled={saving}>
                Keep mine
              </Button>
              <Button
                onClick={() => {
                  setDraft(null);
                  setConflict(null);
                  reloadTransfer(meta.code);
                }}
              >
                Use theirs
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {draft === null ? (
            <>
              <Button variant="primary" onClick={copy} disabled={!text}>
                <CopyIcon className="size-4" />
                Copy
              </Button>
              {canEdit && <Button onClick={edit}>Edit</Button>}
            </>
          ) : (
            <>
              {!conflict && (
                <Button variant="primary" onClick={() => save()} disabled={saving || !canEdit}>
                  {saving && <Spinner className="size-4" />}
                  Save
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setConflict(null);
                }}
              >
                Cancel
              </Button>
            </>
          )}
          {owner && (
            <span className="ml-auto">
              <ConfirmButton onConfirm={() => removeTransfer(meta.code, token)}>Delete</ConfirmButton>
            </span>
          )}
        </div>

        {owner && (
          <div className="mt-5">
            <Field label="Who can edit" hint="Anyone with the code can always read it. You can change this whenever you like.">
              <Segmented label="Who can edit" value={meta.editable ? "anyone" : "owner"} options={EDITORS} onChange={chooseEditors} />
            </Field>
          </div>
        )}
      </Card>
    </div>
  );
}

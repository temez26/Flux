import { useEffect, useEffectEvent, useState } from "react";
import { saveNote, type NoteState, type TransferMeta } from "@/lib/api";
import { reloadTransfer, useLeaveGuard } from "@/lib/hooks";

/** A pause in typing this long saves what was typed. */
const SAVE_DELAY_MS = 800;
const RETRY_MS = 3000;

export type SaveStatus = "saved" | "unsaved" | "saving" | "failed";

/**
 * Editing a text that others may be reading or editing at the same time. What is typed saves by
 * itself after a pause. Saves by others show up straight away while nothing here is unsaved;
 * when both changed it at once, the later save is refused and `conflict` holds what the other
 * saved, to keep either.
 */
export function useNoteEditor(meta: TransferMeta, token: string | undefined, canEdit: boolean) {
  const [editing, setEditing] = useState(false);
  /** What was typed here and isn't saved yet, and the version it was typed over. */
  const [edits, setEdits] = useState<NoteState | null>(null);
  /** The last save from here, shown until the text loaded from the server catches up with it. */
  const [saved, setSaved] = useState<NoteState | null>(null);
  const [conflict, setConflict] = useState<NoteState | null>(null);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState(0);
  /** Done was chosen with changes still to save; editing ends once they are. */
  const [closing, setClosing] = useState(false);
  useLeaveGuard(!!edits);

  // Versions only move forward, so a save from here outranks a load that started before it.
  const latest =
    saved && saved.version > meta.noteVersion ? saved : { text: meta.note ?? "", version: meta.noteVersion };
  const text = edits?.text ?? latest.text;

  const save = useEffectEvent(async () => {
    if (!edits) return;
    setSaving(true);
    try {
      const result = await saveNote(meta.code, token, edits.text, edits.version);
      if ("conflict" in result) return setConflict(result.conflict);
      const version = result.saved.version;
      setSaved({ text: edits.text, version });
      setFailures(0);
      // Typing carried on while it saved: keep that, now typed over the version just saved.
      setEdits((current) => (current && current.text !== edits.text ? { ...current, version } : null));
    } catch {
      setFailures((n) => n + 1);
      // Refused because its owner made it read-only, most likely; loading it again shows that.
      reloadTransfer(meta.code);
    } finally {
      setSaving(false);
    }
  });

  useEffect(() => {
    if (!edits || conflict || saving || !canEdit) return;
    const timer = window.setTimeout(save, closing ? 0 : failures ? RETRY_MS : SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [edits, conflict, saving, canEdit, closing, failures]);

  if (closing && !edits && !saving) {
    setClosing(false);
    setEditing(false);
  }

  const status: SaveStatus = saving ? "saving" : failures ? "failed" : edits ? "unsaved" : "saved";

  return {
    text,
    editing,
    status,
    conflict,
    /** Changes typed here that can't be saved, because editing was taken away meanwhile. */
    stranded: !!edits && !canEdit,
    edit: () => setEditing(true),
    change: (value: string) => setEdits({ text: value, version: edits?.version ?? latest.version }),
    done() {
      if (edits && canEdit) return setClosing(true);
      setEdits(null);
      setEditing(false);
    },
    keepMine() {
      if (!edits || !conflict) return;
      setEdits({ text: edits.text, version: conflict.version });
      setConflict(null);
    },
    takeTheirs() {
      if (!conflict) return;
      setSaved(conflict);
      setEdits(null);
      setConflict(null);
      setClosing(false);
      reloadTransfer(meta.code);
    },
  };
}

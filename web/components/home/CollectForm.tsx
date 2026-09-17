"use client";

import { useState, type FormEvent } from "react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/lib/alerts/toast";
import { navigate } from "@/lib/platform/router";
import { collect } from "@/lib/transfer/session";
import { formatCode } from "@/lib/util/format";
import { FolderIcon } from "../ui/icons";
import { Button, Field, Spinner } from "../ui/ui";

/** Opens a collection: a code other people use to send files here, rather than to receive them. */
export function CollectForm({ expiresIn }: { expiresIn: number }) {
  // Null while folded away; the name being typed once opened.
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const code = await collect(expiresIn, name?.trim() || undefined);
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      toast(errorMessage(err), "err");
      setBusy(false);
    }
  }

  if (name === null) {
    return (
      <button
        type="button"
        onClick={() => setName("")}
        className="mt-3 flex items-center gap-1.5 text-sm text-muted transition hover:text-fg"
      >
        <FolderIcon className="size-4" />
        Collect files from others instead
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-4">
      <Field label="Collect files" hint="Anyone you give the code to can add files, and download what's there.">
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="What for? e.g. Holiday photos"
            aria-label="Name of the collection"
            enterKeyHint="go"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 text-base outline-none placeholder:text-muted/60 focus:border-accent"
          />
          <Button type="submit" variant="primary" className="min-h-12 px-5" disabled={busy}>
            {busy ? <Spinner className="size-4" /> : <FolderIcon className="size-4" />}
            Create
          </Button>
        </div>
      </Field>
      <button type="button" onClick={() => setName(null)} className="mt-2 text-sm text-muted transition hover:text-fg">
        Cancel
      </button>
    </form>
  );
}

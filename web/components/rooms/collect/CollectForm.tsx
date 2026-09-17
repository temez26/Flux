"use client";

import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "@/lib/api";
import { navigate } from "@/lib/platform/router";
import { collect } from "@/lib/transfer/session";
import { formatCode } from "@/lib/util/format";
import { AlertIcon, FolderIcon } from "../../ui/icons";
import { Button, Notice, Spinner } from "../../ui/ui";
import { ExpiryNote } from "../../settings/ExpiryNote";
import { useExpiry } from "../../settings/expiry";

/** Opens a collection: a code other people use to send files here, rather than to receive them. */
export function CollectForm() {
  const [name, setName] = useState("");
  const [expiresIn] = useExpiry();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const code = await collect(expiresIn, name.trim() || undefined);
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor={nameId} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
          What for
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Holiday photos"
          aria-describedby={`${nameId}-hint`}
          enterKeyHint="go"
          className="min-h-12 w-full rounded-xl border border-line bg-bg px-4 text-base outline-none placeholder:text-muted/60 focus:border-accent"
        />
        <p id={`${nameId}-hint`} className="mt-1.5 text-xs text-muted">
          Optional. Anyone you give the code to can add files, and download what&apos;s there.
        </p>
      </div>
      <ExpiryNote />
      {error && (
        <Notice tone="err" role="alert" icon={<AlertIcon />}>
          {error}
        </Notice>
      )}
      <Button type="submit" variant="primary" className="w-full @md:w-auto" disabled={busy}>
        {busy ? <Spinner className="size-4" /> : <FolderIcon className="size-4" />}
        Start collecting
      </Button>
    </form>
  );
}

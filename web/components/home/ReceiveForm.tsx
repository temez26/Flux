"use client";

import { useState, type FormEvent } from "react";
import { navigate } from "@/lib/platform/router";
import { formatCode, normalizeCode } from "@/lib/util/format";
import { AlertIcon, ArrowIcon } from "../ui/icons";
import { Button, Field } from "../ui/ui";

export function ReceiveForm() {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = normalizeCode(value);
    if (code) navigate(`/${formatCode(code)}`);
    else setInvalid(true);
  }

  return (
    <form onSubmit={submit}>
      <Field label="Have a code?">
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
            placeholder="abcd-efgh"
            aria-label="Transfer code"
            aria-invalid={invalid}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 font-mono text-base tracking-wider outline-none placeholder:text-muted/60 focus:border-accent aria-invalid:border-err"
          />
          <Button type="submit" variant="primary" className="min-h-12 px-5">
            Open
            <ArrowIcon className="size-4" />
          </Button>
        </div>
      </Field>
      {invalid && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-err">
          <AlertIcon className="size-4" />
          Codes look like abcd-efgh.
        </p>
      )}
    </form>
  );
}

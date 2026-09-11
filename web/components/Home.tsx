"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { errorMessage } from "@/lib/api";
import { fromDataTransfer, fromFileList, type Picked } from "@/lib/files";
import { formatBytes, formatCode, formatRemaining, normalizeCode, plural } from "@/lib/format";
import { listOwned } from "@/lib/owned";
import { navigate } from "@/lib/router";
import { send } from "@/lib/session";
import { ArrowIcon, FolderIcon, UploadIcon } from "./icons";
import { Button, Card } from "./ui";

const EXPIRY = [
  ["1 hour", 3600],
  ["1 day", 86_400],
  ["7 days", 604_800],
] as const;
const EXPIRY_KEY = "flux.expiry";
const folderInputProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;

function storedExpiry(): number {
  try {
    const value = Number(localStorage.getItem(EXPIRY_KEY));
    return EXPIRY.some(([, s]) => s === value) ? value : 86_400;
  } catch {
    return 86_400;
  }
}

export default function Home() {
  const [expiresIn, setExpiresIn] = useState(storedExpiry);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const expiryRef = useRef(expiresIn);
  const canPickFolder = window.matchMedia("(pointer: fine)").matches;

  const start = useCallback(async (picked: Picked[] | Promise<Picked[]>) => {
    setError(null);
    setBusy("Reading files…");
    try {
      const files = await picked;
      if (!files.length) return setBusy(null);
      setBusy(`Preparing ${plural(files.length, "file")}…`);
      const code = await send(files, expiryRef.current);
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }, []);

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

  function chooseExpiry(seconds: number) {
    setExpiresIn(seconds);
    expiryRef.current = seconds;
    try {
      localStorage.setItem(EXPIRY_KEY, String(seconds));
    } catch {}
  }

  return (
    <div className="space-y-8">
      <section>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileInput.current?.click()}
          className={`flex h-56 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 text-center transition sm:h-64 ${
            dragging ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/60"
          }`}
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <UploadIcon className="size-7" />
          </span>
          <span className="text-lg font-semibold">{busy ?? (dragging ? "Drop to send" : "Send files")}</span>
          {!busy && (
            <span className="text-sm text-muted">
              {canPickFolder ? "Drop files or folders here, or click to choose" : "Tap to choose files"}
            </span>
          )}
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Expires after</span>
            <div className="flex rounded-xl border border-line bg-surface p-0.5" role="radiogroup" aria-label="Expiry">
              {EXPIRY.map(([label, seconds]) => (
                <button
                  key={seconds}
                  type="button"
                  role="radio"
                  aria-checked={expiresIn === seconds}
                  onClick={() => chooseExpiry(seconds)}
                  className={`min-h-10 rounded-[10px] px-3 transition ${
                    expiresIn === seconds ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {canPickFolder && (
            <Button disabled={!!busy} onClick={() => folderInput.current?.click()}>
              <FolderIcon className="size-4" />
              Send a folder
            </Button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-err">{error}</p>}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void start(fromFileList(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          {...folderInputProps}
          onChange={(e) => {
            void start(fromFileList(e.target.files));
            e.target.value = "";
          }}
        />
      </section>

      <ReceiveForm />
      <OwnedList />
    </div>
  );
}

function ReceiveForm() {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = normalizeCode(value);
    if (code) navigate(`/${formatCode(code)}`);
    else setInvalid(true);
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-muted">Receive</h2>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          placeholder="Enter code, e.g. abcd-efgh"
          aria-label="Transfer code"
          aria-invalid={invalid}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 font-mono text-base outline-none placeholder:font-sans placeholder:text-muted focus:border-accent aria-invalid:border-err"
        />
        <Button type="submit" variant="primary" className="min-h-12 px-5" aria-label="Open transfer">
          <ArrowIcon />
        </Button>
      </form>
      {invalid && <p className="mt-2 text-sm text-err">Codes look like abcd-efgh.</p>}
    </section>
  );
}

function OwnedList() {
  const [owned] = useState(listOwned);
  if (!owned.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-muted">Your transfers</h2>
      <Card className="divide-y divide-line !p-0">
        {owned.map(([code, o]) => (
          <button
            key={code}
            type="button"
            onClick={() => navigate(`/${formatCode(code)}`)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-hover"
          >
            <span className="font-mono font-medium">{formatCode(code)}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {plural(o.count, "file")} · {formatBytes(o.size)}
            </span>
            <span className="hidden text-xs text-muted sm:inline">{formatRemaining(o.expiresAt)}</span>
            <ArrowIcon className="size-4 text-muted" />
          </button>
        ))}
      </Card>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { errorMessage, getSummary, listPublic, type Summary } from "@/lib/api";
import { fromDataTransfer, fromFileList, type Picked } from "@/lib/files";
import { formatBytes, formatCode, formatRemaining, normalizeCode, plural } from "@/lib/format";
import { useNow, usePolling } from "@/lib/hooks";
import { listOwned, removeOwned } from "@/lib/owned";
import { navigate } from "@/lib/router";
import { live, send } from "@/lib/session";
import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileTypeIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  PauseIcon,
  UploadIcon,
} from "./icons";
import { Badge, Button, Card, Field, SectionTitle, Segmented, Spinner } from "./ui";

const EXPIRY = [
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86_400 },
  { label: "7 days", value: 604_800 },
];
const VISIBILITY = [
  { label: "Private", value: "private", icon: <LockIcon className="size-4" /> },
  { label: "Public", value: "public", icon: <GlobeIcon className="size-4" /> },
];
const EXPIRY_KEY = "flux.expiry";
const LIST_POLL_MS = 15_000;
const folderInputProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>;

function storedExpiry(): number {
  try {
    const value = Number(localStorage.getItem(EXPIRY_KEY));
    return EXPIRY.some((e) => e.value === value) ? value : 86_400;
  } catch {
    return 86_400;
  }
}

export default function Home() {
  const [expiresIn, setExpiresIn] = useState(storedExpiry);
  // Deliberately not remembered: publishing should always be a conscious choice.
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const options = useRef({ expiresIn, isPublic });
  const canPickFolder = window.matchMedia("(pointer: fine)").matches;

  const start = useCallback(async (picked: Picked[] | Promise<Picked[]>) => {
    setError(null);
    setBusy("Reading files…");
    try {
      const files = await picked;
      if (!files.length) return setBusy(null);
      setBusy(`Preparing ${plural(files.length, "file")}…`);
      const code = await send(files, options.current.expiresIn, options.current.isPublic);
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
    options.current.expiresIn = seconds;
    try {
      localStorage.setItem(EXPIRY_KEY, String(seconds));
    } catch {}
  }

  function chooseVisibility(value: string) {
    options.current.isPublic = value === "public";
    setIsPublic(value === "public");
  }

  const pick = (kind: "files" | "folder") => (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    (kind === "files" ? fileInput : folderInput).current?.click();
  };

  return (
    <div className="space-y-4">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-bg/80 p-4 backdrop-blur-sm">
          <div className="flex size-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent text-accent">
            <UploadIcon className="size-10" />
            <p className="text-lg font-semibold">Drop to send</p>
          </div>
        </div>
      )}

      <Card>
        <SectionTitle icon={<UploadIcon className="size-4.5" />}>Send</SectionTitle>
        <div
          onClick={() => !busy && fileInput.current?.click()}
          className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${
            busy ? "cursor-default border-line" : "border-line hover:border-accent/60 hover:bg-hover/50"
          }`}
        >
          {busy ? (
            <>
              <Spinner className="size-7 text-accent" />
              <p className="font-medium">{busy}</p>
            </>
          ) : (
            <>
              <div>
                <p className="font-semibold">{canPickFolder ? "Drop files or folders here" : "Send photos, videos or any files"}</p>
                <p className="mt-1 text-sm text-muted">Any size, any number of files</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={pick("files")}>
                  <UploadIcon className="size-4" />
                  Choose files
                </Button>
                {canPickFolder && (
                  <Button onClick={pick("folder")}>
                    <FolderIcon className="size-4" />
                    Choose folder
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Who can open it" hint={isPublic ? "Listed on this page for anyone who opens Flux." : "Only people with the code or link."}>
            <Segmented label="Visibility" value={isPublic ? "public" : "private"} options={VISIBILITY} onChange={chooseVisibility} />
          </Field>
          <Field label="Delete after" hint="Files are removed automatically.">
            <Segmented label="Expiry" value={expiresIn} options={EXPIRY} onChange={chooseExpiry} />
          </Field>
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-err/10 p-3 text-sm text-err">
            <AlertIcon className="size-4 shrink-0" />
            {error}
          </p>
        )}
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
      </Card>

      <Card>
        <SectionTitle icon={<DownloadIcon className="size-4.5" />}>Receive</SectionTitle>
        <ReceiveForm />
        <PublicList />
      </Card>

      <OwnedList />
    </div>
  );
}

function TransferRow({ code, icon, title, detail, badge, mono = false }: { code: string; icon: ReactNode; title: string; detail: string; badge?: ReactNode; mono?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/${formatCode(code)}`)}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-hover"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${mono ? "font-mono" : ""}`}>{title}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      {badge && <span className="shrink-0">{badge}</span>}
      <ArrowIcon className="size-4 shrink-0 text-muted" />
    </button>
  );
}

function PublicList() {
  const now = useNow(60_000);
  const [list, setList] = useState<Summary[] | null>(null);
  usePolling(async () => setList(await listPublic()), LIST_POLL_MS);

  if (!list) return null;
  return (
    <div className="mt-6">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <GlobeIcon className="size-4 text-muted" />
        Public files
        {list.length > 0 && <Badge>{list.length}</Badge>}
      </p>
      {list.length ? (
        list.map((t) => (
          <TransferRow
            key={t.code}
            code={t.code}
            icon={t.files > 1 ? <FolderIcon className="size-4.5" /> : <FileTypeIcon path={t.title} className="size-4.5" />}
            title={t.title}
            detail={`${plural(t.files, "file")} · ${formatBytes(t.size)} · ${formatRemaining(t.expiresAt, now)}`}
            badge={!t.complete && <Badge tone="accent" icon={<Spinner className="size-3" />}>Uploading</Badge>}
          />
        ))
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">Nothing is shared publicly right now.</p>
      )}
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

const small = "size-3";

function ownedBadge(code: string, summary: Summary | undefined): ReactNode {
  if (!summary) return null;
  if (summary.complete) {
    return (
      <Badge tone="ok" icon={<CheckIcon className={small} />}>
        Ready
      </Badge>
    );
  }
  const uploader = live.get(code)?.uploader;
  if (!uploader) {
    return (
      <Badge tone="warn" icon={<AlertIcon className={small} />}>
        Interrupted
      </Badge>
    );
  }
  return uploader.paused ? (
    <Badge tone="warn" icon={<PauseIcon className={small} />}>
      Paused
    </Badge>
  ) : (
    <Badge tone="accent" icon={<Spinner className={small} />}>
      Uploading
    </Badge>
  );
}

function OwnedList() {
  const [owned, setOwned] = useState(listOwned);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});

  // Checks each transfer made on this device, so deleted ones disappear and states are real.
  usePolling(async () => {
    const results = await Promise.all(listOwned().map(async ([code]) => [code, await getSummary(code)] as const));
    const found: Record<string, Summary> = {};
    for (const [code, summary] of results) {
      if (summary) found[code] = summary;
      else removeOwned(code);
    }
    setOwned(listOwned());
    setSummaries(found);
  }, LIST_POLL_MS);

  if (!owned.length) return null;
  return (
    <Card>
      <SectionTitle icon={<ClockIcon className="size-4.5" />}>Your transfers</SectionTitle>
      {owned.map(([code, o]) => (
        <TransferRow
          key={code}
          code={code}
          mono
          icon={o.public ? <GlobeIcon className="size-4.5" /> : <LockIcon className="size-4.5" />}
          title={formatCode(code)}
          detail={`${plural(o.count, "file")} · ${formatBytes(o.size)} · ${formatRemaining(o.expiresAt)}`}
          badge={ownedBadge(code, summaries[code])}
        />
      ))}
    </Card>
  );
}

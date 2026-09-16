"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EXPIRY_OPTIONS, errorMessage, getSummary, listPublic, type Summary } from "@/lib/api";
import { fromClipboard, fromDataTransfer, fromText, type Picked } from "@/lib/files";
import { formatBytes, formatCode, formatLifetime, formatRemaining, normalizeCode, plural } from "@/lib/format";
import { nextPaint, useNow, usePolling } from "@/lib/hooks";
import { listOwned, removeOwned } from "@/lib/owned";
import { navigate } from "@/lib/router";
import { offerTitle, type Peer } from "@/lib/nearby";
import { collect, live, send } from "@/lib/session";
import { toast } from "@/lib/toast";
import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileTypeIcon,
  DeviceIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  PauseIcon,
  SearchIcon,
  TextIcon,
  UploadIcon,
} from "./icons";
import { getNearby, NearbyDevices } from "./nearby";
import { canPickFolder, useFilePickers } from "./picker";
import { Badge, Button, Card, Field, Notice, SectionTitle, Segmented, Spinner } from "./ui";

const EXPIRY = EXPIRY_OPTIONS;
const VISIBILITY = [
  { label: "Private", value: "private", icon: <LockIcon className="size-4" /> },
  { label: "Public", value: "public", icon: <GlobeIcon className="size-4" /> },
];
const DELIVERY = [
  { label: "Upload", value: "server", icon: <UploadIcon className="size-4" /> },
  { label: "This device", value: "device", icon: <DeviceIcon className="size-4" /> },
];
const EXPIRY_KEY = "flux.expiry";
// A share from this device ends with the page, so its code only needs to outlast any
// plausible sitting; the row holds a file list and nothing else.
const HOSTED_EXPIRY = 604_800;
const LIST_POLL_MS = 15_000;
/** One page of the public listing, and how many make a listing worth searching. */
const PUBLIC_PAGE = 100;
const PUBLIC_SEARCH_FROM = 12;

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
  // Deliberately not remembered: publishing should always be a conscious choice, and so
  // should sharing from this device, which only lasts as long as the page stays open.
  const [isPublic, setIsPublic] = useState(false);
  const [hosted, setHosted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** A nearby device the next files are offered to, instead of only handing out a code. */
  const [target, setTarget] = useState<Peer | null>(null);
  /** Text being written to send instead of files; null while choosing files. */
  const [text, setText] = useState<string | null>(null);
  const options = useRef({ expiresIn, isPublic, hosted, target: null as Peer | null });
  const folders = canPickFolder();

  const start = useCallback(async (picked: Picked[] | Promise<Picked[]>) => {
    setError(null);
    setBusy("Reading files…");
    try {
      const files = await picked;
      if (!files.length) return setBusy(null);
      setBusy(`Preparing ${plural(files.length, "file")}…`);
      // Reading every file's metadata blocks the main thread, so let the spinner land first.
      await nextPaint();
      const code = await send(files, options.current.hosted ? HOSTED_EXPIRY : options.current.expiresIn, options.current.isPublic, options.current.hosted);
      const to = options.current.target;
      if (to) {
        const nearby = getNearby();
        // The transfer exists either way, so a device that left only costs the offer.
        if (nearby.peers.some((p) => p.device === to.device)) {
          nearby.offer(to, {
            code,
            title: offerTitle(files.map((f) => f.path)),
            files: files.length,
            size: files.reduce((sum, f) => sum + f.file.size, 0),
          });
          toast(`Offered to ${to.name}`);
        } else {
          toast(`${to.name} is no longer nearby — share the code instead`, "err");
        }
      }
      navigate(`/${formatCode(code)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }, []);

  const picker = useFilePickers((picked) => void start(picked));
  const status = busy ?? (picker.waiting ? "Getting your files…" : null);

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

  // Pasting a copied screenshot or file sends it the way dropping it would, and pasted text
  // opens the text box. A paste into a field on the page is left to that field.
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const into = e.target instanceof Element ? e.target : null;
      if (!e.clipboardData || into?.closest("input, textarea, [contenteditable]")) return;
      if (e.clipboardData.files.length) {
        e.preventDefault();
        void start(fromClipboard(e.clipboardData.files));
        return;
      }
      const pasted = e.clipboardData.getData("text/plain");
      if (!pasted.trim()) return;
      e.preventDefault();
      setText((current) => (current ?? "") + pasted);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
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

  function chooseDelivery(value: string) {
    options.current.hosted = value === "device";
    setHosted(value === "device");
  }

  function chooseTarget(peer: Peer | null) {
    options.current.target = peer;
    setTarget(peer);
  }

  // Choosing a device goes straight on to choosing files; choosing it again lets it go.
  function chooseDevice(peer: Peer) {
    if (target?.device === peer.device) return chooseTarget(null);
    chooseTarget(peer);
    if (text === null) picker.open("files");
  }

  function sendText() {
    if (text?.trim()) void start(fromText(text));
  }

  // The drop zone around these buttons opens the file picker too.
  const pick = (kind: "files" | "folder") => (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    picker.open(kind);
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
        {text !== null && !status ? (
          <div className="rounded-2xl border-2 border-line p-3 focus-within:border-accent/60">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendText();
              }}
              placeholder="Paste a link, a note, a password…"
              aria-label="Text to send"
              spellCheck={false}
              className="block min-h-40 w-full resize-y bg-transparent text-base outline-none placeholder:text-muted/60"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={sendText} disabled={!text.trim()}>
                <TextIcon className="size-4" />
                {target ? `Send text to ${target.name}` : "Send text"}
              </Button>
              <Button variant="ghost" onClick={() => setText(null)}>
                Send files instead
              </Button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => !busy && picker.open("files")}
            className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${
              status ? "cursor-default border-line" : "border-line hover:border-accent/60 hover:bg-hover/50"
            }`}
          >
            {status ? (
              <>
                <Spinner className="size-7 text-accent" />
                <p className="font-medium">{status}</p>
                {picker.stalled && (
                  <p className="max-w-xs text-sm text-muted">
                    Still nothing. Phones quietly give up on very large selections — try a few hundred files at a time.
                  </p>
                )}
              </>
            ) : (
              <>
                <div>
                  <p className="font-semibold">
                    {target ? `Choose what to send to ${target.name}` : folders ? "Drop files or folders here" : "Send photos, videos or any files"}
                  </p>
                  <p className="mt-1 text-sm text-muted">{folders ? "Any size, any number of files — or paste them" : "Any size, any number of files"}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={pick("files")}>
                    <UploadIcon className="size-4" />
                    Choose files
                  </Button>
                  {folders && (
                    <Button onClick={pick("folder")}>
                      <FolderIcon className="size-4" />
                      Choose folder
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setText("");
                    }}
                  >
                    <TextIcon className="size-4" />
                    Send text
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {target && (
          <p className="mt-3 flex items-center gap-2 text-sm">
            <DeviceIcon className="size-4 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              Sending to <span className="font-medium">{target.name}</span>
            </span>
            <button type="button" onClick={() => chooseTarget(null)} className="text-muted transition hover:text-fg">
              Cancel
            </button>
          </p>
        )}
        <NearbyDevices target={target} onChoose={chooseDevice} />

        <div className="mt-5 space-y-4">
          <Field
            label="Where the files live"
            hint={
              hosted
                ? "Nothing is uploaded, and the code works only while this page is open."
                : "Files are stored on the server, so the link works after you close this page."
            }
          >
            <Segmented label="Delivery" value={hosted ? "device" : "server"} options={DELIVERY} onChange={chooseDelivery} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who can open it" hint={isPublic ? "Listed on this page for anyone who opens Flux." : "Only people with the code or link."}>
              <Segmented label="Visibility" value={isPublic ? "public" : "private"} options={VISIBILITY} onChange={chooseVisibility} />
            </Field>
            {!hosted && (
              <Field label="Delete after" hint="Files are removed automatically.">
                <Segmented label="Expiry" value={expiresIn} options={EXPIRY} onChange={chooseExpiry} />
              </Field>
            )}
          </div>
        </div>

        {error && (
          <Notice tone="err" icon={<AlertIcon />} className="mt-4">
            {error}
          </Notice>
        )}
        {picker.inputs}
      </Card>

      <Card>
        <SectionTitle icon={<DownloadIcon className="size-4.5" />}>Receive</SectionTitle>
        <ReceiveForm />
        <CollectForm expiresIn={expiresIn} />
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
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PUBLIC_PAGE);
  const needle = query.trim();

  // Asking for the pages already on screen keeps a refresh from dropping what was opened up.
  usePolling(async () => setList(await listPublic({ q: needle, limit })), LIST_POLL_MS);

  if (!list) return null;
  // A full page is the only sign there may be more; the server doesn't count the rest.
  const more = list.length === limit;
  const searchable = needle !== "" || list.length >= PUBLIC_SEARCH_FROM;

  return (
    <div className="mt-6">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <GlobeIcon className="size-4 text-muted" />
        Public files
        {list.length > 0 && <Badge>{more ? `${list.length}+` : list.length}</Badge>}
      </p>
      {searchable && (
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PUBLIC_PAGE);
            }}
            placeholder="Search public files"
            aria-label="Search public files"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-xl border border-line bg-bg pr-3 pl-9 text-base outline-none placeholder:text-muted/60 focus:border-accent"
          />
        </div>
      )}
      {list.length ? (
        list.map((t) => (
          <TransferRow
            key={t.code}
            code={t.code}
            icon={t.files > 1 ? <FolderIcon className="size-4.5" /> : <FileTypeIcon path={t.title} className="size-4.5" />}
            title={t.title}
            detail={`${plural(t.files, "file")} · ${formatBytes(t.size)} · ${formatRemaining(t.expiresAt, now)}`}
            badge={
              t.hosted ? (
                <Badge icon={<DeviceIcon />}>From a device</Badge>
              ) : (
                !t.complete && (
                  <Badge tone="accent" icon={<Spinner />}>
                    Uploading
                  </Badge>
                )
              )
            }
          />
        ))
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          {needle ? `Nothing public matches “${needle}”.` : "Nothing is shared publicly right now."}
        </p>
      )}
      {more && (
        <Button className="mt-2 w-full" onClick={() => setLimit((n) => n + PUBLIC_PAGE)}>
          Show more
        </Button>
      )}
    </div>
  );
}

/** Opens a collection: a code other people use to send files here, rather than to receive them. */
function CollectForm({ expiresIn }: { expiresIn: number }) {
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
      <button type="button" onClick={() => setName("")} className="mt-3 flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
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

function ownedBadge(code: string, summary: Summary | undefined): ReactNode {
  if (!summary) return null;
  if (summary.collect) {
    return summary.closed ? (
      <Badge icon={<LockIcon />}>Closed</Badge>
    ) : (
      <Badge tone="accent" icon={<FolderIcon />}>
        Collecting
      </Badge>
    );
  }
  // A hosted transfer only exists while this tab is serving it, so that is what to report.
  if (summary.hosted) {
    return live.has(code) ? (
      <Badge tone="ok" icon={<DeviceIcon />}>
        Sharing
      </Badge>
    ) : (
      <Badge tone="warn" icon={<AlertIcon />}>
        Not shared
      </Badge>
    );
  }
  if (summary.complete) {
    return (
      <Badge tone="ok" icon={<CheckIcon />}>
        Ready
      </Badge>
    );
  }
  const uploader = live.get(code)?.uploader;
  if (!uploader) {
    return (
      <Badge tone="warn" icon={<AlertIcon />}>
        Interrupted
      </Badge>
    );
  }
  return uploader.paused ? (
    <Badge tone="warn" icon={<PauseIcon />}>
      Paused
    </Badge>
  ) : (
    <Badge tone="accent" icon={<Spinner />}>
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
      {owned.map(([code, o]) => {
        // The server's count is the current one: files can be added after this device made it.
        const summary = summaries[code];
        const count = summary?.files ?? o.count;
        const size = summary?.size ?? o.size;
        return (
          <TransferRow
            key={code}
            code={code}
            mono
            icon={o.collect ? <FolderIcon className="size-4.5" /> : o.public ? <GlobeIcon className="size-4.5" /> : <LockIcon className="size-4.5" />}
            title={o.collect && summary ? `${formatCode(code)} · ${summary.title}` : formatCode(code)}
            detail={[
              plural(count, "file"),
              formatBytes(size),
              summary?.downloads ? plural(summary.downloads, "download") : null,
              formatLifetime(o.expiresAt, !!o.hosted, live.has(code)),
            ]
              .filter(Boolean)
              .join(" · ")}
            badge={ownedBadge(code, summary)}
          />
        );
      })}
    </Card>
  );
}

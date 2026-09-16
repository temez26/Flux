"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, updateTransfer, zipUrl, type TransferMeta } from "@/lib/api";
import { formatBytes, formatCode, plural } from "@/lib/format";
import { reloadTransfer, useTitle } from "@/lib/hooks";
import { notify } from "@/lib/notify";
import { toast } from "@/lib/toast";
import { FileBrowser } from "../FileList";
import { DownloadIcon, FolderIcon, LockIcon } from "../icons";
import { PreviewDialog } from "../preview/Preview";
import { ShareCard } from "../ShareCard";
import { Button, ConfirmButton, StatusCard, buttonClass } from "../ui";
import { MetaRow, MetaTile, SelectionDownload, pageTitle, removeOwnedFile, removeTransfer, summarize } from "./common";

/**
 * A collection this device opened: the code to hand out, and everything that has arrived,
 * which fills in as people add to it.
 */
export function CollectPanel({ meta, token }: { meta: TransferMeta; token: string }) {
  const { size, complete, ready } = summarize(meta.files);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const paths = useMemo(() => meta.files.map((f) => f.path), [meta]);
  const arriving = meta.files.length - complete;
  const [closing, setClosing] = useState(false);

  async function setClosed(closed: boolean) {
    setClosing(true);
    try {
      await updateTransfer(meta.code, token, { closed });
      reloadTransfer(meta.code);
      toast(closed ? "Stopped collecting — what's here stays" : "Collecting again");
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setClosing(false);
    }
  }
  useTitle(pageTitle(meta.code));

  // Anyone may add at any moment, so arrivals are worth hearing about while the page is out of sight.
  const arrived = useRef(complete);
  useEffect(() => {
    if (complete > arrived.current) {
      void notify(`${plural(complete - arrived.current, "new file")} in ${meta.title}`, formatCode(meta.code), `collect-${meta.code}`);
    }
    arrived.current = complete;
  }, [complete, meta.title, meta.code]);

  const stats: [string, string][] = [
    ["Files", complete.toLocaleString()],
    ["Size", formatBytes(size)],
  ];
  if (arriving) stats.push(["Arriving", arriving.toLocaleString()]);
  stats.push(["Downloads", meta.downloads.toLocaleString()]);

  return (
    <div className="space-y-4">
      <ShareCard code={meta.code} expiresAt={meta.expiresAt} />
      <StatusCard
        tone={meta.closed ? "muted" : "accent"}
        icon={meta.closed ? <LockIcon /> : <FolderIcon />}
        title={meta.closed ? `Closed: ${meta.title}` : `Collecting: ${meta.title}`}
        subtitle={
          meta.closed
            ? "Nothing more can be added. Anyone with the code can still download what's here until it expires."
            : "Anyone with the code can add files, and download what's here, until it expires."
        }
        stats={stats}
        actions={
          <>
            {complete > 1 && ready && (
              <a href={zipUrl(meta.code)} download className={buttonClass("primary")}>
                <DownloadIcon className="size-4" />
                Download all as .zip
              </a>
            )}
            <Button onClick={() => setClosed(!meta.closed)} disabled={closing}>
              {meta.closed ? <FolderIcon className="size-4" /> : <LockIcon className="size-4" />}
              {meta.closed ? "Collect again" : "Stop collecting"}
            </Button>
          </>
        }
        danger={<ConfirmButton onConfirm={() => removeTransfer(meta.code, token)}>Delete collection</ConfirmButton>}
      />
      {meta.files.length ? (
        <FileBrowser
          paths={paths}
          renderRow={(i) => (
            <MetaRow
              file={meta.files[i]}
              code={meta.code}
              downloadable
              onPreview={setPreviewing}
              onRemove={() => removeOwnedFile(meta.code, token, meta.files[i])}
            />
          )}
          renderTile={(i) => <MetaTile file={meta.files[i]} code={meta.code} onPreview={setPreviewing} />}
          select={(indices) => <SelectionDownload code={meta.code} files={indices.map((i) => meta.files[i])} />}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing yet. Share the code, and files appear here as people add them.
        </p>
      )}
      <PreviewDialog code={meta.code} files={meta.files} idx={previewing} onChange={setPreviewing} />
    </div>
  );
}

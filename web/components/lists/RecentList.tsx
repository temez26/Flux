"use client";

import { useSyncExternalStore } from "react";
import { getReceived } from "@/lib/storage/received";
import { clearRecent, forgetRecent, listRecent, recentVersion, subscribeRecent } from "@/lib/storage/recent";
import { formatBytes, formatRemaining, plural } from "@/lib/util/format";
import { CheckIcon, DownloadIcon, FileTypeIcon, FolderIcon, TextIcon } from "../ui/icons";
import { Badge, Card, SectionTitle } from "../ui/ui";
import { TransferRow } from "./TransferRow";
import { useSummaries } from "./useSummaries";

/** Transfers this device opened someone else's code for, to get back to without the code. */
export function RecentList() {
  useSyncExternalStore(subscribeRecent, recentVersion, recentVersion);
  const recent = listRecent();
  const summaries = useSummaries(() => listRecent().map(([code]) => code), forgetRecent);

  if (!recent.length) return null;
  return (
    <Card>
      <SectionTitle
        icon={<DownloadIcon className="size-4.5" />}
        aside={
          <button type="button" onClick={clearRecent} className="text-sm text-muted transition hover:text-fg">
            Clear
          </button>
        }
      >
        Recently received
      </SectionTitle>
      {recent.map(([code, r]) => {
        const summary = summaries[code];
        const files = summary?.files ?? r.files;
        const size = summary?.size ?? r.size;
        const saved = !r.note && files > 0 && getReceived(code).size >= files;
        return (
          <TransferRow
            key={code}
            code={code}
            icon={
              r.note ? (
                <TextIcon className="size-4.5" />
              ) : files > 1 ? (
                <FolderIcon className="size-4.5" />
              ) : (
                <FileTypeIcon path={r.title} className="size-4.5" />
              )
            }
            title={summary?.title ?? r.title}
            detail={[
              r.note ? "Text" : plural(files, "file"),
              formatBytes(size),
              // How long a device keeps sharing is its sender's business, not the code's expiry.
              r.hosted
                ? "From the sender's device"
                : formatRemaining(
                    summary?.expiresAt ?? r.expiresAt,
                    undefined,
                    summary && !summary.complete ? summary.lifetime : null,
                  ),
            ].join(" · ")}
            badge={
              saved ? (
                <Badge tone="ok" icon={<CheckIcon />}>
                  Saved
                </Badge>
              ) : undefined
            }
          />
        );
      })}
    </Card>
  );
}

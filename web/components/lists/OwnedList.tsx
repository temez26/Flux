"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { Summary } from "@/lib/api";
import { listOwned, ownedVersion, removeOwned, subscribeOwned } from "@/lib/storage/owned";
import { live } from "@/lib/transfer/session";
import { formatBytes, formatLifetime, plural } from "@/lib/util/format";
import { AlertIcon, CheckIcon, ClockIcon, DeviceIcon, GlobeIcon, LockIcon, PauseIcon, TextIcon } from "../ui/icons";
import { Badge, Card, SectionTitle, Spinner } from "../ui/ui";
import { TransferRow } from "./TransferRow";
import { useSummaries } from "./useSummaries";

function ownedBadge(code: string, summary: Summary | undefined): ReactNode {
  if (!summary) return null;
  if (summary.note) {
    return (
      <Badge tone="ok" icon={<CheckIcon />}>
        Ready
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

export function OwnedList() {
  useSyncExternalStore(subscribeOwned, ownedVersion, ownedVersion);
  const owned = listOwned();
  const summaries = useSummaries(() => listOwned().map(([code]) => code), removeOwned);

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
            icon={
              o.note ? (
                <TextIcon className="size-4.5" />
              ) : o.public ? (
                <GlobeIcon className="size-4.5" />
              ) : (
                <LockIcon className="size-4.5" />
              )
            }
            title={summary?.title ?? (o.note ? "Text" : plural(o.count, "file"))}
            detail={[
              o.note ? "Text" : plural(count, "file"),
              formatBytes(size),
              summary?.downloads ? plural(summary.downloads, "download") : null,
              formatLifetime(
                summary?.expiresAt ?? o.expiresAt,
                !!o.hosted,
                live.has(code),
                undefined,
                summary && !summary.complete ? summary.lifetime : null,
              ),
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

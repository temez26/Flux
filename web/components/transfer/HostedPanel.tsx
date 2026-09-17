"use client";

import { offerTitle } from "@/lib/nearby/nearby";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { formatBytes, plural } from "@/lib/util/format";
import { useLeaveGuard, useNotifyWhen, useNow, useTitle, useTransferMeta, useWakeLock } from "@/lib/hooks";
import type { Session } from "@/lib/transfer/session";
import { FileBrowser, FileRow } from "../files/FileList";
import { AlertIcon, DeviceIcon, ZapIcon } from "../ui/icons";
import { ShareCard } from "./ShareCard";
import { Badge, ConfirmButton, StatusCard, type StatusProps } from "../ui/ui";
import { BackgroundNotice, keepOpen, pageTitle, removeTransfer } from "./common";

function hostedStatus(serving: number, sent: number, expired: boolean): StatusProps {
  if (expired)
    return {
      tone: "err",
      icon: <AlertIcon />,
      title: "Link expired",
      subtitle: "The link no longer works. Send the files again to share them.",
    };
  if (serving > 0) {
    return {
      tone: "accent",
      icon: <ZapIcon />,
      title: `Sending to ${plural(serving, "device")}`,
      subtitle: `${formatBytes(sent)} sent straight from here.`,
    };
  }
  return {
    tone: "ok",
    icon: <DeviceIcon />,
    title: "Ready to send from this device",
    subtitle: `Nothing was uploaded. ${keepOpen("the files have been received")}`,
  };
}

/**
 * A transfer whose bytes never left this device. There is no upload to follow, so the panel
 * shows what is being served and makes it plain that closing the page ends it.
 */
export function HostedPanel({ session, expiresAt }: { session: Session; expiresAt?: string }) {
  const { host, entries, code, token } = session;
  useSyncExternalStore(host.subscribe, host.getVersion, host.getVersion);
  const now = useNow(30_000);
  const expired = !!expiresAt && Date.parse(expiresAt) <= now;
  const serving = host.receivers;
  // Only for the download count: everything else here comes from this tab's own session.
  const { meta } = useTransferMeta(code, true);
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const size = useMemo(() => entries.reduce((sum, e) => sum + e.size, 0), [entries]);
  useWakeLock(!expired);
  // Closing this page is the only thing that can end the transfer, so always ask.
  useLeaveGuard(!expired);
  useNotifyWhen(serving > 0, "A device is downloading", "Straight from this device");
  useTitle(pageTitle(offerTitle(paths)));

  useEffect(() => {
    if (expired) host.close();
  }, [expired, host]);

  return (
    <div className="space-y-4">
      <ShareCard code={code} hosted />
      <StatusCard
        {...hostedStatus(serving, host.sent, expired)}
        stats={[
          ["Files", entries.length.toLocaleString()],
          ["Size", formatBytes(size)],
          ["Downloads", (meta?.downloads ?? 0).toLocaleString()],
        ]}
        danger={<ConfirmButton onConfirm={() => removeTransfer(code, token)}>Delete transfer</ConfirmButton>}
      >
        <BackgroundNotice active={!expired} />
        {serving > 0 && (
          <div className="mt-4">
            <Badge tone="ok" icon={<ZapIcon />}>
              Direct from this device
            </Badge>
          </div>
        )}
      </StatusCard>
      <FileBrowser
        paths={paths}
        renderRow={(i) => (
          <FileRow
            path={entries[i].path}
            size={entries[i].size}
            badge={<Badge icon={<DeviceIcon />}>On this device</Badge>}
          />
        )}
      />
    </div>
  );
}

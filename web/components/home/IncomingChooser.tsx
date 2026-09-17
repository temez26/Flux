"use client";

import { useEffect, useRef } from "react";
import type { Picked } from "@/lib/platform/files";
import { DeviceIcon, GlobeIcon } from "../ui/icons";
import { Button, Card } from "../ui/ui";
import { describeFiles } from "../share/files/StagedFiles";

/** Files that arrived with nowhere chosen to send them, asking where to go. */
export function IncomingChooser({
  files,
  onChoose,
  onCancel,
}: {
  files: Picked[];
  onChoose: (target: "public" | "device") => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // They can arrive from a drop or a paste with focus anywhere, so bring it to the question.
  useEffect(() => heading.current?.focus(), [files]);

  return (
    <Card aria-labelledby="incoming-heading" className="animate-view-in border-2 border-accent/60">
      <h2 id="incoming-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none!">
        How do you want to share {files.length === 1 ? "this file" : `these ${files.length.toLocaleString()} files`}?
      </h2>
      <p className="mt-1 truncate text-sm text-muted">{describeFiles(files)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onChoose("device")}>
          <DeviceIcon className="size-4" />
          Send to a device
        </Button>
        <Button onClick={() => onChoose("public")}>
          <GlobeIcon className="size-4" />
          Share publicly
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { Picked } from "@/lib/platform/files";
import { GlobeIcon, LockIcon } from "../ui/icons";
import { Button, Card } from "../ui/ui";
import { describeFiles } from "../rooms/files/SharedFiles";

/** Files that reached the home page, which has no one room to send them from, asking where to go. */
export function IncomingChooser({
  files,
  onChoose,
  onCancel,
}: {
  files: Picked[];
  onChoose: (isPublic: boolean) => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // They can arrive from a drop or a paste with focus anywhere, so bring it to the question.
  useEffect(() => heading.current?.focus(), [files]);

  return (
    <Card aria-labelledby="incoming-heading" className="border-2 border-accent/60">
      <h2 id="incoming-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none">
        How do you want to share {files.length === 1 ? "this file" : `these ${files.length.toLocaleString()} files`}?
      </h2>
      <p className="mt-1 truncate text-sm text-muted">{describeFiles(files)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onChoose(false)}>
          <LockIcon className="size-4" />
          Privately
        </Button>
        <Button onClick={() => onChoose(true)}>
          <GlobeIcon className="size-4" />
          Publicly
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

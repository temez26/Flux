"use client";

import { errorMessage, updateTransfer, type TransferMeta } from "@/lib/api";
import { toast } from "@/lib/alerts/toast";
import { reloadTransfer } from "@/lib/hooks";
import { GlobeIcon, LinkIcon, LockIcon, UsersIcon } from "../../ui/icons";
import { Field, Segmented } from "../../ui/ui";

const VISIBILITY = [
  { label: "Link only", value: "link", icon: <LinkIcon className="size-4" /> },
  { label: "Listed publicly", value: "public", icon: <GlobeIcon className="size-4" /> },
];
const EDITORS = [
  { label: "Read only", value: "owner", icon: <LockIcon className="size-4" /> },
  { label: "Edit together", value: "anyone", icon: <UsersIcon className="size-4" /> },
];

/** What the owner of a text can change about it after sharing it. */
export function NoteSettings({ meta, token }: { meta: TransferMeta; token: string }) {
  async function change(changes: { editable?: boolean; public?: boolean }, done: string) {
    try {
      await updateTransfer(meta.code, token, changes);
      reloadTransfer(meta.code);
      toast(done);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }

  return (
    <div className="mt-5 grid gap-4 border-t border-line pt-5 @xl:grid-cols-2">
      <Field
        label="Who can find it"
        hint={
          meta.public
            ? "Listed in Public shares for anyone who opens Flux."
            : "Only people with the code, link or QR code."
        }
      >
        <Segmented
          label="Who can find it"
          value={meta.public ? "public" : "link"}
          options={VISIBILITY}
          onChange={(v) =>
            change({ public: v === "public" }, v === "public" ? "Listed publicly now" : "Only reachable by link now")
          }
        />
      </Field>
      <Field
        label="Who can edit"
        hint={meta.editable ? "Anyone who can open it can change it." : "Only you can change it; others read."}
      >
        <Segmented
          label="Who can edit"
          value={meta.editable ? "anyone" : "owner"}
          options={EDITORS}
          onChange={(v) =>
            change(
              { editable: v === "anyone" },
              v === "anyone" ? "Anyone with the link can edit it now" : "Only you can edit it now",
            )
          }
        />
      </Field>
    </div>
  );
}

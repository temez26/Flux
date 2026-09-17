"use client";

import { EXPIRY_OPTIONS } from "@/lib/api";
import { DeviceIcon, UploadIcon } from "../../ui/icons";
import { Field, Segmented } from "../../ui/ui";

const DELIVERY = [
  { label: "Upload", value: "server", icon: <UploadIcon className="size-4" /> },
  { label: "This device", value: "device", icon: <DeviceIcon className="size-4" /> },
];

/** Where the files live, and for how long. */
export function SendOptions({
  hosted,
  expiresIn,
  onHosted,
  onExpiresIn,
}: {
  hosted: boolean;
  expiresIn: number;
  onHosted: (hosted: boolean) => void;
  onExpiresIn: (seconds: number) => void;
}) {
  return (
    <div className="mt-5 grid gap-4 @md:grid-cols-2">
      <Field
        label="Where the files live"
        hint={
          hosted
            ? "Nothing is uploaded, and the code works only while this page is open."
            : "Files are stored on the server, so the link works after you close this page."
        }
      >
        <Segmented
          label="Where the files live"
          value={hosted ? "device" : "server"}
          options={DELIVERY}
          onChange={(v) => onHosted(v === "device")}
        />
      </Field>
      {!hosted && (
        <Field label="Delete after" hint="Files are removed automatically.">
          <Segmented label="Delete after" value={expiresIn} options={EXPIRY_OPTIONS} onChange={onExpiresIn} />
        </Field>
      )}
    </div>
  );
}

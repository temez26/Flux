"use client";

import { DeviceIcon, UploadIcon } from "../../ui/icons";
import { ExpiryNote } from "../../settings/ExpiryNote";
import { Field, Segmented } from "../../ui/ui";

const DELIVERY = [
  { label: "Upload", value: "server", icon: <UploadIcon className="size-4" /> },
  { label: "This device", value: "device", icon: <DeviceIcon className="size-4" /> },
];

/** Where the files live, and for how long. */
export function SendOptions({ hosted, onHosted }: { hosted: boolean; onHosted: (hosted: boolean) => void }) {
  return (
    <div className="mt-5">
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
      {!hosted && <ExpiryNote className="mt-2" />}
    </div>
  );
}

"use client";

import { EXPIRY_OPTIONS } from "@/lib/api";
import { DeviceIcon, GlobeIcon, LockIcon, UploadIcon } from "../../ui/icons";
import { Field, Segmented } from "../../ui/ui";

const VISIBILITY = [
  { label: "Private", value: "private", icon: <LockIcon className="size-4" /> },
  { label: "Public", value: "public", icon: <GlobeIcon className="size-4" /> },
];
const DELIVERY = [
  { label: "Upload", value: "server", icon: <UploadIcon className="size-4" /> },
  { label: "This device", value: "device", icon: <DeviceIcon className="size-4" /> },
];

/** Where what is sent lives, who can find it, and for how long. */
export function SendOptions({
  showDelivery,
  hosted,
  isPublic,
  expiresIn,
  onHosted,
  onPublic,
  onExpiresIn,
}: {
  /** Text always lives on the server, so there is nothing to choose for it. */
  showDelivery: boolean;
  hosted: boolean;
  isPublic: boolean;
  expiresIn: number;
  onHosted: (hosted: boolean) => void;
  onPublic: (isPublic: boolean) => void;
  onExpiresIn: (seconds: number) => void;
}) {
  return (
    <div className="mt-5 space-y-4">
      {showDelivery && (
        <Field
          label="Where the files live"
          hint={
            hosted
              ? "Nothing is uploaded, and the code works only while this page is open."
              : "Files are stored on the server, so the link works after you close this page."
          }
        >
          <Segmented
            label="Delivery"
            value={hosted ? "device" : "server"}
            options={DELIVERY}
            onChange={(v) => onHosted(v === "device")}
          />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Who can open it"
          hint={isPublic ? "Listed on this page for anyone who opens Flux." : "Only people with the code or link."}
        >
          <Segmented
            label="Visibility"
            value={isPublic ? "public" : "private"}
            options={VISIBILITY}
            onChange={(v) => onPublic(v === "public")}
          />
        </Field>
        {!hosted && (
          <Field label="Delete after" hint="Files are removed automatically.">
            <Segmented label="Expiry" value={expiresIn} options={EXPIRY_OPTIONS} onChange={onExpiresIn} />
          </Field>
        )}
      </div>
    </div>
  );
}

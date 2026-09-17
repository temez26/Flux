"use client";

import { useState } from "react";
import {
  notificationsOn,
  notificationsSupported,
  turnOffNotifications,
  turnOnNotifications,
} from "@/lib/alerts/notify";
import { toast } from "@/lib/alerts/toast";
import { Switch } from "../ui/ui";

/** Turns system notifications on or off, or says why they can't be. */
export function NotificationSwitch() {
  const [on, setOn] = useState(notificationsOn);
  const supported = notificationsSupported();

  async function toggle() {
    if (on) {
      turnOffNotifications();
      return setOn(false);
    }
    const granted = await turnOnNotifications();
    setOn(granted);
    toast(
      granted
        ? "You'll be notified while Flux is in the background"
        : "Notifications are blocked for this site in your browser",
      granted ? "ok" : "err",
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p id="notifications-label" className="text-sm font-medium">
          Notifications
        </p>
        <p id="notifications-hint" className="text-xs text-muted">
          {supported
            ? "When a transfer finishes or a device sends you something while Flux is in the background."
            : "This browser can't show notifications from Flux."}
        </p>
      </div>
      {supported && (
        <Switch checked={on} onChange={toggle} labelledBy="notifications-label" describedBy="notifications-hint" />
      )}
    </div>
  );
}

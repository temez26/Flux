"use client";

import { useState } from "react";
import {
  notificationsOn,
  notificationsSupported,
  turnOffNotifications,
  turnOnNotifications,
} from "@/lib/alerts/notify";
import { isAppleTouch, isInstalled } from "@/lib/platform/install";
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
    toast(granted ? "Notifications on" : "Notifications are blocked in your browser", granted ? "ok" : "err");
  }

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p id="notifications-label" className="text-sm font-medium">
          Notifications
        </p>
        {!supported && (
          <p className="text-xs text-muted">
            {isAppleTouch() && !isInstalled()
              ? "Add Flux to your Home Screen first."
              : "Not supported in this browser."}
          </p>
        )}
      </div>
      {supported && <Switch checked={on} onChange={toggle} labelledBy="notifications-label" />}
    </div>
  );
}

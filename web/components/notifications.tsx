"use client";

import { useState } from "react";
import {
  notificationsOn,
  notificationsSupported,
  turnOffNotifications,
  turnOnNotifications,
} from "@/lib/alerts/notify";
import { toast } from "@/lib/alerts/toast";
import { BellIcon } from "./ui/icons";
import { IconButton } from "./ui/ui";

/** Turns system notifications on or off; absent where the browser won't send any. */
export function NotificationToggle() {
  const [on, setOn] = useState(notificationsOn);
  if (!notificationsSupported()) return null;

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
    <IconButton
      label={on ? "Turn off notifications" : "Turn on notifications"}
      aria-pressed={on}
      onClick={toggle}
      className={on ? "text-accent" : ""}
    >
      <BellIcon />
    </IconButton>
  );
}

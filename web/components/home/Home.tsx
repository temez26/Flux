"use client";

import { useState } from "react";
import { EXPIRY_OPTIONS } from "@/lib/api";
import { DownloadIcon } from "../ui/icons";
import { Card, SectionTitle } from "../ui/ui";
import { CollectForm } from "./CollectForm";
import { OwnedList } from "./lists/OwnedList";
import { PublicList } from "./lists/PublicList";
import { RecentList } from "./lists/RecentList";
import { ReceiveForm } from "./ReceiveForm";
import { SendCard } from "./send/SendCard";

const EXPIRY_KEY = "flux.expiry";

function storedExpiry(): number {
  try {
    const value = Number(localStorage.getItem(EXPIRY_KEY));
    return EXPIRY_OPTIONS.some((e) => e.value === value) ? value : 86_400;
  } catch {
    return 86_400;
  }
}

export default function Home() {
  // Shared by sending and collecting, and remembered between visits.
  const [expiresIn, setExpiresIn] = useState(storedExpiry);

  function chooseExpiry(seconds: number) {
    setExpiresIn(seconds);
    try {
      localStorage.setItem(EXPIRY_KEY, String(seconds));
    } catch {}
  }

  return (
    <div className="space-y-4">
      <SendCard expiresIn={expiresIn} onExpiresIn={chooseExpiry} />

      <Card>
        <SectionTitle icon={<DownloadIcon className="size-4.5" />}>Receive</SectionTitle>
        <ReceiveForm />
        <CollectForm expiresIn={expiresIn} />
        <PublicList />
      </Card>

      <OwnedList />
      <RecentList />
    </div>
  );
}

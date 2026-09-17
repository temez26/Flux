"use client";

import { useTitle } from "@/lib/hooks";
import { Card } from "../ui/ui";
import { PublicShares } from "./PublicShares";

/** Every public share, to search and page through, on a page of its own. */
export function BrowsePage() {
  useTitle("Public shares · Flux");
  return (
    <Card>
      <PublicShares heading="h1" variant="full" />
    </Card>
  );
}

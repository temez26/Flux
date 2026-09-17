"use client";

import { useTitle } from "@/lib/hooks";
import { Card } from "../ui/ui";
import { PublicList } from "./PublicList";

/** Every public file, to search and page through, on a page of its own. */
export function BrowsePage() {
  useTitle("Public files · Flux");
  return (
    <Card>
      <PublicList kind="files" heading="h1" variant="full" />
    </Card>
  );
}

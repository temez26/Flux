import { useState } from "react";
import { getSummary, type Summary } from "@/lib/api";
import { usePolling } from "@/lib/hooks";

export const LIST_POLL_MS = 15_000;

/**
 * Keeps the summary of each listed transfer current, and forgets any the server no longer has,
 * so a list of remembered codes shows what is really there.
 */
export function useSummaries(codes: () => string[], forget: (code: string) => void): Record<string, Summary> {
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  usePolling(async () => {
    const results = await Promise.all(codes().map(async (code) => [code, await getSummary(code)] as const));
    const found: Record<string, Summary> = {};
    for (const [code, summary] of results) {
      if (summary) found[code] = summary;
      else forget(code);
    }
    setSummaries(found);
  }, LIST_POLL_MS);
  return summaries;
}

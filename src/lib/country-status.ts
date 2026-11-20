/** Badge tone for a country profile's status. */
export const statusTone = (s: string) =>
  (s === "operational" ? "ok" : s === "verified" ? "accent" : s === "in_review" ? "warn" : s === "retired" ? "outline" : "neutral") as "ok" | "accent" | "warn" | "outline" | "neutral";

export const SOURCE_KINDS = [["legislation", "Legislation"], ["official_fees", "Official fees"], ["requirements", "Requirements"], ["checklist", "Checklist"], ["holidays", "Public holidays"], ["guidance", "Official guidance"], ["other", "Other"]] as const;
export const kindLabel = (k: string) => SOURCE_KINDS.find(([v]) => v === k)?.[1] ?? k;

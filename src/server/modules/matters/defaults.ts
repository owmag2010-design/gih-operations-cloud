/**
 * Default matter stages, following the brief's workflow from matter opening to
 * closure. Each practice can rename, reorder, add stages, or define a
 * different set for a particular service.
 */
export const DEFAULT_MATTER_STAGES: { key: string; name: string; category: "opening" | "active" | "submitted" | "closed" }[] = [
  { key: "opening", name: "Matter opening", category: "opening" },
  { key: "documents", name: "Document collection", category: "active" },
  { key: "preparation", name: "Preparation", category: "active" },
  { key: "review", name: "Review", category: "active" },
  { key: "submission", name: "Submission", category: "submitted" },
  { key: "follow_up", name: "Follow-up", category: "submitted" },
  { key: "outcome", name: "Outcome received", category: "submitted" },
  { key: "closed", name: "Closed", category: "closed" },
];

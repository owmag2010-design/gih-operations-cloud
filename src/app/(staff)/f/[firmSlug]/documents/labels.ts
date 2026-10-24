export const DOC_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" | "outline" }> = {
  draft: { label: "Draft", tone: "outline" },
  in_review: { label: "In review", tone: "accent" },
  changes_requested: { label: "Changes requested", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  final: { label: "Final", tone: "neutral" },
};
export const OCR_LABEL: Record<string, string> = {
  done: "Text read",
  pending: "Reading…",
  failed: "Couldn't read",
  unsupported: "Scanned PDF: upload pages as images",
  not_needed: "No OCR needed",
};

export const INVOICE_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" | "outline" }> = {
  draft: { label: "Draft", tone: "outline" },
  issued: { label: "Issued", tone: "accent" },
  partially_paid: { label: "Partly paid", tone: "warn" },
  overdue: { label: "Overdue", tone: "danger" },
  paid: { label: "Paid", tone: "ok" },
  credited: { label: "Credited", tone: "neutral" },
  void: { label: "Void", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" | "outline" }> = {
  pending: { label: "Awaiting verification", tone: "warn" },
  verified: { label: "Verified", tone: "ok" },
  rejected: { label: "Rejected", tone: "danger" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export const METHOD: Record<string, string> = { eft: "EFT", cash: "Cash", card_machine: "Card machine", stripe: "Stripe", other: "Other" };

export const LINE_KIND: Record<string, string> = {
  professional: "Professional fee",
  government: "Government fee",
  third_party: "Third-party cost",
  disbursement: "Disbursement",
  discount: "Discount",
};

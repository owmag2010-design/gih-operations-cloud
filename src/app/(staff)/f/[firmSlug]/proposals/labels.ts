import type { ProposalStatus } from "@/server/modules/proposals/proposals";

export const PROPOSAL_TONE: Record<ProposalStatus, "neutral" | "accent" | "ok" | "warn" | "danger" | "outline"> = {
  draft: "neutral", in_review: "accent", changes_requested: "warn", approved: "accent", released: "accent", accepted: "ok", declined: "danger", withdrawn: "outline",
};

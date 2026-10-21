/** Default lead pipeline (configurable per firm afterwards). */
export const DEFAULT_PIPELINE: { key: string; name: string; category: "open" | "won" | "lost" | "closed" }[] = [
  { key: "new_enquiry", name: "New enquiry", category: "open" },
  { key: "initial_review", name: "Initial review", category: "open" },
  { key: "information_required", name: "Information required", category: "open" },
  { key: "assessment", name: "Assessment", category: "open" },
  { key: "consultation_recommended", name: "Consultation recommended", category: "open" },
  { key: "proposal_preparation", name: "Proposal preparation", category: "open" },
  { key: "proposal_sent", name: "Proposal sent", category: "open" },
  { key: "follow_up", name: "Follow-up", category: "open" },
  { key: "accepted", name: "Accepted", category: "open" },
  { key: "converted", name: "Converted to client", category: "won" },
  { key: "declined", name: "Declined", category: "lost" },
  { key: "unqualified", name: "Unqualified", category: "lost" },
  { key: "duplicate", name: "Duplicate", category: "closed" },
  { key: "closed", name: "Closed", category: "closed" },
];

export const SOURCE_LABELS: Record<string, string> = {
  website_form: "Website form",
  assessment_form: "Assessment form",
  email: "Email",
  whatsapp: "WhatsApp",
  referral: "Referral",
  manual: "Entered by staff",
  integration: "Integration",
  hub_intake: "Hub intake",
};

export const PRIORITY_LABELS: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const PRIORITY_TONE: Record<string, "neutral" | "warn" | "danger" | "outline"> = { low: "outline", normal: "neutral", high: "warn", urgent: "danger" };

export const STAGE_TONE: Record<string, "neutral" | "accent" | "ok" | "danger" | "outline"> = { open: "accent", won: "ok", lost: "danger", closed: "outline" };

export const FLAG_LABELS: Record<string, string> = {
  legal_matter: "Legal matter",
  asylum: "Asylum: offer a consultation",
  regulated_au: "Australia: authorised consultation",
  needs_information: "Needs more information",
  possible_duplicate: "Possible duplicate",
  urgent: "Urgent",
};

export const INTAKE_STATUS_LABELS: Record<string, string> = { new: "Ready to route", held: "Held for review", routed: "Routed", rejected: "Closed", duplicate: "Duplicate" };

export const ACTIVITY_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Details updated",
  note: "Note",
  stage_change: "Stage changed",
  assignment: "Assignment changed",
  follow_up: "Follow-up set",
  consent: "Consent recorded",
  duplicate_flagged: "Possible duplicate",
  converted: "Converted to client",
  routed: "Routed from the Hub",
};

export const FIELD_LABELS: Record<string, string> = {
  firstName: "first name", lastName: "last name", email: "email", phone: "phone", nationality: "nationality", currentCountry: "current country",
  destinationCountry: "destination", immigrationCategory: "category", enquiry: "enquiry", source: "source", sourceDetail: "source detail",
  priority: "priority", followUpAt: "follow-up", tags: "tags",
};

export const fullName = (first: string, last?: string | null) => (last ? `${first} ${last}` : first);

export function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

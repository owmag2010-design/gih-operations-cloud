/**
 * Starting content for a new proposal, per firm. Every section is editable on
 * the proposal itself; these are only the defaults, written in the voice of the
 * approved Veritas, Mimshac and Hub proposals.
 */
import type { ProposalSection } from "../../db/schema";

export type ProposalTemplateInput = {
  firmSlug: string;
  firmName: string;
  firstName: string;
  enquiry: string | null;
  category: string | null;
  destination: string | null;
  serviceNames: string[];
  depositPercent: number | null;
};

const FNB = "Bank: FNB\nAccount name: M International\nAccount number: 62835952822\nBranch code: 211021\nReference: your proposal reference";

const BANKING: Record<string, string> = {
  veritas: FNB,
  mimshac: FNB,
};

const SIGN_OFF: Record<string, string> = {
  veritas: "Owen Magocha\nCorporate and Wealth Migration Strategist, Veritas Emigrate",
  mimshac: "Owen Magocha\nMimshac Group",
};

export function defaultSections(t: ProposalTemplateInput): ProposalSection[] {
  const matter = t.serviceNames[0] ?? t.category ?? "your application";
  const where = t.destination ? ` in ${t.destination}` : "";
  const deposit = t.depositPercent ? `${t.depositPercent}% deposit` : "deposit";
  const banking = BANKING[t.firmSlug] ?? "Banking details will be confirmed by your consultant.";
  const sign = SIGN_OFF[t.firmSlug] ?? t.firmName;

  return [
    {
      key: "enquiry",
      title: "Your enquiry",
      body: t.enquiry?.trim()
        ? `You told us:\n\n“${t.enquiry.trim()}”\n\nThis proposal sets out how ${t.firmName} will handle ${matter}${where}, what it costs, and what happens next.`
        : `Thank you for contacting ${t.firmName}. This proposal sets out how we will handle ${matter}${where}, what it costs, and what happens next.`,
    },
    {
      key: "approach",
      title: "Our approach",
      body:
        `Dear ${t.firstName},\n\n` +
        `We start by checking your circumstances against the current requirements, so the application is built on the right route from day one. ` +
        `You will have one consultant who knows your file, a clear checklist of what we need from you, and an update at every stage.\n\n${sign}`,
    },
    {
      key: "scope",
      title: "Scope of work",
      body: [
        "Assessment: we confirm the right route and flag any risks before you spend money on documents.",
        "Document checklist: a tailored list of what to gather, with guidance on each item.",
        "Review and preparation: we check every document and prepare the forms and supporting letters.",
        "Submission: we lodge the application and book any appointments needed.",
        "Follow-up: we track the application and keep you informed until the outcome.",
      ].map((s) => `• ${s}`).join("\n"),
    },
    {
      key: "excluded",
      title: "Not included",
      body: "Government, VFS, courier, translation, police clearance and medical costs are charged at cost and shown separately in the fee table where they apply. Appeals or new applications after a refusal are quoted separately.",
    },
    {
      key: "payment",
      title: "How to pay",
      body: `To begin, pay the ${deposit} shown in the fee table by EFT or card. The balance is due before submission.\n\n${banking}`,
    },
    {
      key: "next_steps",
      title: "Next steps",
      body: "1. Accept this proposal using the button below.\n2. Pay the deposit.\n3. We send your document checklist and book your first working session.",
    },
  ];
}

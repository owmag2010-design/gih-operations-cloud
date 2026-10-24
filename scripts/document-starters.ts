/**
 * Starter document templates: structure and merge fields only. Every passage
 * to be written is a [[prompt]], so a document can't be finalised until a
 * person has written it. Each practice adapts these to its own wording.
 */
import type { DocContent, DocNode } from "../src/server/db/schema";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (...parts: string[]): DocNode => ({ type: "paragraph", content: parts.map(t) });
const h = (level: 1 | 2 | 3, text: string): DocNode => ({ type: "heading", attrs: { level }, content: [t(text)] });
const ul = (...items: string[]): DocNode => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const doc = (...content: DocNode[]): DocContent => ({ type: "doc", content });

export const DOCUMENT_STARTERS: { name: string; kind: "letter" | "representation" | "consultation_report" | "roadmap" | "engagement" | "submission_pack"; description: string; content: DocContent }[] = [
  {
    name: "Client letter",
    kind: "letter",
    description: "Plain letter on the practice letterhead.",
    content: doc(p("{{today}}"), p("{{client.fullName}}"), p("Our reference: {{matter.ref}}"), p("Dear {{client.firstName}},"), h(2, "[[Subject of the letter]]"), p("[[Write the body of the letter here.]]"), p("Yours sincerely,"), p("{{user.name}}"), p("{{firm.tradingName}}")),
  },
  {
    name: "Consultation report",
    kind: "consultation_report",
    description: "Record of a consultation: background, objectives, options and recommendation.",
    content: doc(
      h(1, "Consultation report"),
      p("Prepared for {{client.fullName}} ({{client.ref}}) on {{today}} by {{user.name}}, {{firm.tradingName}}."),
      h(2, "Background"), p("[[Summarise the client's circumstances as recorded, noting which facts are verified and which are the client's statements.]]"),
      h(2, "Your objectives"), p("[[What the client wants to achieve and by when.]]"),
      h(2, "Options considered"), p("[[Each option, its requirements, timing, costs and risks.]]"),
      h(2, "Our recommendation"), p("[[The recommended route and why.]]"),
      h(2, "Next steps"), ul("[[First step and who does it]]", "[[Documents needed]]"),
      p("This report is based on the information available at the date above. Requirements change; we will confirm them before any application is made."),
    ),
  },
  {
    name: "Roadmap",
    kind: "roadmap",
    description: "Step-by-step plan for the client, with stages and timing.",
    content: doc(
      h(1, "Your immigration roadmap"),
      p("{{client.fullName}} | {{matter.title}} ({{matter.ref}})"),
      h(2, "Where you are now"), p("[[Current status and key dates.]]"),
      h(2, "The route"), ul("[[Stage 1: what happens, what we need from you, expected timing]]", "[[Stage 2]]", "[[Stage 3]]"),
      h(2, "Key dates"), p("[[Deadlines and expiry dates, each with its basis.]]"),
      h(2, "How we will keep you updated"), p("[[Update rhythm and contact person.]]"),
    ),
  },
  {
    name: "Engagement letter",
    kind: "engagement",
    description: "Scope, responsibilities and fees for a new matter.",
    content: doc(
      p("{{today}}"), p("{{client.fullName}}"), h(1, "Letter of engagement"), p("Matter: {{matter.title}} ({{matter.ref}})"),
      h(2, "Scope of our work"), p("[[What we will do, and what is outside the scope.]]"),
      h(2, "Your responsibilities"), p("[[Information and documents the client must provide, and the duty to tell us of changes.]]"),
      h(2, "Fees and payment"), p("[[Professional fees, government and third-party costs, payment schedule.]]"),
      h(2, "Terms"), p("[[The practice's standard terms of engagement.]]"),
      p("Yours sincerely,"), p("{{user.name}}"), p("{{firm.tradingName}}"),
      h(2, "Acceptance"), p("I, {{client.fullName}}, accept the terms of this engagement."), p("Signature: ____________________   Date: ______________"),
    ),
  },
  {
    name: "Representation",
    kind: "representation",
    description: "Written submissions in support of an application, appeal or review.",
    content: doc(
      h(1, "Representations in support of {{client.fullName}}"),
      p("Reference: {{matter.submissionReference}} | Our reference: {{matter.ref}}"),
      h(2, "Introduction"), p("[[Who we act for, the application or decision concerned, and what is sought.]]"),
      h(2, "Background facts"), p("[[Facts relied on, each tied to the supporting document in the bundle.]]"),
      h(2, "Legal framework"), p("[[Provisions relied on, quoted from the current official text, with their source.]]"),
      h(2, "Submissions"), p("[[Argument applying the law to the facts.]]"),
      h(2, "Conclusion"), p("[[The decision requested.]]"),
      p("{{user.name}}"), p("{{firm.tradingName}} | {{firm.contactEmail}}"),
    ),
  },
  {
    name: "Submission pack cover and index",
    kind: "submission_pack",
    description: "Cover sheet and index of documents for an application.",
    content: doc(
      h(1, "Application pack"),
      p("Applicant: {{client.fullName}}"), p("Matter: {{matter.title}} ({{matter.ref}})"), p("Prepared by {{firm.tradingName}} on {{today}}"),
      h(2, "Index of documents"), { type: "orderedList", content: ["[[Document 1]]", "[[Document 2]]", "[[Document 3]]"].map((i) => ({ type: "listItem", content: [p(i)] })) },
      h(2, "Notes for the reviewer"), p("[[Anything the reviewing officer should note.]]"),
    ),
  },
];

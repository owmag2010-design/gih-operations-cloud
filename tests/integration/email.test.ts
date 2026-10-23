import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withScope } from "../../src/server/db/client";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../src/server/errors";
import type { ReceivedEmail } from "../../src/server/integrations/resend";
import { createLead } from "../../src/server/modules/crm/leads";
import {
  createLeadFromThread,
  getThread,
  ingestReceived,
  listTemplates,
  listThreads,
  replyToThread,
  saveTemplate,
  sendToRecord,
  threadReplyAddress,
} from "../../src/server/modules/email/mail";
import { auditCount, firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

let seq = 0;
function received(over: Partial<ReceivedEmail> = {}): ReceivedEmail {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, to: ["veritas@in.thegih.com"], from: "Thandi Test <thandi@test.example>",
    subject: "Spouse visa question", html: "<p>Hello</p>", text: "Hello, I need help with a spouse visa.", headers: {}, cc: [], reply_to: [], received_for: [],
    message_id: `<m${seq}@test.example>`, created_at: new Date().toISOString(), authentication: { spf: "pass", dkim: "pass", dmarc: "pass" }, attachments: [], ...over,
  };
}
const fetchOf = (m: ReceivedEmail) => async () => m;

describe("email", () => {
  beforeEach(resetDatabase);

  it("sends to a lead from the firm mailbox, logs it, and records 'not configured' without a key", async () => {
    const veritas = await firmId("veritas");
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(consultant, veritas, lead({ email: "thandi@test.example" }));
    const templates = await listTemplates(consultant, { kind: "firm", firmId: veritas }, { includeHub: true, activeOnly: true });
    expect(templates.length).toBeGreaterThanOrEqual(5);

    const r = await sendToRecord(consultant, veritas, { leadId: l.id }, { templateId: templates.find((t) => t.name === "Enquiry received")!.id });
    expect(r.status).toBe("not_configured");
    const { thread, messages } = await getThread(consultant, { kind: "firm", firmId: veritas }, r.threadId);
    expect(thread.leadId).toBe(l.id);
    expect(messages[0].subject).toBe("We've received your enquiry, Thandi");
    expect(messages[0].htmlBody).toContain(l.ref);
    expect(messages[0].fromAddress).toBe("veritas@thegih.com");
    const acts = await owner.select().from(s.activities).where(eq(s.activities.leadId, l.id));
    expect(acts.some((a) => a.type === "email")).toBe(true);
    expect(await auditCount("email.sent")).toBe(1);

    await expect(sendToRecord(consultant, veritas, { leadId: l.id }, { subject: "", body: "x" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("files a reply into the same conversation using the tagged reply address", async () => {
    const veritas = await firmId("veritas");
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(consultant, veritas, lead({ email: "thandi@test.example" }));
    const { threadId } = await sendToRecord(consultant, veritas, { leadId: l.id }, { subject: "Your documents", body: "Please send your passport." });
    const out = await ingestReceived("x", fetchOf(received({ to: [threadReplyAddress("veritas@in.thegih.com", threadId)], subject: "Re: Your documents" })));
    expect(out).toMatchObject({ status: "stored", threadId, created: false });
    const t = await getThread(consultant, { kind: "firm", firmId: veritas }, threadId);
    expect(t.messages.map((m) => m.direction)).toEqual(["outbound", "inbound"]);
    // The same delivery twice is stored once.
    const again = received({ to: ["veritas@in.thegih.com"] });
    await ingestReceived("x", fetchOf(again));
    expect((await ingestReceived("x", fetchOf(again))).status).toBe("duplicate");
  });

  it("matches a new email to the firm's lead by sender, or offers to create one", async () => {
    const veritas = await firmId("veritas");
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(consultant, veritas, lead({ email: "known@test.example" }));
    const known = await ingestReceived("x", fetchOf(received({ from: "Known Person <known@test.example>" })));
    const unknown = await ingestReceived("x", fetchOf(received({ from: "New Person <new@test.example>", subject: "Work visa" })));
    if (known.status !== "stored" || unknown.status !== "stored") throw new Error("not stored");
    expect((await getThread(consultant, { kind: "firm", firmId: veritas }, known.threadId)).thread.leadId).toBe(l.id);
    const created = await createLeadFromThread(consultant, veritas, unknown.threadId);
    expect(created.email).toBe("new@test.example");
    expect(created.source).toBe("email");
    expect((await listThreads(consultant, { kind: "firm", firmId: veritas })).filter((t) => t.unread)).toHaveLength(0); // both were opened above
  });

  it("puts Hub mail into Hub intake, and never shows it to firms", async () => {
    const veritas = await firmId("veritas");
    const hubOps = await makeUser({ group: "group_ops_admin" });
    const consultant = await makeUser({ firms: { veritas: "firm_admin" } });
    const out = await ingestReceived("x", fetchOf(received({ to: ["hello@in.thegih.com"], from: "Sipho M <sipho@test.example>" })));
    if (out.status !== "stored") throw new Error("not stored");
    const hubThreads = await listThreads(hubOps, { kind: "hub" });
    expect(hubThreads).toHaveLength(1);
    expect(hubThreads[0].intakeItemId).not.toBeNull();
    const [item] = await owner.select().from(s.intakeItems).where(eq(s.intakeItems.id, hubThreads[0].intakeItemId!));
    expect(item.source).toBe("email");
    expect(item.email).toBe("sipho@test.example");
    // Firm staff can't open Hub conversations, and the database hides them.
    await expect(listThreads(consultant, { kind: "hub" })).rejects.toBeInstanceOf(AccessDeniedError);
    const seen = await withScope({ orgId: consultant.orgId, userId: null, firmIds: [veritas] }, (tx) => tx.execute(sql`select id from email_threads`));
    expect(seen.rows).toHaveLength(0);
    // Spoofed mail (failed DMARC) is kept in the Hub inbox but doesn't create an enquiry.
    const spoof = await ingestReceived("x", fetchOf(received({ to: ["hello@in.thegih.com"], from: "x@bad.example", authentication: { spf: "fail", dkim: "fail", dmarc: "fail" } })));
    if (spoof.status !== "stored") throw new Error("not stored");
    expect((await getThread(hubOps, { kind: "hub" }, spoof.threadId)).thread.intakeItemId).toBeNull();
    // Hub ops can reply from the Hub mailbox.
    expect((await replyToThread(hubOps, { kind: "hub" }, out.threadId, { body: "Thanks, we'll be in touch." })).status).toBe("not_configured");
  });

  it("keeps firm mail and templates inside the firm", async () => {
    const veritas = await firmId("veritas");
    const mimshac = await firmId("mimshac");
    const vAdmin = await makeUser({ firms: { veritas: "firm_admin" } });
    const mAdmin = await makeUser({ firms: { mimshac: "firm_admin" } });
    const out = await ingestReceived("x", fetchOf(received()));
    if (out.status !== "stored") throw new Error("not stored");
    await expect(getThread(mAdmin, { kind: "firm", firmId: mimshac }, out.threadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getThread(mAdmin, { kind: "firm", firmId: veritas }, out.threadId)).rejects.toBeInstanceOf(AccessDeniedError);
    const t = await saveTemplate(vAdmin, { kind: "firm", firmId: veritas }, null, { name: "Veritas welcome", subject: "Welcome {{first_name}}", blocks: [{ type: "paragraph", text: "Hi" }] });
    const mList = await listTemplates(mAdmin, { kind: "firm", firmId: mimshac }, { includeHub: true });
    expect(mList.find((x) => x.id === t.id)).toBeUndefined();
    // Firms can't edit the Hub's shared templates.
    const hubTemplate = mList.find((x) => x.firmId === null)!;
    await expect(saveTemplate(mAdmin, { kind: "firm", firmId: mimshac }, hubTemplate.id, { name: "Hijack", subject: "x x", blocks: [{ type: "paragraph", text: "x" }] })).rejects.toBeInstanceOf(NotFoundError);
    // Message content can't be rewritten by the app.
    await expect(withScope({ orgId: vAdmin.orgId, userId: null, firmIds: [veritas] }, (tx) => tx.execute(sql`update email_messages set text_body = 'x'`))).rejects.toThrow();
  });
});

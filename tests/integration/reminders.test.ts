import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, ValidationError } from "../../src/server/errors";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import { createMatter } from "../../src/server/modules/matters/matters";
import { addDocumentRequest, stepDocumentRequest } from "../../src/server/modules/checklists/checklists";
import { closePortal, enablePortal } from "../../src/server/modules/portal/portal";
import { getReminderSettings, matterReminders, runFirmReminders, saveReminderSettings } from "../../src/server/modules/reminders/reminders";
import { firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

const sent: { to: string; subject: string; template: string; text: string }[] = [];
vi.mock("../../src/server/integrations/email", async (orig) => {
  const real = await orig<typeof import("../../src/server/integrations/email")>();
  return {
    ...real,
    sendEmail: vi.fn(async (e: { to: string; subject: string; template: string; text: string }) => {
      sent.push(e);
      return { status: "not_configured" as const };
    }),
  };
});

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const TODAY = day(0);
const on = { clientNudges: true, nudgeEveryDays: 7, staffDigest: true, deadlineWindowDays: 7, expiryWindowDays: 90 };

async function setup() {
  sent.length = 0;
  const veritas = await firmId("veritas");
  const orgId = (await owner.select({ o: s.firms.orgId }).from(s.firms).where(eq(s.firms.id, veritas)))[0].o;
  const admin = await makeUser({ name: "Vera Admin", firms: { veritas: "firm_admin" } });
  const caseManager = await makeUser({ name: "Casey Manager", firms: { veritas: "case_manager" } });
  const outsider = await makeUser({ name: "Olive Other", firms: { veritas: "immigration_consultant" } });
  const { lead: l } = await createLead(admin, veritas, lead({ firstName: "Thandi", lastName: "Moyo" }));
  const { client } = await convertLead(admin, veritas, l.id);
  const matter = await createMatter(admin, veritas, { clientId: client.id, title: "Section 11(6) spouse visa", caseManagerId: caseManager.user.id });
  return { veritas, orgId, admin, caseManager, outsider, matter };
}

const run = (orgId: string, firm: string, today = TODAY) => runFirmReminders(orgId, firm, today);
const clientMails = () => sent.filter((e) => e.template === "reminder_client_documents");
const digests = () => sent.filter((e) => e.template === "reminder_staff_digest");

describe("reminders", () => {
  beforeEach(resetDatabase);

  it("start off, only practice administrators change them, and limits are checked", async () => {
    const { veritas, orgId, admin, caseManager, matter } = await setup();
    const got = await getReminderSettings(admin, veritas);
    expect(got.settings).toMatchObject({ clientNudges: false, staffDigest: false });
    expect(got.canEdit).toBe(true);

    await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test", sendInvite: "on" });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Passport copy", required: "on", dueOn: day(-2) });
    sent.length = 0;
    expect(await run(orgId, veritas)).toMatchObject({ clientSent: 0, digestsSent: 0 });
    expect(sent).toHaveLength(0);

    await expect(saveReminderSettings(caseManager, veritas, on)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(saveReminderSettings(admin, veritas, { ...on, nudgeEveryDays: 1 })).rejects.toBeInstanceOf(ValidationError);
    await saveReminderSettings(admin, veritas, on);
    expect((await getReminderSettings(caseManager, veritas)).settings).toMatchObject({ clientNudges: true, staffDigest: true });
    const [a] = await owner.select().from(s.auditEvents).where(eq(s.auditEvents.action, "reminders.settings"));
    expect(a.summary).toContain("client reminders on");
  });

  it("reminds a client once per interval about required, visible, outstanding documents", async () => {
    const { veritas, orgId, admin, matter } = await setup();
    await saveReminderSettings(admin, veritas, { ...on, staffDigest: false });
    await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test", sendInvite: "on" });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Passport copy", required: "on", dueOn: day(2) });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Police clearance certificate", required: "on" });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Risk assessment", required: "on", clientVisible: "false", dueOn: day(1) });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Old payslips", dueOn: day(1) });
    sent.length = 0;

    expect(await run(orgId, veritas)).toMatchObject({ clientSent: 1 });
    const [mail] = clientMails();
    expect(mail.to).toBe("thandi@client.test");
    expect(mail.text).toContain("Passport copy");
    expect(mail.text).toContain("Police clearance certificate");
    expect(mail.text).not.toContain("Risk assessment");
    expect(mail.text).not.toContain("Old payslips");
    expect(mail.text).toMatch(/\/portal\/[A-Za-z0-9_-]+/);

    // Same day again, and the next day: nothing new.
    expect(await run(orgId, veritas)).toMatchObject({ clientSent: 0 });
    expect(await run(orgId, veritas, day(1))).toMatchObject({ clientSent: 0 });
    expect(clientMails()).toHaveLength(1);

    const view = await matterReminders(admin, veritas, matter.id);
    expect(view).toMatchObject({ enabled: true, everyDays: 7 });
    expect(view.sent).toHaveLength(1);
    expect(view.sent[0]).toMatchObject({ items: 2, status: "not_configured" });

    // After the interval it goes again.
    expect(await run(orgId, veritas, day(7))).toMatchObject({ clientSent: 1 });

    // A closed portal gets nothing.
    await closePortal(admin, veritas, matter.id);
    expect(await run(orgId, veritas, day(14))).toMatchObject({ clientSent: 0 });
  });

  it("waits for the interval when nothing is due soon, but reminds at once when a new copy is asked for", async () => {
    const { veritas, orgId, admin, matter } = await setup();
    await saveReminderSettings(admin, veritas, { ...on, staffDigest: false });
    await enablePortal(admin, veritas, matter.id, { email: "thandi@client.test", sendInvite: "on" });
    const r = await addDocumentRequest(admin, veritas, matter.id, { label: "Bank statements", required: "on" });
    sent.length = 0;
    expect(await run(orgId, veritas)).toMatchObject({ clientSent: 0 });

    // Staff upload a file, then ask for a new copy: the client is told the same day.
    const [file] = await owner
      .insert(s.documentFiles)
      .values({ firmId: veritas, matterId: matter.id, filename: "bank.pdf", contentType: "application/pdf", size: 3, sha256: "x", data: Buffer.from("pdf") } as typeof s.documentFiles.$inferInsert)
      .returning();
    await owner.update(s.documentRequests).set({ status: "received", fileId: file.id }).where(eq(s.documentRequests.id, r.id));
    await stepDocumentRequest(admin, veritas, matter.id, r.id, { kind: "reject", note: "Last three months, please" });
    expect(await run(orgId, veritas)).toMatchObject({ clientSent: 1 });
    expect(clientMails()[0].text).toContain("please send a new copy");
    expect(await run(orgId, veritas, day(3))).toMatchObject({ clientSent: 0 });
  });

  it("sends each team member a digest of their own matters only, and never an empty one", async () => {
    const { veritas, orgId, admin, caseManager, outsider, matter } = await setup();
    await saveReminderSettings(admin, veritas, { ...on, clientNudges: false });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Passport copy", required: "on", dueOn: day(-3) });
    await owner.insert(s.matterDates).values({ firmId: veritas, matterId: matter.id, kind: "deadline", label: "Submit application", dueOn: day(4), basisKind: "recorded", basis: "Agreed with client" } as typeof s.matterDates.$inferInsert);
    await owner.insert(s.matterDates).values({ firmId: veritas, matterId: matter.id, kind: "deadline", label: "Far away", dueOn: day(40), basisKind: "recorded", basis: "Agreed with client" } as typeof s.matterDates.$inferInsert);
    sent.length = 0;

    const rep = await run(orgId, veritas);
    expect(rep.digestsSent).toBeGreaterThanOrEqual(1);
    const mine = digests().find((e) => e.to === caseManager.user.email)!;
    expect(mine.text).toContain("Passport copy");
    expect(mine.text).toContain("Submit application");
    expect(mine.text).not.toContain("Far away");
    expect(digests().find((e) => e.to === outsider.user.email)).toBeUndefined();

    // Once a day.
    expect((await run(orgId, veritas)).digestsSent).toBe(0);

    // Restricted matters stay with their team.
    await owner.update(s.matters).set({ restricted: true }).where(eq(s.matters.id, matter.id));
    sent.length = 0;
    await run(orgId, veritas, day(1));
    expect(digests().find((e) => e.to === caseManager.user.email)).toBeDefined();
    expect(digests().find((e) => e.to === outsider.user.email)).toBeUndefined();
  });

  it("keeps the log as history", async () => {
    const { veritas, orgId, admin, caseManager, matter } = await setup();
    await saveReminderSettings(admin, veritas, { ...on, clientNudges: false });
    await addDocumentRequest(admin, veritas, matter.id, { label: "Passport copy", required: "on", dueOn: day(-3) });
    await run(orgId, veritas);
    const [row] = await owner.select().from(s.reminderLog).where(and(eq(s.reminderLog.firmId, veritas), eq(s.reminderLog.userId, caseManager.user.id)));
    expect(row.status).toBe("not_configured");
    await expect(owner.update(s.reminderLog).set({ status: "sent" }).where(eq(s.reminderLog.id, row.id))).rejects.toThrow();
    await expect(owner.update(s.reminderLog).set({ recipient: "x@y.test" }).where(eq(s.reminderLog.id, row.id))).rejects.toThrow();
  });
});

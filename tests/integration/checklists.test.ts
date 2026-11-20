import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { withScope } from "../../src/server/db/client";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../src/server/errors";
import {
  addChecklistItem, addDocumentRequest, applyChecklist, createChecklistTemplate, getChecklistTemplate, newChecklistVersion, publishChecklistTemplate,
  removeChecklistItem, stepDocumentRequest,
} from "../../src/server/modules/checklists/checklists";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import { uploadFile } from "../../src/server/modules/documents/documents";
import { addMatterStage, changeMatterStage, createMatter, getMatter, savePerson } from "../../src/server/modules/matters/matters";
import { myDay } from "../../src/server/modules/today/today";
import { firmId, lead, makeUser, owner, resetDatabase, setCountryStatus } from "../support/fixtures";

async function setup() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ name: "Vera Admin", firms: { veritas: "firm_admin" } });
  const consultant = await makeUser({ name: "Con Sultant", firms: { veritas: "immigration_consultant" } });
  const caseManager = await makeUser({ name: "Casey Manager", firms: { veritas: "case_manager" } });
  const { lead: l } = await createLead(consultant, veritas, lead());
  const { client } = await convertLead(consultant, veritas, l.id);
  const matter = await createMatter(consultant, veritas, { clientId: client.id, title: "Partner visa", jurisdiction: "AU", caseManagerId: caseManager.user.id });
  return { veritas, admin, consultant, caseManager, clientId: client.id, matter };
}

async function publishedAuChecklist(admin: Awaited<ReturnType<typeof makeUser>>, veritas: string) {
  await setCountryStatus("AU", "verified");
  const t = await createChecklistTemplate(admin, veritas, { name: "Partner visa documents", countryCode: "AU", sourceNote: "Practice checklist reviewed against the department's document list" });
  await addChecklistItem(admin, veritas, t.id, { label: "Passport", appliesTo: "each_applicant", required: "on", tracksExpiry: "on" });
  await addChecklistItem(admin, veritas, t.id, { label: "Relationship evidence", appliesTo: "matter", required: "on" });
  await addChecklistItem(admin, veritas, t.id, { label: "Sponsor's citizenship evidence", appliesTo: "sponsor", required: "on" });
  await addChecklistItem(admin, veritas, t.id, { label: "Photos", appliesTo: "main_applicant" });
  return publishChecklistTemplate(admin, veritas, t.id);
}

const upload = (ctx: Awaited<ReturnType<typeof makeUser>>, veritas: string, matterId: string, name = "passport.txt") =>
  uploadFile(ctx, veritas, { matterId }, { name, type: "text/plain", data: Buffer.from(`scan of ${name}`) });

describe("checklist templates", () => {
  beforeEach(resetDatabase);

  it("publishes only for a reviewed country, with a source, and locks the published version", async () => {
    const { veritas, admin, consultant } = await setup();
    await expect(createChecklistTemplate(consultant, veritas, { name: "Nope", countryCode: "AU" })).rejects.toBeInstanceOf(AccessDeniedError);
    const t = await createChecklistTemplate(admin, veritas, { name: "Visitor visa", countryCode: "AU" });
    await expect(publishChecklistTemplate(admin, veritas, t.id)).rejects.toThrow(/at least one document/);
    await addChecklistItem(admin, veritas, t.id, { label: "Passport", appliesTo: "main_applicant", required: "on" });
    // AU is still a draft profile.
    await expect(publishChecklistTemplate(admin, veritas, t.id)).rejects.toThrow(/country profile is draft/);
    await setCountryStatus("AU", "verified");
    await expect(publishChecklistTemplate(admin, veritas, t.id)).rejects.toThrow(/comes from/);

    // A service for another country can't be attached.
    const [zaService] = await owner.select().from(s.services).where(eq(s.services.firmId, veritas)).limit(1);
    await expect(createChecklistTemplate(admin, veritas, { name: "Wrong", countryCode: "AU", serviceId: zaService.id })).rejects.toThrow(/for ZA, not AU/);

    const v1 = await (async () => {
      const t2 = await createChecklistTemplate(admin, veritas, { name: "Visitor visa (sourced)", countryCode: "AU", sourceNote: "Department document checklist, checked 21 Nov 2026" });
      await addChecklistItem(admin, veritas, t2.id, { label: "Passport", appliesTo: "main_applicant", required: "on" });
      return publishChecklistTemplate(admin, veritas, t2.id);
    })();
    expect(v1.status).toBe("published");
    const items = (await getChecklistTemplate(admin, veritas, v1.id)).items;
    await expect(addChecklistItem(admin, veritas, v1.id, { label: "Late" })).rejects.toBeInstanceOf(ConflictError);
    await expect(removeChecklistItem(admin, veritas, v1.id, items[0].id)).rejects.toBeInstanceOf(ConflictError);
    // The database refuses too.
    await expect(withScope(admin.scopeFor(veritas), (tx) => tx.execute(sql`update checklist_template_items set label = 'x' where template_id = ${v1.id}`))).rejects.toThrow();
    await expect(withScope(admin.scopeFor(veritas), (tx) => tx.execute(sql`update checklist_templates set name = 'x' where id = ${v1.id}`))).rejects.toThrow();

    // Next version copies the items; publishing it retires version 1.
    const v2 = await newChecklistVersion(admin, veritas, v1.id);
    expect(v2.version).toBe(2);
    await expect(newChecklistVersion(admin, veritas, v1.id)).rejects.toThrow(/already a draft/);
    await addChecklistItem(admin, veritas, v2.id, { label: "Bank statements", appliesTo: "main_applicant" });
    await publishChecklistTemplate(admin, veritas, v2.id);
    const view = await getChecklistTemplate(admin, veritas, v2.id);
    expect(view.items.map((i) => i.label)).toEqual(["Passport", "Bank statements"]);
    expect(view.versions.map((v) => [v.version, v.status])).toEqual([[2, "published"], [1, "retired"]]);
  });
});

describe("document requests", () => {
  beforeEach(resetDatabase);

  it("applies a checklist per person, keeps its version, and refuses another country's checklist", async () => {
    const { veritas, admin, consultant, clientId, matter } = await setup();
    const v1 = await publishedAuChecklist(admin, veritas);
    await savePerson(consultant, veritas, matter.id, null, { role: "spouse_partner", firstName: "Peter" });

    const nz = await createMatter(consultant, veritas, { clientId, title: "NZ visitor visa", jurisdiction: "NZ" });
    await expect(applyChecklist(consultant, veritas, nz.id, { templateId: v1.id })).rejects.toThrow(/aren't reused across countries/);

    expect((await getMatter(consultant, veritas, matter.id)).checklistsAvailable.map((c) => c.id)).toEqual([v1.id]);
    const r = await applyChecklist(consultant, veritas, matter.id, { templateId: v1.id, dueOn: "2026-12-15" });
    // Once applied it's no longer offered.
    expect((await getMatter(consultant, veritas, matter.id)).checklistsAvailable).toEqual([]);
    expect(r.created).toBe(4); // passport ×2 people, relationship evidence, photos
    expect(r.skipped[0]).toMatch(/Sponsor's citizenship evidence/);
    await expect(applyChecklist(consultant, veritas, matter.id, { templateId: v1.id })).rejects.toBeInstanceOf(ConflictError);

    // A newer version doesn't touch this matter.
    const v2 = await newChecklistVersion(admin, veritas, v1.id);
    await addChecklistItem(admin, veritas, v2.id, { label: "Police certificate", appliesTo: "each_applicant", required: "on" });
    await publishChecklistTemplate(admin, veritas, v2.id);
    const view = await getMatter(consultant, veritas, matter.id);
    expect(view.requests.requests.map((x) => x.label)).not.toContain("Police certificate");
    expect(view.requests.checklists.map((c) => [c.version, c.status])).toEqual([[1, "retired"]]);
    expect(view.requests.outstandingRequired).toBe(3);
    expect(view.checklistsAvailable.map((c) => c.version)).toEqual([2]);
  });

  it("separates received, reviewed and accepted, with expiry and reasons", async () => {
    const { veritas, admin, consultant, caseManager, matter } = await setup();
    await publishedAuChecklist(admin, veritas);
    const t = (await getMatter(consultant, veritas, matter.id)).checklistsAvailable[0];
    await applyChecklist(consultant, veritas, matter.id, { templateId: t.id });
    const passport = (await getMatter(consultant, veritas, matter.id)).requests.requests.find((x) => x.label === "Passport")!;

    // Receiving needs a file uploaded to this matter.
    await expect(stepDocumentRequest(caseManager, veritas, matter.id, passport.id, { kind: "review" })).rejects.toThrow(/requested/);
    const other = await createMatter(consultant, veritas, { clientId: matter.clientId, title: "Other", jurisdiction: "AU" });
    const stray = await upload(consultant, veritas, other.id, "other.txt");
    await expect(stepDocumentRequest(caseManager, veritas, matter.id, passport.id, { kind: "receive", fileId: stray.id })).rejects.toThrow(/uploaded to this matter/);
    const file = await upload(consultant, veritas, matter.id);
    await stepDocumentRequest(caseManager, veritas, matter.id, passport.id, { kind: "receive", fileId: file.id });
    await stepDocumentRequest(caseManager, veritas, matter.id, passport.id, { kind: "review" });

    // Accepting is a review decision; a case manager can't, a consultant (documents:approve) can.
    await expect(stepDocumentRequest(caseManager, veritas, matter.id, passport.id, { kind: "accept", expiresOn: "2031-05-01" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(stepDocumentRequest(consultant, veritas, matter.id, passport.id, { kind: "accept" })).rejects.toThrow(/expiry date/);
    await expect(stepDocumentRequest(consultant, veritas, matter.id, passport.id, { kind: "reject", note: "bad" })).rejects.toBeInstanceOf(ValidationError);
    await stepDocumentRequest(consultant, veritas, matter.id, passport.id, { kind: "reject", note: "The photo page is cut off; send a full scan." });
    const again = await upload(consultant, veritas, matter.id, "passport-full.txt");
    await stepDocumentRequest(caseManager, veritas, matter.id, passport.id, { kind: "receive", fileId: again.id });
    const accepted = await stepDocumentRequest(consultant, veritas, matter.id, passport.id, { kind: "accept", expiresOn: "2031-05-01" });
    expect([accepted.status, accepted.expiresOn, accepted.reviewerId]).toEqual(["accepted", "2031-05-01", consultant.user.id]);

    const history = (await getMatter(consultant, veritas, matter.id)).requests.requests.find((x) => x.id === passport.id)!.history;
    expect(history.map((h) => h.toStatus)).toEqual(["requested", "received", "under_review", "rejected", "received", "accepted"]);
    expect(history[3].note).toMatch(/cut off/);
    // History can't be rewritten; requests can't be deleted; accepted needs a file.
    await expect(withScope(consultant.scopeFor(veritas), (tx) => tx.execute(sql`delete from document_request_events`))).rejects.toThrow();
    await expect(withScope(consultant.scopeFor(veritas), (tx) => tx.execute(sql`delete from document_requests where id = ${passport.id}`))).rejects.toThrow();
    await expect(owner.execute(sql`update document_requests set file_id = null where id = ${passport.id}`)).rejects.toThrow();

    // Waiving needs a reason; ad-hoc requests sit alongside the checklist.
    const photos = (await getMatter(consultant, veritas, matter.id)).requests.requests.find((x) => x.label === "Photos")!;
    await expect(stepDocumentRequest(caseManager, veritas, matter.id, photos.id, { kind: "waive", note: "" })).rejects.toBeInstanceOf(ValidationError);
    await stepDocumentRequest(caseManager, veritas, matter.id, photos.id, { kind: "waive", note: "Photos taken at biometrics instead" });
    const extra = await addDocumentRequest(caseManager, veritas, matter.id, { label: "Statutory declaration", required: "on", dueOn: "2026-12-20" });
    expect(extra.status).toBe("requested");

    // My day: overdue requests for the case manager; documents waiting for review and expiring ones for a reviewer on the team.
    await addDocumentRequest(caseManager, veritas, matter.id, { label: "Old payslips", dueOn: "2020-01-01" });
    const rel = (await getMatter(consultant, veritas, matter.id)).requests.requests.find((x) => x.label === "Relationship evidence")!;
    await stepDocumentRequest(caseManager, veritas, matter.id, rel.id, { kind: "receive", fileId: (await upload(consultant, veritas, matter.id, "rel.txt")).id });
    await owner.update(s.documentRequests).set({ expiresOn: "2027-01-10" }).where(eq(s.documentRequests.id, passport.id));
    const cm = (await myDay(caseManager)).documents!;
    // The case manager can't approve documents, so nothing waits for their review.
    expect(cm.map((x) => [x.label, x.kind]).sort()).toEqual([["Old payslips", "overdue"], ["Passport", "expiring"]]);
    const co = (await myDay(consultant)).documents!;
    expect(co.map((x) => x.kind).sort()).toEqual(["expiring", "overdue", "review"]);
  });

  it("blocks a stage that needs documents until required ones are settled", async () => {
    const { veritas, admin, consultant, caseManager, matter } = await setup();
    await publishedAuChecklist(admin, veritas);
    const t = (await getMatter(consultant, veritas, matter.id)).checklistsAvailable[0];
    await applyChecklist(consultant, veritas, matter.id, { templateId: t.id });
    const lodge = await addMatterStage(admin, veritas, { name: "Lodge application", category: "submitted", requiresDocuments: "on" });
    await expect(changeMatterStage(caseManager, veritas, matter.id, lodge.id)).rejects.toThrow(/Still outstanding: Passport, Relationship evidence/);
    for (const r of (await getMatter(consultant, veritas, matter.id)).requests.requests.filter((x) => x.required)) {
      await stepDocumentRequest(caseManager, veritas, matter.id, r.id, { kind: "waive", note: "Already held from the previous application" });
    }
    const moved = await changeMatterStage(caseManager, veritas, matter.id, lodge.id);
    expect(moved.stage.name).toBe("Lodge application");
  });

  it("keeps requests inside the practice and inside restricted matters", async () => {
    const { veritas, admin, caseManager, clientId } = await setup();
    // Someone in the practice who isn't on the restricted matter's team.
    const consultant = await makeUser({ name: "Off Team", firms: { veritas: "immigration_consultant" } });
    await publishedAuChecklist(admin, veritas);
    const secret = await createMatter(admin, veritas, { clientId, title: "Restricted", jurisdiction: "AU", restricted: "on", caseManagerId: caseManager.user.id });
    const t = (await getMatter(admin, veritas, secret.id)).checklistsAvailable[0];
    await applyChecklist(admin, veritas, secret.id, { templateId: t.id });
    const r = (await getMatter(admin, veritas, secret.id)).requests.requests[0];
    await expect(stepDocumentRequest(consultant, veritas, secret.id, r.id, { kind: "waive", note: "Not on the team so can't" })).rejects.toBeInstanceOf(NotFoundError);
    const rows = await withScope(consultant.scopeFor(veritas), (tx) => tx.select().from(s.documentRequests).where(eq(s.documentRequests.matterId, secret.id)));
    expect(rows).toHaveLength(0);
    const mimshac = await makeUser({ firms: { mimshac: "firm_admin" } });
    const mimshacId = await firmId("mimshac");
    const leak = await withScope(mimshac.scopeFor(mimshacId), (tx) => tx.select().from(s.documentRequests));
    expect(leak).toHaveLength(0);
    await expect(createChecklistTemplate(mimshac, veritas, { name: "x y z", countryCode: "AU" })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

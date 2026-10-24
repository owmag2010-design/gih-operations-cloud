import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../src/server/errors";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import {
  addCalculatedDeadline, addFact, addMatterMember, addRecordedDate, adjustDate, changeMatterStage, createMatter, getMatter, listMatters,
  saveDeadlineRule, updateMatter, validateDeadlineRule, verifyFact,
} from "../../src/server/modules/matters/matters";
import { saveTaskTemplate, listTasks } from "../../src/server/modules/tasks/tasks";
import { addNote, listNotes } from "../../src/server/modules/notes/notes";
import { firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

async function setup() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ name: "Vera Admin", firms: { veritas: "firm_admin" } });
  const consultant = await makeUser({ name: "Con Sultant", firms: { veritas: "immigration_consultant" } });
  const caseManager = await makeUser({ name: "Casey Manager", firms: { veritas: "case_manager" } });
  const { lead: l } = await createLead(consultant, veritas, lead());
  const { client } = await convertLead(consultant, veritas, l.id);
  return { veritas, admin, consultant, caseManager, clientId: client.id };
}

describe("matters", () => {
  beforeEach(resetDatabase);

  it("opens a matter with default stages, the main applicant and template tasks", async () => {
    const { veritas, admin, consultant, caseManager, clientId } = await setup();
    const stages = await owner.select().from(s.matterStages).where(eq(s.matterStages.firmId, veritas));
    const documents = stages.find((x) => x.key === "documents")!;
    await saveTaskTemplate(admin, veritas, null, { title: "Send welcome pack", assignTo: "case_manager", dueOffsetDays: "2" });
    await saveTaskTemplate(admin, veritas, null, { title: "Request passport copy", stageId: documents.id, assignTo: "case_manager" });

    const m = await createMatter(consultant, veritas, { clientId, title: "Spouse visa", caseManagerId: caseManager.user.id });
    expect(m.ref).toMatch(/-M-000001$/);
    const view = await getMatter(consultant, veritas, m.id);
    expect(view.stage.key).toBe("opening");
    expect(view.people.map((p) => p.role)).toEqual(["main_applicant"]);

    let open = await listTasks(caseManager, { view: "mine" });
    expect(open.map((t) => t.title)).toEqual(["Send welcome pack"]);
    await changeMatterStage(caseManager, veritas, m.id, documents.id);
    await changeMatterStage(caseManager, veritas, m.id, stages.find((x) => x.key === "opening")!.id);
    await changeMatterStage(caseManager, veritas, m.id, documents.id);
    open = await listTasks(caseManager, { view: "mine" });
    // A template creates its task once per matter, however often the stage is reached.
    expect(open.map((t) => t.title).sort()).toEqual(["Request passport copy", "Send welcome pack"]);
    const history = await getMatter(caseManager, veritas, m.id);
    expect(history.timeline.filter((a) => a.type === "stage_change")).toHaveLength(3);
  });

  it("limits case managers to their matters and hides restricted matters from the rest of the practice", async () => {
    const { veritas, admin, consultant, caseManager, clientId } = await setup();
    const mine = await createMatter(consultant, veritas, { clientId, title: "Critical skills", caseManagerId: caseManager.user.id });
    const other = await createMatter(consultant, veritas, { clientId, title: "Study visa" });
    expect((await listMatters(caseManager, veritas)).rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(getMatter(caseManager, veritas, other.id)).rejects.toBeInstanceOf(NotFoundError);

    // Restricted: only the team and practice administrators.
    const colleague = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const secret = await createMatter(admin, veritas, { clientId, title: "Sensitive asylum review", restricted: "on", caseManagerId: caseManager.user.id });
    expect((await listMatters(colleague, veritas)).rows.map((r) => r.id)).not.toContain(secret.id);
    await expect(getMatter(colleague, veritas, secret.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getMatter(admin, veritas, secret.id)).matter.id).toBe(secret.id);
    expect((await getMatter(caseManager, veritas, secret.id)).matter.id).toBe(secret.id);
    await addMatterMember(admin, veritas, secret.id, colleague.user.id);
    expect((await getMatter(colleague, veritas, secret.id)).matter.id).toBe(secret.id);

    // Another practice can't reach Veritas matters at all.
    const mimshac = await makeUser({ firms: { mimshac: "firm_admin" } });
    await expect(getMatter(mimshac, veritas, mine.id)).rejects.toBeInstanceOf(AccessDeniedError);
    const mimshacId = await firmId("mimshac");
    await expect(getMatter(mimshac, mimshacId, mine.id)).rejects.toBeInstanceOf(NotFoundError);

    // Notes and tasks on a restricted matter are invisible to people off the team.
    await addNote(caseManager, veritas, { matterId: secret.id }, { body: "Client disclosed medical history" });
    const outsider = await makeUser({ firms: { veritas: "immigration_consultant" } });
    await expect(listNotes(outsider, veritas, { matterId: secret.id })).rejects.toBeInstanceOf(NotFoundError);
    const rows = await owner.select().from(s.notes).where(eq(s.notes.matterId, secret.id));
    expect(rows).toHaveLength(1);

    // Only administrators or the case manager can lift the restriction.
    await expect(updateMatter(colleague, veritas, secret.id, { title: "Sensitive asylum review", restricted: "" })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("keeps verified facts apart from client statements", async () => {
    const { veritas, consultant, clientId } = await setup();
    const m = await createMatter(consultant, veritas, { clientId, title: "Spouse visa" });
    await expect(addFact(consultant, veritas, m.id, { label: "Married since", value: "2019", basis: "verified" })).rejects.toBeInstanceOf(ValidationError);
    const f = await addFact(consultant, veritas, m.id, { label: "Married since", value: "2019", basis: "client_statement" });
    expect(f.basis).toBe("client_statement");
    const v = await verifyFact(consultant, veritas, m.id, f.id, "Marriage certificate");
    expect([v.basis, v.evidence, v.verifiedById]).toEqual(["verified", "Marriage certificate", consultant.user.id]);
  });

  it("calculates deadlines only from validated rules and records adjustments", async () => {
    const { veritas, admin, consultant, clientId } = await setup();
    const m = await createMatter(consultant, veritas, { clientId, title: "Appeal" });
    const rule = await saveDeadlineRule(admin, veritas, null, { name: "Internal test rule", jurisdiction: "ZA", offsetDays: "10", businessDays: "on", fromLabel: "the date the refusal was received", source: "Test source for automated checks" });
    await expect(addCalculatedDeadline(consultant, veritas, m.id, { ruleId: rule.id, fromDate: "2026-10-26" })).rejects.toThrow(/validated/);
    await expect(validateDeadlineRule(consultant, veritas, rule.id, true)).rejects.toBeInstanceOf(AccessDeniedError);
    await validateDeadlineRule(admin, veritas, rule.id, true);
    const d = await addCalculatedDeadline(consultant, veritas, m.id, { ruleId: rule.id, fromDate: "2026-10-26" });
    expect(d.dueOn).toBe("2026-11-09");
    expect(d.basis).toContain("10 business days");
    expect(d.basis).toContain("Test source");

    const adj = await adjustDate(consultant, veritas, m.id, d.id, { dueOn: "2026-11-10", reason: "Public holiday in the period" });
    expect([adj.basisKind, adj.dueOn, adj.reviewedById]).toEqual(["adjusted", "2026-11-10", consultant.user.id]);

    // Editing a rule clears its validation.
    await saveDeadlineRule(admin, veritas, rule.id, { name: "Internal test rule", jurisdiction: "ZA", offsetDays: "14", fromLabel: "x date", source: "Test source for automated checks" });
    await expect(addCalculatedDeadline(consultant, veritas, m.id, { ruleId: rule.id, fromDate: "2026-10-26" })).rejects.toThrow(/validated/);

    const rec = await addRecordedDate(consultant, veritas, m.id, { kind: "expiry", label: "Visitor visa expires", dueOn: "2027-01-31", basis: "Visa label in passport" });
    expect(rec.basisKind).toBe("recorded");
  });
});

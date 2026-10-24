import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../src/server/errors";
import { cancelEvent, createEvent, listCalendar } from "../../src/server/modules/calendar/calendar";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import { addRecordedDate, createMatter } from "../../src/server/modules/matters/matters";
import { addNote, deleteNote, editNote, listNotes, noteHistory, searchNotes } from "../../src/server/modules/notes/notes";
import { claimTask, completeTask, createTask, listTasks, updateTask } from "../../src/server/modules/tasks/tasks";
import { firmId, lead, makeUser, resetDatabase } from "../support/fixtures";

async function setup() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ name: "Vera Admin", firms: { veritas: "firm_admin" } });
  const consultant = await makeUser({ name: "Con Sultant", firms: { veritas: "immigration_consultant" } });
  const support = await makeUser({ name: "Sue Port", firms: { veritas: "support_officer" } });
  const { lead: l } = await createLead(consultant, veritas, lead());
  const { client } = await convertLead(consultant, veritas, l.id);
  const matter = await createMatter(consultant, veritas, { clientId: client.id, title: "Spouse visa" });
  return { veritas, admin, consultant, support, client, matter };
}

describe("tasks", () => {
  beforeEach(resetDatabase);

  it("keeps personal tasks private and shares team tasks within the practice", async () => {
    const { veritas, consultant, support, matter } = await setup();
    const personal = await createTask(consultant, { title: "Renew my practising certificate" });
    expect(personal.firmId).toBeNull();
    expect((await listTasks(support, { view: "all" })).map((t) => t.id)).not.toContain(personal.id);
    await expect(createTask(consultant, { title: "x task", assigneeId: support.user.id })).rejects.toBeInstanceOf(ValidationError);

    const team = await createTask(consultant, { title: "Call the VFS centre", firmId: veritas });
    expect((await listTasks(support, { view: "team" })).map((t) => t.id)).toContain(team.id);
    await claimTask(support, team.id);
    expect((await listTasks(support, { view: "mine" })).map((t) => t.id)).toEqual([team.id]);
    await expect(claimTask(consultant, team.id)).rejects.toBeInstanceOf(ValidationError);

    // A matter-linked task must be in the matter's practice and a matter the person can see.
    const mimshac = await firmId("mimshac");
    const other = await makeUser({ firms: { mimshac: "firm_admin" } });
    await expect(createTask(other, { title: "Peek", firmId: mimshac, matterId: matter.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTask(other, { title: "Peek", firmId: veritas })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("creates the next occurrence when a repeating task is completed", async () => {
    const { veritas, consultant } = await setup();
    const due = new Date("2026-11-02T08:00:00Z");
    const t = await createTask(consultant, { title: "Weekly pipeline review", firmId: veritas, assigneeId: consultant.user.id, dueAt: due.toISOString(), allDay: "", recurrence: "weekly", reminderAt: new Date("2026-11-02T07:00:00Z").toISOString() });
    const { next } = await completeTask(consultant, t.id);
    expect(next?.dueAt?.toISOString()).toBe("2026-11-09T08:00:00.000Z");
    expect(next?.reminderAt?.toISOString()).toBe("2026-11-09T07:00:00.000Z");
    await expect(createTask(consultant, { title: "Repeats without date", recurrence: "daily" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateTask(consultant, t.id, { title: "Move it", firmId: "" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("notes", () => {
  beforeEach(resetDatabase);

  it("classifies notes, keeps revisions, and searches only what the person can see", async () => {
    const { veritas, consultant, support, matter, client } = await setup();
    const n = await addNote(consultant, veritas, { matterId: matter.id }, { body: "Sponsor's payslips outstanding", visibility: "internal" });
    await editNote(consultant, veritas, n.id, { body: "Sponsor's payslips received for Aug–Oct", visibility: "client_visible" });
    const history = await noteHistory(consultant, veritas, n.id);
    expect(history.map((h) => [h.version, h.visibility])).toEqual([[2, "client_visible"], [1, "internal"]]);
    await addNote(consultant, veritas, { clientId: client.id }, { body: "Prefers WhatsApp for payslips reminders" });

    expect((await searchNotes(consultant, veritas, "payslips")).length).toBe(2);
    // Support officers see only assigned matters and clients.
    expect(await searchNotes(support, veritas, "payslips")).toEqual([]);
    await expect(editNote(support, veritas, n.id, { body: "x" })).rejects.toThrow();

    await deleteNote(consultant, veritas, n.id);
    expect((await listNotes(consultant, veritas, { matterId: matter.id })).map((x) => x.id)).not.toContain(n.id);
    expect(await noteHistory(consultant, veritas, n.id)).toHaveLength(2);
  });
});

describe("calendar", () => {
  beforeEach(resetDatabase);

  it("shows events, task due dates and matter deadlines to the right people", async () => {
    const { veritas, consultant, support, matter } = await setup();
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-12-01T00:00:00Z");
    const consult = await createEvent(consultant, { title: "Consultation", kind: "consultation", firmId: veritas, matterId: matter.id, startsAt: "2026-11-03T09:00:00+02:00", endsAt: "2026-11-03T10:00:00+02:00", timeZone: "Africa/Johannesburg" });
    const mine = await createEvent(consultant, { title: "Dentist", kind: "other", startsAt: "2026-11-04T09:00:00+11:00", timeZone: "Australia/Sydney" });
    await createTask(consultant, { title: "Submit at VFS", firmId: veritas, assigneeId: consultant.user.id, matterId: matter.id, dueAt: "2026-11-05T10:00:00Z" });
    await addRecordedDate(consultant, veritas, matter.id, { kind: "expiry", label: "Visa expires", dueOn: "2026-11-20", basis: "Visa label" });

    const cal = await listCalendar(consultant, { from, to });
    expect(cal.map((c) => c.source).sort()).toEqual(["event", "event", "expiry", "task"]);
    expect(cal.find((c) => c.key === `e-${consult.id}`)?.start).toBe("2026-11-03T07:00:00.000Z");

    const theirs = await listCalendar(support, { from, to });
    expect(theirs.map((c) => c.key)).toContain(`e-${consult.id}`);
    expect(theirs.map((c) => c.key)).not.toContain(`e-${mine.id}`);
    // Support officers only see dates on matters they are assigned to.
    expect(theirs.some((c) => c.source === "expiry")).toBe(false);

    await expect(createEvent(consultant, { title: "Bad", startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T09:00:00Z" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEvent(consultant, { title: "Bad zone", startsAt: "2026-11-03T10:00:00Z", timeZone: "Mars/Olympus" })).rejects.toBeInstanceOf(ValidationError);
    await cancelEvent(consultant, consult.id);
    expect((await listCalendar(consultant, { from, to })).map((c) => c.key)).not.toContain(`e-${consult.id}`);
  });
});

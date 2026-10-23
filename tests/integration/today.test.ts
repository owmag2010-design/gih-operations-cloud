import { beforeEach, describe, expect, it } from "vitest";
import { createLead } from "../../src/server/modules/crm/leads";
import { createProposalFromLead, requestChanges, submitForReview } from "../../src/server/modules/proposals/proposals";
import { listCatalogue } from "../../src/server/modules/services/services";
import { myDay } from "../../src/server/modules/today/today";
import { firmId, lead, makeUser, resetDatabase } from "../support/fixtures";

describe("my day", () => {
  beforeEach(resetDatabase);

  it("shows a person's own follow-ups and proposals, only in practices they belong to", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const outsider = await makeUser({ firms: { mimshac: "firm_admin" } });
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const { lead: l } = await createLead(consultant, veritas, lead({ assignedToId: consultant.user.id, followUpAt: soon }));
    await createLead(consultant, veritas, lead({ firstName: "Later", assignedToId: consultant.user.id, followUpAt: new Date(Date.now() + 10 * 864e5).toISOString() }));

    const catalogue = await listCatalogue(admin, veritas, { activeOnly: true });
    const p = await createProposalFromLead(consultant, veritas, l.id, { serviceIds: [catalogue[0].id] });
    await submitForReview(consultant, veritas, p.id);

    const mine = await myDay(consultant);
    expect(mine.followUps?.map((f) => f.id)).toEqual([l.id]);
    expect(mine.practices.map((x) => x.slug)).toEqual(["veritas"]);
    expect(mine.practices[0].openLeads).toBe(2);
    expect(mine.practices[0].inReview).toBe(1);
    expect(mine.intake).toBeNull();

    const reviewer = await myDay(admin);
    expect(reviewer.reviews?.map((r) => r.id)).toEqual([p.id]);
    // Follow-ups listed are only the person's own.
    expect(reviewer.followUps).toEqual([]);

    await requestChanges(admin, veritas, p.id, "Add the notarial fee");
    const back = await myDay(consultant);
    expect(back.changes?.map((c) => [c.id, c.note])).toEqual([[p.id, "Add the notarial fee"]]);

    const other = await myDay(outsider);
    expect(other.practices.map((x) => x.slug)).toEqual(["mimshac"]);
    expect(other.followUps).toEqual([]);
    expect(other.reviews ?? []).toEqual([]);
  });
});

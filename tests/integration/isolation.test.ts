import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, withScope } from "../../src/server/db/client";
import { leads } from "../../src/server/db/schema";
import { AccessDeniedError, NotFoundError } from "../../src/server/errors";
import { getClient } from "../../src/server/modules/clients/clients";
import { convertLead, createLead, getLead, listLeads, updateLead } from "../../src/server/modules/crm/leads";
import { firmDashboard, groupCommandCentre } from "../../src/server/modules/metrics/metrics";
import { globalSearch } from "../../src/server/modules/search";
import { firmId, lead, makeUser, resetDatabase, setFirmPolicy } from "../support/fixtures";

describe("firm isolation", () => {
  beforeEach(resetDatabase);

  it("a member of one firm cannot read another firm's lead by id, URL or firm swap", async () => {
    const veritas = await firmId("veritas");
    const mimshac = await firmId("mimshac");
    const vConsultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const mConsultant = await makeUser({ firms: { mimshac: "immigration_consultant" } });
    const { lead: vLead } = await createLead(vConsultant, veritas, lead());

    // Asking for the other firm outright is refused.
    await expect(getLead(mConsultant, veritas, vLead.id)).rejects.toBeInstanceOf(AccessDeniedError);
    // Asking through their own firm with the other firm's id finds nothing.
    await expect(getLead(mConsultant, mimshac, vLead.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateLead(mConsultant, mimshac, vLead.id, lead({ firstName: "Hijack" }))).rejects.toBeInstanceOf(NotFoundError);
    const list = await listLeads(mConsultant, mimshac, { status: "all" });
    expect(list.rows.map((r) => r.id)).not.toContain(vLead.id);
    // Search never crosses firms.
    const hits = await globalSearch(mConsultant, vLead.firstName);
    expect(hits.find((h) => h.id === vLead.id)).toBeUndefined();
  });

  it("PostgreSQL row-level security blocks reads and writes outside the transaction's firms", async () => {
    const veritas = await firmId("veritas");
    const mimshac = await firmId("mimshac");
    const vConsultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: vLead } = await createLead(vConsultant, veritas, lead());

    // No scope at all: nothing is visible to the app role.
    const unscoped = await db().select().from(leads);
    expect(unscoped).toHaveLength(0);

    // Scoped to Mimshac: the Veritas row is invisible, even by primary key.
    const seen = await withScope({ orgId: vConsultant.orgId, userId: null, firmIds: [mimshac] }, (tx) => tx.execute(sql`select id from leads where id = ${vLead.id}`));
    expect(seen.rows).toHaveLength(0);

    // Updating it from a Mimshac scope changes nothing.
    const updated = await withScope({ orgId: vConsultant.orgId, userId: null, firmIds: [mimshac] }, (tx) => tx.execute(sql`update leads set first_name = 'x' where id = ${vLead.id}`));
    expect(updated.rowCount).toBe(0);

    // Inserting a row for a firm outside the scope violates the policy.
    const err = await withScope({ orgId: vConsultant.orgId, userId: null, firmIds: [veritas] }, (tx) =>
      tx.execute(sql`insert into activities (firm_id, lead_id, type) values (${mimshac}, ${vLead.id}, 'note')`),
    ).catch((e: Error & { cause?: Error }) => e.cause ?? e);
    expect(String((err as Error)?.message)).toMatch(/row-level security/);
  });

  it("a stage from another firm cannot be attached to a lead (cross-firm foreign key)", async () => {
    const veritas = await firmId("veritas");
    const mimshac = await firmId("mimshac");
    const vConsultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: vLead } = await createLead(vConsultant, veritas, lead());
    const mStage = await withScope({ orgId: vConsultant.orgId, userId: null, firmIds: [mimshac] }, (tx) => tx.execute<{ id: string }>(sql`select id from pipeline_stages limit 1`));
    await expect(
      withScope({ orgId: vConsultant.orgId, userId: null, firmIds: [veritas] }, (tx) => tx.execute(sql`update leads set stage_id = ${mStage.rows[0].id} where id = ${vLead.id}`)),
    ).rejects.toThrow();
  });

  it("group roles do not grant record access to firms", async () => {
    const veritas = await firmId("veritas");
    const superAdmin = await makeUser({ group: "group_super_admin" });
    await expect(listLeads(superAdmin, veritas)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(firmDashboard(superAdmin, veritas, new Date(0))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("group metrics show aggregates only for firms that share them", async () => {
    const veritas = await firmId("veritas");
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    await createLead(consultant, veritas, lead());
    await createLead(consultant, veritas, lead());
    const ops = await makeUser({ group: "group_ops_admin" });

    const shared = await groupCommandCentre(ops, { since: new Date(0) });
    expect(shared.perFirm.find((f) => f.firmId === veritas)?.openLeads).toBe(2);
    expect(shared.workload).toEqual([]); // no firm membership → no per-person workload

    await setFirmPolicy("veritas", { shareAggregateMetrics: false });
    const withheld = await groupCommandCentre(ops, { since: new Date(0) });
    expect(withheld.perFirm.find((f) => f.firmId === veritas)).toBeUndefined();
    expect(withheld.withheldFirms).toContain("Veritas Emigrate");
  });

  it("assigned-only roles see only their own leads and clients", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    const support = await makeUser({ firms: { veritas: "support_officer" } });
    const { lead: mine } = await createLead(admin, veritas, lead({ assignedToId: support.user.id }));
    const { lead: other } = await createLead(admin, veritas, lead());

    const list = await listLeads(support, veritas);
    expect(list.rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(getLead(support, veritas, other.id)).rejects.toBeInstanceOf(NotFoundError);

    const { client } = await convertLead(admin, veritas, other.id);
    await expect(getClient(support, veritas, client.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

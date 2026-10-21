import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadAccessContext } from "../../src/server/access/context";
import { createInvitation } from "../../src/server/auth/service";
import { createSession, validateSessionToken } from "../../src/server/auth/sessions";
import { firmMemberships, sessions } from "../../src/server/db/schema";
import { AccessDeniedError, ValidationError } from "../../src/server/errors";
import { assignLeads, createLead, deleteLeads, exportLeadsCsv } from "../../src/server/modules/crm/leads";
import { joinFirmAsGroupAdmin, updateFirmPolicies } from "../../src/server/modules/org/firms";
import { changeFirmRole, deactivateUser, removeFirmMembership, setGroupRole } from "../../src/server/modules/people/people";
import { firmId, lead, makeUser, owner, reload, resetDatabase, roleId, setFirmPolicy } from "../support/fixtures";

describe("permissions and privilege escalation", () => {
  beforeEach(resetDatabase);

  it("enforces the subset rule on invitations", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const ops = await makeUser({ group: "group_ops_admin" });

    // A consultant has no team:invite at all.
    await expect(createInvitation(consultant, { email: "a@test.example", name: "A B", roleId: await roleId("immigration_consultant"), firmId: veritas })).rejects.toBeInstanceOf(AccessDeniedError);
    // A firm admin can invite a consultant.
    const ok = await createInvitation(admin, { email: "b@test.example", name: "B C", roleId: await roleId("immigration_consultant"), firmId: veritas });
    expect(ok.link).toMatch(/\/invite\//);
    expect(ok.email.status).toBe("not_configured");
    // Ops admins cannot create a super admin (or anyone: they lack staff:invite).
    await expect(createInvitation(ops, { email: "c@test.example", name: "C D", roleId: await roleId("group_super_admin"), firmId: null })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("a firm admin with a reduced role cannot grant permissions they lack", async () => {
    const veritas = await firmId("veritas");
    // A custom firm role that can invite but not delete leads.
    const [org] = await owner.query.organisations.findMany({ limit: 1 });
    const { roles } = await import("../../src/server/db/schema");
    const [limited] = await owner
      .insert(roles)
      .values({ orgId: org.id, key: "team_lead", name: "Team lead", scope: "firm", permissions: ["firm:view", "team:view", "team:invite", "team:manage", "leads:view_all"] })
      .returning();
    const lead1 = await makeUser({ firms: {} });
    await owner.insert(firmMemberships).values({ firmId: veritas, userId: lead1.user.id, roleId: limited.id });
    const teamLead = (await reload(lead1))!;
    await expect(createInvitation(teamLead, { email: "d@test.example", name: "D E", roleId: await roleId("firm_admin"), firmId: veritas })).rejects.toBeInstanceOf(AccessDeniedError);

    // Nor promote an existing member beyond their own permissions.
    const reviewer = await makeUser({ firms: { veritas: "reviewer" } });
    const membership = (await owner.select().from(firmMemberships).where(eq(firmMemberships.userId, reviewer.user.id)))[0];
    await expect(changeFirmRole(teamLead, membership.id, await roleId("firm_admin"))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("nobody can change their own role, and the last firm admin stays", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    const mine = (await owner.select().from(firmMemberships).where(eq(firmMemberships.userId, admin.user.id)))[0];
    await expect(changeFirmRole(admin, mine.id, await roleId("reviewer"))).rejects.toBeInstanceOf(AccessDeniedError);

    const superAdmin = await makeUser({ group: "group_super_admin" });
    await setFirmPolicy("veritas", { allowGroupAdminAccess: true });
    await expect(removeFirmMembership(superAdmin, mine.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeFirmRole(superAdmin, mine.id, await roleId("reviewer"))).rejects.toBeInstanceOf(ValidationError);
    await expect(setGroupRole(superAdmin, superAdmin.user.id, null)).rejects.toBeInstanceOf(AccessDeniedError);
    void veritas;
  });

  it("revoking a membership or deactivating a user takes effect immediately", async () => {
    const veritas = await firmId("veritas");
    const superAdmin = await makeUser({ group: "group_super_admin" });
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    await createLead(consultant, veritas, lead());

    const m = (await owner.select().from(firmMemberships).where(eq(firmMemberships.userId, consultant.user.id)))[0];
    await removeFirmMembership(admin, m.id);
    const after = await reload(consultant);
    expect(after!.firms.has(veritas)).toBe(false);

    const { token } = await createSession(admin.user.id, { mfaVerified: true });
    expect(await validateSessionToken(token)).not.toBeNull();
    // Admin is the last firm admin, so add another before deactivating.
    const admin2 = await makeUser({ firms: { veritas: "firm_admin" } });
    await deactivateUser(superAdmin, admin.user.id);
    expect(await validateSessionToken(token)).toBeNull();
    expect(await loadAccessContext(admin.user.id)).toBeNull();
    expect(await owner.select().from(sessions).where(eq(sessions.userId, admin.user.id))).toHaveLength(0);
    void admin2;
  });

  it("checks each mutation's own permission", async () => {
    const veritas = await firmId("veritas");
    const reviewer = await makeUser({ firms: { veritas: "reviewer" } });
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(consultant, veritas, lead());
    await expect(createLead(reviewer, veritas, lead())).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(assignLeads(reviewer, veritas, [l.id], reviewer.user.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(deleteLeads(consultant, veritas, [l.id])).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(exportLeadsCsv(consultant, veritas, {})).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("group admins join a firm only when the firm's own policy allows it", async () => {
    const veritas = await firmId("veritas");
    const superAdmin = await makeUser({ group: "group_super_admin" });
    await expect(joinFirmAsGroupAdmin(superAdmin, veritas)).rejects.toBeInstanceOf(AccessDeniedError);
    // Group admins cannot flip the firm's policy themselves.
    await expect(updateFirmPolicies(superAdmin, veritas, { allowGroupAdminAccess: "on" })).rejects.toBeInstanceOf(AccessDeniedError);
    await setFirmPolicy("veritas", { allowGroupAdminAccess: true });
    await joinFirmAsGroupAdmin(superAdmin, veritas);
    expect((await reload(superAdmin))!.firms.has(veritas)).toBe(true);
  });

  it("Hub administrators can't place people in a firm whose policy keeps the Hub out (review H1)", async () => {
    const veritas = await firmId("veritas");
    const superAdmin = await makeUser({ group: "group_super_admin" });
    const member = await makeUser({ firms: { veritas: "reviewer" } });
    const m = (await owner.select().from(firmMemberships).where(eq(firmMemberships.userId, member.user.id)))[0];
    await expect(createInvitation(superAdmin, { email: "alias@test.example", name: "Alias", roleId: await roleId("firm_admin"), firmId: veritas })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(changeFirmRole(superAdmin, m.id, await roleId("firm_admin"))).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(removeFirmMembership(superAdmin, m.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await setFirmPolicy("veritas", { allowGroupAdminAccess: true });
    await expect(createInvitation(superAdmin, { email: "ok@test.example", name: "Allowed", roleId: await roleId("immigration_consultant"), firmId: veritas })).resolves.toBeTruthy();
  });

  it("an invitation stops working if the inviter loses the right to grant it", async () => {
    const veritas = await firmId("veritas");
    const admin = await makeUser({ firms: { veritas: "firm_admin" } });
    await makeUser({ firms: { veritas: "firm_admin" } }); // keeps a firm admin after the demotion
    const { link } = await createInvitation(admin, { email: "late@test.example", name: "Late Joiner", roleId: await roleId("immigration_consultant"), firmId: veritas });
    const am = (await owner.select().from(firmMemberships).where(eq(firmMemberships.userId, admin.user.id)))[0];
    await owner.update(firmMemberships).set({ roleId: await roleId("reviewer") }).where(eq(firmMemberships.id, am.id));
    const { acceptInvitation } = await import("../../src/server/auth/service");
    await expect(acceptInvitation({ token: link.split("/invite/")[1], password: "a long enough passphrase", ip: null, userAgent: null })).rejects.toBeInstanceOf(ValidationError);
  });
});

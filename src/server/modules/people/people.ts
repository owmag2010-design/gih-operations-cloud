import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { deleteUserSessions } from "../../auth/sessions";
import { db } from "../../db/client";
import { departments, firmMemberships, firms, groupMemberships, invitations, roles, sessions, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";

const subset = (needed: readonly string[], held: ReadonlySet<string>) => needed.every((p) => held.has(p));

export async function listRoles(ctx: AccessContext, scope?: "group" | "firm") {
  const rows = await db().select().from(roles).where(eq(roles.orgId, ctx.orgId)).orderBy(asc(roles.name));
  return rows.filter((r) => (scope ? r.scope === scope : r.scope !== "portal"));
}

/** Roles the caller may grant in a firm (subset rule), or every firm role for group staff managers. */
export async function grantableFirmRoles(ctx: AccessContext, firmId: string) {
  const all = await listRoles(ctx, "firm");
  if (ctx.has("staff:manage")) return all;
  if (!ctx.has("team:invite", firmId) && !ctx.has("team:manage", firmId)) return [];
  const held = ctx.firm(firmId).permissions;
  return all.filter((r) => subset(r.permissions, held));
}

export async function grantableGroupRoles(ctx: AccessContext) {
  if (!ctx.group || !ctx.has("staff:invite")) return [];
  const held = ctx.group.permissions;
  return (await listRoles(ctx, "group")).filter((r) => subset(r.permissions, held));
}

/** Organisation staff directory (group view). */
export async function listOrgStaff(ctx: AccessContext) {
  ctx.require("staff:view");
  const people = await db()
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt, mfaEnabledAt: users.mfaEnabledAt, groupRole: roles.name, groupRoleId: roles.id })
    .from(users)
    .leftJoin(groupMemberships, eq(groupMemberships.userId, users.id))
    .leftJoin(roles, eq(roles.id, groupMemberships.roleId))
    .where(and(eq(users.orgId, ctx.orgId), eq(users.kind, "staff")))
    .orderBy(asc(users.name));
  const memberships = await db()
    .select({ userId: firmMemberships.userId, firm: firms.tradingName, firmId: firms.id, role: roles.name, status: firmMemberships.status })
    .from(firmMemberships)
    .innerJoin(firms, eq(firms.id, firmMemberships.firmId))
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .where(eq(firms.orgId, ctx.orgId));
  return people.map((p) => ({ ...p, firms: memberships.filter((m) => m.userId === p.id) }));
}

export async function listFirmTeam(ctx: AccessContext, firmId: string) {
  ctx.require("team:view", firmId);
  return db()
    .select({
      membershipId: firmMemberships.id, userId: users.id, name: users.name, email: users.email, status: users.status, membershipStatus: firmMemberships.status,
      title: firmMemberships.title, roleId: roles.id, roleName: roles.name, roleKey: roles.key, department: departments.name, mfaEnabledAt: users.mfaEnabledAt, lastLoginAt: users.lastLoginAt,
    })
    .from(firmMemberships)
    .innerJoin(users, eq(users.id, firmMemberships.userId))
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .leftJoin(departments, eq(departments.id, firmMemberships.departmentId))
    .where(eq(firmMemberships.firmId, firmId))
    .orderBy(asc(users.name));
}

export async function listPendingInvitations(ctx: AccessContext, firmId: string | null) {
  if (firmId) {
    if (!ctx.has("team:view", firmId) && !ctx.has("staff:view")) throw new AccessDeniedError("team:view");
  } else ctx.require("staff:view");
  return db()
    .select({ id: invitations.id, email: invitations.email, name: invitations.name, role: roles.name, firm: firms.tradingName, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .leftJoin(firms, eq(firms.id, invitations.firmId))
    .where(and(eq(invitations.orgId, ctx.orgId), firmId ? eq(invitations.firmId, firmId) : undefined, isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));
}

async function loadMembership(ctx: AccessContext, membershipId: string) {
  const [m] = await db()
    .select({ id: firmMemberships.id, firmId: firmMemberships.firmId, userId: firmMemberships.userId, roleId: firmMemberships.roleId, roleKey: roles.key, firmOrg: firms.orgId, userName: users.name })
    .from(firmMemberships)
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .innerJoin(firms, eq(firms.id, firmMemberships.firmId))
    .innerJoin(users, eq(users.id, firmMemberships.userId))
    .where(eq(firmMemberships.id, membershipId))
    .limit(1);
  if (!m || m.firmOrg !== ctx.orgId) throw new NotFoundError("Membership");
  return m;
}

function canManageFirmTeam(ctx: AccessContext, firmId: string) {
  return ctx.has("team:manage", firmId) || ctx.has("staff:manage");
}

async function assertNotLastAdmin(firmId: string, exceptMembershipId: string) {
  const [{ n }] = await db()
    .select({ n: count() })
    .from(firmMemberships)
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .innerJoin(users, eq(users.id, firmMemberships.userId))
    .where(and(eq(firmMemberships.firmId, firmId), eq(roles.key, "firm_admin"), eq(firmMemberships.status, "active"), eq(users.status, "active"), ne(firmMemberships.id, exceptMembershipId)));
  if (n === 0) throw new ValidationError("A firm needs at least one active Firm Administrator.");
}

export async function changeFirmRole(ctx: AccessContext, membershipId: string, roleId: string) {
  const m = await loadMembership(ctx, membershipId);
  if (!canManageFirmTeam(ctx, m.firmId)) throw new AccessDeniedError("team:manage");
  if (m.userId === ctx.user.id) throw new AccessDeniedError("self");
  const [role] = await db().select().from(roles).where(and(eq(roles.id, roleId), eq(roles.orgId, ctx.orgId), eq(roles.scope, "firm"))).limit(1);
  if (!role) throw new ValidationError("Choose a firm role.");
  if (!ctx.has("staff:manage")) {
    const held = ctx.firm(m.firmId).permissions;
    if (!subset(role.permissions, held)) throw new AccessDeniedError("subset");
    // Nor may they change the role of someone who holds more than they do.
    const [current] = await db().select().from(roles).where(eq(roles.id, m.roleId));
    if (!subset(current.permissions, held)) throw new AccessDeniedError("subset");
  }
  if (m.roleKey === "firm_admin" && role.key !== "firm_admin") await assertNotLastAdmin(m.firmId, m.id);
  await db().update(firmMemberships).set({ roleId: role.id }).where(eq(firmMemberships.id, m.id));
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: m.firmId, action: "staff.role_changed", entityType: "firm_membership", entityId: m.id, summary: `${m.userName} is now ${role.name}`, data: { from: m.roleKey, to: role.key }, ip: ctx.ip });
}

export async function updateMembershipDetails(ctx: AccessContext, membershipId: string, details: { title?: string; departmentId?: string | null }) {
  const m = await loadMembership(ctx, membershipId);
  if (!canManageFirmTeam(ctx, m.firmId)) throw new AccessDeniedError("team:manage");
  if (details.departmentId) {
    const [d] = await db().select().from(departments).where(and(eq(departments.id, details.departmentId), eq(departments.firmId, m.firmId)));
    if (!d) throw new ValidationError("Choose a department of this firm.");
  }
  await db().update(firmMemberships).set({ title: details.title?.trim().slice(0, 120) || null, departmentId: details.departmentId || null }).where(eq(firmMemberships.id, m.id));
}

export async function removeFirmMembership(ctx: AccessContext, membershipId: string) {
  const m = await loadMembership(ctx, membershipId);
  if (!canManageFirmTeam(ctx, m.firmId)) throw new AccessDeniedError("team:manage");
  if (m.userId === ctx.user.id) throw new AccessDeniedError("self");
  if (!ctx.has("staff:manage")) {
    const [current] = await db().select().from(roles).where(eq(roles.id, m.roleId));
    if (!subset(current.permissions, ctx.firm(m.firmId).permissions)) throw new AccessDeniedError("subset");
  }
  if (m.roleKey === "firm_admin") await assertNotLastAdmin(m.firmId, m.id);
  await db().delete(firmMemberships).where(eq(firmMemberships.id, m.id));
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: m.firmId, action: "staff.removed_from_firm", entityType: "firm_membership", entityId: m.id, summary: `Removed ${m.userName} from the firm`, ip: ctx.ip });
}

export async function setGroupRole(ctx: AccessContext, userId: string, roleId: string | null) {
  ctx.require("staff:manage");
  if (userId === ctx.user.id) throw new AccessDeniedError("self");
  const [target] = await db().select().from(users).where(and(eq(users.id, userId), eq(users.orgId, ctx.orgId))).limit(1);
  if (!target) throw new NotFoundError("Person");
  if (roleId) {
    const [role] = await db().select().from(roles).where(and(eq(roles.id, roleId), eq(roles.orgId, ctx.orgId), eq(roles.scope, "group"))).limit(1);
    if (!role) throw new ValidationError("Choose a group role.");
    if (!subset(role.permissions, ctx.group!.permissions)) throw new AccessDeniedError("subset");
    await db().insert(groupMemberships).values({ userId, roleId, createdById: ctx.user.id }).onConflictDoUpdate({ target: groupMemberships.userId, set: { roleId } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "staff.group_role_set", entityType: "user", entityId: userId, summary: `${target.name} is now ${role.name}`, ip: ctx.ip });
  } else {
    await assertNotLastSuperAdmin(ctx.orgId, userId);
    await db().delete(groupMemberships).where(eq(groupMemberships.userId, userId));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "staff.group_role_removed", entityType: "user", entityId: userId, summary: `Removed ${target.name}'s group role`, ip: ctx.ip });
  }
}

async function assertNotLastSuperAdmin(orgId: string, exceptUserId: string) {
  const [target] = await db().select({ key: roles.key }).from(groupMemberships).innerJoin(roles, eq(roles.id, groupMemberships.roleId)).where(eq(groupMemberships.userId, exceptUserId));
  if (target?.key !== "group_super_admin") return;
  const [{ n }] = await db()
    .select({ n: count() })
    .from(groupMemberships)
    .innerJoin(roles, eq(roles.id, groupMemberships.roleId))
    .innerJoin(users, eq(users.id, groupMemberships.userId))
    .where(and(eq(roles.orgId, orgId), eq(roles.key, "group_super_admin"), eq(users.status, "active"), ne(users.id, exceptUserId)));
  if (n === 0) throw new ValidationError("The organisation needs at least one active Group Super Administrator.");
}

/** Deactivate an account: blocks sign-in and ends every session immediately. */
export async function deactivateUser(ctx: AccessContext, userId: string) {
  ctx.require("staff:manage");
  if (userId === ctx.user.id) throw new AccessDeniedError("self");
  const [target] = await db().select().from(users).where(and(eq(users.id, userId), eq(users.orgId, ctx.orgId))).limit(1);
  if (!target) throw new NotFoundError("Person");
  await assertNotLastSuperAdmin(ctx.orgId, userId);
  const adminOf = await db()
    .select({ firmId: firmMemberships.firmId, id: firmMemberships.id })
    .from(firmMemberships)
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .where(and(eq(firmMemberships.userId, userId), eq(roles.key, "firm_admin")));
  for (const a of adminOf) await assertNotLastAdmin(a.firmId, a.id);
  await db().update(users).set({ status: "deactivated", updatedAt: new Date() }).where(eq(users.id, userId));
  await deleteUserSessions(userId);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "staff.deactivated", entityType: "user", entityId: userId, summary: `Deactivated ${target.name}; sessions ended`, ip: ctx.ip });
}

export async function reactivateUser(ctx: AccessContext, userId: string) {
  ctx.require("staff:manage");
  const [target] = await db().update(users).set({ status: "active", updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.orgId, ctx.orgId), eq(users.status, "deactivated"))).returning();
  if (!target) throw new NotFoundError("Person");
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "staff.reactivated", entityType: "user", entityId: userId, summary: `Reactivated ${target.name}`, ip: ctx.ip });
}

export async function endUserSessions(ctx: AccessContext, userId: string) {
  ctx.require("staff:manage");
  const [target] = await db().select().from(users).where(and(eq(users.id, userId), eq(users.orgId, ctx.orgId))).limit(1);
  if (!target) throw new NotFoundError("Person");
  await deleteUserSessions(userId, userId === ctx.user.id ? (ctx.sessionId ?? undefined) : undefined);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "staff.sessions_ended", entityType: "user", entityId: userId, summary: `Signed ${target.name} out everywhere`, ip: ctx.ip });
}

export async function mySessions(ctx: AccessContext) {
  return db()
    .select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, ip: sessions.ip, userAgent: sessions.userAgent })
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.user.id), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function firmNames(ctx: AccessContext, ids: string[]) {
  if (!ids.length) return [];
  return db().select({ id: firms.id, name: firms.tradingName }).from(firms).where(and(eq(firms.orgId, ctx.orgId), inArray(firms.id, ids)));
}

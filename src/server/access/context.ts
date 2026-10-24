import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type Scope } from "../db/client";
import { firmMemberships, firms, groupMemberships, roles, users } from "../db/schema";
import { AccessDeniedError } from "../errors";
import {
  isFirmPermission,
  isGroupPermission,
  type FirmPermission,
  type GroupPermission,
  type Permission,
} from "./permissions";

export type FirmAccess = {
  firmId: string;
  slug: string;
  tradingName: string;
  refPrefix: string;
  brandColor: string;
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: ReadonlySet<FirmPermission>;
};

export type GroupAccess = {
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: ReadonlySet<GroupPermission>;
};

export type SessionUser = { id: string; orgId: string; email: string; name: string };

/**
 * Who is acting and what they may do, rebuilt from the database on every
 * request so that revoked access takes effect immediately.
 */
export class AccessContext {
  constructor(
    public readonly user: SessionUser,
    public readonly group: GroupAccess | null,
    public readonly firms: ReadonlyMap<string, FirmAccess>,
    public readonly sessionId: string | null = null,
    public readonly ip: string | null = null,
  ) {}

  get orgId() {
    return this.user.orgId;
  }

  has(permission: GroupPermission): boolean;
  has(permission: FirmPermission, firmId: string): boolean;
  has(permission: Permission, firmId?: string): boolean {
    if (isGroupPermission(permission)) return this.group?.permissions.has(permission) ?? false;
    if (!firmId) return false;
    const access = this.firms.get(firmId);
    return access ? access.permissions.has(permission as FirmPermission) : false;
  }

  require(permission: GroupPermission): void;
  require(permission: FirmPermission, firmId: string): void;
  require(permission: Permission, firmId?: string): void {
    const ok = isGroupPermission(permission)
      ? this.has(permission)
      : firmId
        ? this.has(permission as FirmPermission, firmId)
        : false;
    if (!ok) throw new AccessDeniedError(permission);
  }

  /** Throw unless the user holds at least one of the permissions in the firm. */
  requireAny(permissions: FirmPermission[], firmId: string): void {
    if (!permissions.some((p) => this.has(p, firmId))) throw new AccessDeniedError(permissions.join("|"));
  }

  firm(firmId: string): FirmAccess {
    const f = this.firms.get(firmId);
    if (!f) throw new AccessDeniedError("firm");
    return f;
  }

  firmBySlug(slug: string): FirmAccess | undefined {
    for (const f of this.firms.values()) if (f.slug === slug) return f;
    return undefined;
  }

  /** Firm ids where the user holds `permission`. */
  firmIdsWith(permission: FirmPermission): string[] {
    return [...this.firms.values()].filter((f) => f.permissions.has(permission)).map((f) => f.firmId);
  }

  /** Row-level security scope for a transaction touching one firm. */
  scopeFor(firmId: string): Scope {
    this.firm(firmId);
    return { orgId: this.orgId, userId: this.user.id, firmIds: [firmId], matterAdminFirms: this.firmIdsWith("firm:manage").filter((f) => f === firmId) };
  }

  /** Scope across every firm the user belongs to (for search). */
  scopeForAllFirms(): Scope {
    return { orgId: this.orgId, userId: this.user.id, firmIds: [...this.firms.keys()], matterAdminFirms: this.firmIdsWith("firm:manage") };
  }
}

/** Load a user's memberships and build their access context. */
export async function loadAccessContext(
  userId: string,
  opts: { sessionId?: string | null; ip?: string | null } = {},
): Promise<AccessContext | null> {
  const [user] = await db()
    .select({ id: users.id, orgId: users.orgId, email: users.email, name: users.name, status: users.status, kind: users.kind })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.status !== "active" || user.kind !== "staff") return null;

  const [groupRow] = await db()
    .select({ roleId: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions, scope: roles.scope })
    .from(groupMemberships)
    .innerJoin(roles, eq(roles.id, groupMemberships.roleId))
    .where(eq(groupMemberships.userId, userId))
    .limit(1);

  const group: GroupAccess | null =
    groupRow && groupRow.scope === "group"
      ? {
          roleId: groupRow.roleId,
          roleKey: groupRow.key,
          roleName: groupRow.name,
          permissions: new Set(groupRow.permissions.filter(isGroupPermission)),
        }
      : null;

  const firmRows = await db()
    .select({
      membershipId: firmMemberships.id,
      firmId: firms.id,
      slug: firms.slug,
      tradingName: firms.tradingName,
      refPrefix: firms.refPrefix,
      brandColor: firms.brandColor,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      roleScope: roles.scope,
      permissions: roles.permissions,
    })
    .from(firmMemberships)
    .innerJoin(firms, eq(firms.id, firmMemberships.firmId))
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .where(
      and(eq(firmMemberships.userId, userId), eq(firmMemberships.status, "active"), eq(firms.status, "active"), eq(firms.orgId, user.orgId)),
    );

  const firmMap = new Map<string, FirmAccess>();
  for (const r of firmRows) {
    if (r.roleScope !== "firm") continue;
    firmMap.set(r.firmId, {
      firmId: r.firmId,
      slug: r.slug,
      tradingName: r.tradingName,
      refPrefix: r.refPrefix,
      brandColor: r.brandColor,
      membershipId: r.membershipId,
      roleId: r.roleId,
      roleKey: r.roleKey,
      roleName: r.roleName,
      permissions: new Set(r.permissions.filter(isFirmPermission)),
    });
  }

  return new AccessContext(
    { id: user.id, orgId: user.orgId, email: user.email, name: user.name },
    group,
    firmMap,
    opts.sessionId ?? null,
    opts.ip ?? null,
  );
}

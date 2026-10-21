import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { firms, roles } from "../db/schema";
import { AccessDeniedError } from "../errors";
import type { AccessContext } from "./context";

type Role = typeof roles.$inferSelect;

const subset = (needed: readonly string[], held: ReadonlySet<string>) => needed.every((p) => held.has(p));

/**
 * How the caller may administer a firm's team, if at all:
 * - "firm": they hold the team permission inside the firm (subset rule applies);
 * - "group": they are a Hub staff manager AND the firm's own policy lets Hub
 *   administrators act in it (allowGroupAdminAccess);
 * - null: no access.
 * A group role alone never reaches into a firm that hasn't opted in.
 */
export async function firmTeamAuthority(ctx: AccessContext, firmId: string, permission: "team:invite" | "team:manage"): Promise<"firm" | "group" | null> {
  if (ctx.has(permission, firmId)) return "firm";
  if (!ctx.has("staff:manage")) return null;
  const [firm] = await db().select({ allow: firms.allowGroupAdminAccess }).from(firms).where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId))).limit(1);
  return firm?.allow ? "group" : null;
}

/** Throw unless the caller may grant `role` (in `firmId` for firm roles). */
export async function assertCanGrantRole(ctx: AccessContext, role: Role, firmId: string | null) {
  if (role.orgId !== ctx.orgId) throw new AccessDeniedError("role");
  if (role.scope === "group") {
    if (firmId) throw new AccessDeniedError("scope");
    ctx.require("staff:invite");
    if (!subset(role.permissions, ctx.group!.permissions)) throw new AccessDeniedError("subset");
    return;
  }
  if (role.scope !== "firm" || !firmId) throw new AccessDeniedError("scope");
  const authority = await firmTeamAuthority(ctx, firmId, "team:invite");
  if (authority === "firm" && subset(role.permissions, ctx.firm(firmId).permissions)) return;
  if (authority === "group") return;
  throw new AccessDeniedError("team:invite");
}

/** For changing or removing an existing member: the caller must outrank both the current and the new role. */
export async function assertCanManageMember(ctx: AccessContext, firmId: string, currentRolePermissions: readonly string[], newRole?: Role) {
  const authority = await firmTeamAuthority(ctx, firmId, "team:manage");
  if (!authority) throw new AccessDeniedError("team:manage");
  if (authority === "group") return;
  const held = ctx.firm(firmId).permissions;
  if (!subset(currentRolePermissions, held)) throw new AccessDeniedError("subset");
  if (newRole && !subset(newRole.permissions, held)) throw new AccessDeniedError("subset");
}

export { subset as permissionsSubset };

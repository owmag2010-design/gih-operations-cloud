import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { withScope } from "../../db/client";
import { auditEvents, firms, users } from "../../db/schema";
import { AccessDeniedError } from "../../errors";

/** Organisation audit log (audit:view) or one firm's log (audit:firm). Paged by id. */
export async function listAuditEvents(ctx: AccessContext, opts: { firmId?: string; before?: number; action?: string } = {}) {
  let scope;
  if (opts.firmId && ctx.has("audit:firm", opts.firmId)) {
    scope = { orgId: ctx.orgId, userId: ctx.user.id, firmIds: [opts.firmId], auditScope: "firm" as const };
  } else if (ctx.has("audit:view")) {
    scope = { orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], auditScope: "org" as const };
  } else {
    throw new AccessDeniedError("audit:view");
  }
  return withScope(scope, (tx) =>
    tx
      .select({
        id: auditEvents.id, action: auditEvents.action, summary: auditEvents.summary, entityType: auditEvents.entityType, entityId: auditEvents.entityId,
        createdAt: auditEvents.createdAt, ip: auditEvents.ip, actorName: users.name, firmName: firms.tradingName,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(firms, eq(firms.id, auditEvents.firmId))
      .where(
        and(
          opts.firmId ? eq(auditEvents.firmId, opts.firmId) : undefined,
          opts.before ? lt(auditEvents.id, opts.before) : undefined,
          opts.action ? eq(auditEvents.action, opts.action) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.id))
      .limit(100),
  );
}

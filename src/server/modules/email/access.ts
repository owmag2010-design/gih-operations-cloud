import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { withScope, type Scope, type Tx } from "../../db/client";
import { firms, mailboxMembers, mailboxes, mailConnections } from "../../db/schema";
import { AccessDeniedError } from "../../errors";

/**
 * Who may read and send from which inbox.
 *
 * - Hub inbox (firm_id null): Hub staff with intake:view read; hub_email:send sends.
 * - A practice's inboxes: members with email:view read; email:send sends.
 * - A personal mailbox: only its owner and the people the owner adds, even
 *   inside the same practice. The database enforces this too
 *   (email_mailbox_visible in drizzle/0013).
 */

export function canViewInbox(ctx: AccessContext, firmId: string | null) {
  return firmId ? ctx.has("email:view", firmId) : ctx.has("intake:view");
}

export function canSendInbox(ctx: AccessContext, firmId: string | null) {
  return firmId ? ctx.has("email:send", firmId) : ctx.has("hub_email:send");
}

/** Firms whose inboxes this user can read, and whether they can read the Hub's. */
export function inboxReach(ctx: AccessContext) {
  const firmIds = [...ctx.firms.values()].filter((f) => f.permissions.has("email:view")).map((f) => f.firmId);
  return { firmIds, hub: ctx.has("intake:view") };
}

/** One transaction scope covering every inbox the user can read. */
export function inboxScope(ctx: AccessContext): Scope {
  const r = inboxReach(ctx);
  return { orgId: ctx.orgId, userId: ctx.user.id, firmIds: r.firmIds, intake: r.hub };
}

export function scopeForFirm(ctx: AccessContext, firmId: string | null): Scope {
  return firmId ? ctx.scopeFor(firmId) : { orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true };
}

export function requireViewInbox(ctx: AccessContext, firmId: string | null) {
  if (!canViewInbox(ctx, firmId)) throw new AccessDeniedError(firmId ? "email:view" : "intake:view");
}

export function requireSendInbox(ctx: AccessContext, firmId: string | null) {
  if (!canSendInbox(ctx, firmId)) throw new AccessDeniedError(firmId ? "email:send" : "hub_email:send");
}

/** May this user manage (connect, configure) a mailbox? */
export function canManageMailbox(ctx: AccessContext, m: { firmId: string | null; kind: "shared" | "personal"; ownerUserId: string | null }) {
  if (m.kind === "personal") return m.ownerUserId === ctx.user.id;
  if (ctx.has("mailboxes:manage")) return true;
  return m.firmId ? ctx.has("firm:manage", m.firmId) : false;
}

export type MailboxRow = typeof mailboxes.$inferSelect & {
  firmName: string | null;
  firmSlug: string | null;
  connectionStatus: string | null;
  accountEmail: string | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  canSend: boolean;
};

/** Mailboxes this user can see, with whether they may send from each. */
export async function visibleMailboxes(ctx: AccessContext, opts: { sendable?: boolean; tx?: Tx } = {}): Promise<MailboxRow[]> {
  const reach = inboxReach(ctx);
  const run = async (tx: Tx) => {
    const memberRows = await tx.select({ mailboxId: mailboxMembers.mailboxId, canSend: mailboxMembers.canSend }).from(mailboxMembers).where(eq(mailboxMembers.userId, ctx.user.id));
    const memberOf = new Map(memberRows.map((r) => [r.mailboxId, r.canSend]));
    const scopeCond = or(
      reach.firmIds.length ? inArray(mailboxes.firmId, reach.firmIds) : sql`false`,
      reach.hub ? isNull(mailboxes.firmId) : sql`false`,
      eq(mailboxes.ownerUserId, ctx.user.id),
      memberOf.size ? inArray(mailboxes.id, [...memberOf.keys()]) : sql`false`,
    )!;
    const rows = await tx
      .select({ m: mailboxes, firmName: firms.tradingName, firmSlug: firms.slug, c: { status: mailConnections.status, accountEmail: mailConnections.accountEmail, lastSuccessAt: mailConnections.lastSuccessAt, lastError: mailConnections.lastError } })
      .from(mailboxes)
      .leftJoin(firms, eq(firms.id, mailboxes.firmId))
      .leftJoin(mailConnections, eq(mailConnections.mailboxId, mailboxes.id))
      .where(and(eq(mailboxes.orgId, ctx.orgId), eq(mailboxes.isActive, true), scopeCond))
      .orderBy(asc(firms.tradingName), asc(mailboxes.kind), asc(mailboxes.label));
    return rows
      .filter(({ m }) => m.kind === "shared" || m.ownerUserId === ctx.user.id || memberOf.has(m.id))
      .map(({ m, firmName, firmSlug, c }) => {
        const owner = m.kind === "personal" && m.ownerUserId === ctx.user.id;
        const canSend = m.kind === "personal" ? owner || memberOf.get(m.id) === true : canSendInbox(ctx, m.firmId);
        return { ...m, firmName, firmSlug, connectionStatus: c?.status ?? null, accountEmail: c?.accountEmail ?? null, lastSuccessAt: c?.lastSuccessAt ?? null, lastError: c?.lastError ?? null, canSend };
      })
      .filter((m) => !opts.sendable || m.canSend);
  };
  if (opts.tx) return run(opts.tx);
  return withScope(inboxScope(ctx), run);
}

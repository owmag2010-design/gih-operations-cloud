import "server-only";
import { sql } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { withScope, type Scope } from "../../db/client";

/**
 * Conversations with prospective clients, read from the Hub enquiry engine
 * (WhatsApp, email, enquiry forms and website chat). Read-only: the engine
 * still answers clients and staff still reply from the engine dashboard until
 * replying moves here.
 *
 * Access: practice conversations need `leads:view_all` in that practice; Hub
 * conversations that no practice has been matched to need `intake:view`. The
 * database views in `ops_engine` enforce the same scope (migration 0025).
 */

export const QUEUES = ["all", "needs_reply", "handling", "proposal", "paid", "whatsapp", "email", "forms", "chat", "hub"] as const;
export type Queue = (typeof QUEUES)[number];

export type ConversationFilters = { queue?: Queue; firmId?: string; q?: string; tests?: boolean };

export type ConversationRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  firstChannel: string;
  status: string;
  matter: string | null;
  isTest: boolean;
  firmId: string | null;
  firmName: string | null;
  siteSource: string | null;
  proposalSlug: string | null;
  proposalStatus: string | null;
  proposalRef: string | null;
  humanUntil: Date | null;
  paused: boolean;
  lastChannel: string | null;
  lastDirection: string | null;
  lastBody: string | null;
  lastAt: Date | null;
  chatLastSeen: Date | null;
  createdAt: Date;
  /** A person is replying (the engine stays quiet) or Owen paused the engine for this client. */
  teamHandling: boolean;
  /** The visitor's chat window was open in the last two minutes. */
  onWebsiteNow: boolean;
};

export type ConversationMessage = {
  id: string;
  createdAt: Date;
  channel: string;
  direction: "in" | "out";
  body: string;
  delivery: string | null;
  skippedReason: string | null;
  /** Who wrote an outgoing message: the engine, or a person on the team. */
  author: "client" | "engine" | "team";
  failed: boolean;
};

export type ConversationProposal = {
  slug: string;
  status: string;
  ref: string | null;
  matter: string | null;
  firm: string | null;
  currency: string;
  depositPct: number;
  core: number;
  note: string | null;
  createdAt: Date;
};

export type ConversationDetail = {
  conversation: ConversationRow;
  messages: ConversationMessage[];
  proposals: ConversationProposal[];
  instructions: Record<string, unknown>;
  whatsappOpenUntil: Date | null;
};

/** Practices whose conversations this person may read, and whether they see Hub ones. */
export function conversationReach(ctx: AccessContext) {
  return { firmIds: ctx.firmIdsWith("leads:view_all"), hub: ctx.has("intake:view") };
}

export function canViewConversations(ctx: AccessContext) {
  const r = conversationReach(ctx);
  return r.hub || r.firmIds.length > 0;
}

function scope(ctx: AccessContext, firmId?: string): Scope {
  const reach = conversationReach(ctx);
  const firmIds = firmId ? reach.firmIds.filter((f) => f === firmId) : reach.firmIds;
  return { orgId: ctx.orgId, userId: ctx.user.id, firmIds, intake: firmId ? false : reach.hub };
}

type Raw = Record<string, unknown>;
const date = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const str = (v: unknown) => (v == null ? null : String(v));

function toRow(r: Raw): ConversationRow {
  const ins = (r.instructions ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    firstChannel: String(r.first_channel ?? ""),
    status: String(r.status ?? "new"),
    matter: str(r.matter),
    isTest: r.is_test === true,
    firmId: str(r.firm_id),
    firmName: str(r.firm_name),
    siteSource: str(r.site_source),
    proposalSlug: str(r.proposal_slug),
    proposalStatus: str(r.proposal_status),
    proposalRef: str(r.proposal_ref),
    humanUntil: date(r.human_until),
    paused: ins.pause === true,
    lastChannel: str(r.last_channel),
    lastDirection: str(r.last_direction),
    lastBody: str(r.last_body),
    lastAt: date(r.last_at),
    chatLastSeen: date(r.chat_last_seen),
    createdAt: date(r.created_at) ?? new Date(0),
    teamHandling: ins.pause === true || (date(r.human_until)?.getTime() ?? 0) > Date.now(),
    onWebsiteNow: Date.now() - (date(r.chat_last_seen)?.getTime() ?? 0) < 120_000,
  };
}

/** The filter for each queue, as SQL against ops_engine.leads. */
function queueWhere(queue: Queue) {
  switch (queue) {
    case "needs_reply":
      return sql`last_direction = 'in'`;
    case "handling":
      return sql`(human_until > now() or coalesce((instructions->>'pause')::boolean, false))`;
    case "proposal":
      return sql`status in ('proposal_sent', 'awaiting_approval', 'accepted')`;
    case "paid":
      return sql`status in ('paid', 'existing_client')`;
    case "whatsapp":
      return sql`first_channel = 'whatsapp'`;
    case "email":
      return sql`first_channel = 'email'`;
    case "forms":
      return sql`first_channel in ('tally', 'website')`;
    case "chat":
      return sql`first_channel = 'webchat'`;
    case "hub":
      return sql`firm_id is null`;
    default:
      return sql`true`;
  }
}

export async function listConversations(ctx: AccessContext, f: ConversationFilters = {}): Promise<ConversationRow[]> {
  if (!canViewConversations(ctx)) return [];
  if (f.firmId && !conversationReach(ctx).firmIds.includes(f.firmId)) return [];
  const q = f.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return withScope(scope(ctx, f.firmId), async (tx) => {
    const res = await tx.execute(sql`
      select * from ops_engine.leads
      where ${queueWhere(f.queue ?? "all")}
        ${f.tests ? sql`` : sql`and not is_test`}
        ${like ? sql`and (name ilike ${like} or email ilike ${like} or phone ilike ${like} or matter ilike ${like} or proposal_ref ilike ${like})` : sql``}
      order by coalesce(last_at, last_message_at, created_at) desc
      limit 200`);
    return (res.rows as Raw[]).map(toRow);
  });
}

/** How many conversations sit in each queue (tests excluded unless asked for). */
export async function queueCounts(ctx: AccessContext, f: Pick<ConversationFilters, "firmId" | "tests"> = {}): Promise<Record<Queue, number>> {
  const empty = Object.fromEntries(QUEUES.map((k) => [k, 0])) as Record<Queue, number>;
  if (!canViewConversations(ctx)) return empty;
  if (f.firmId && !conversationReach(ctx).firmIds.includes(f.firmId)) return empty;
  return withScope(scope(ctx, f.firmId), async (tx) => {
    const res = await tx.execute(sql`
      select
        count(*)::int as "all",
        count(*) filter (where last_direction = 'in')::int as needs_reply,
        count(*) filter (where human_until > now() or coalesce((instructions->>'pause')::boolean, false))::int as handling,
        count(*) filter (where status in ('proposal_sent', 'awaiting_approval', 'accepted'))::int as proposal,
        count(*) filter (where status in ('paid', 'existing_client'))::int as paid,
        count(*) filter (where first_channel = 'whatsapp')::int as whatsapp,
        count(*) filter (where first_channel = 'email')::int as email,
        count(*) filter (where first_channel in ('tally', 'website'))::int as forms,
        count(*) filter (where first_channel = 'webchat')::int as chat,
        count(*) filter (where firm_id is null)::int as hub
      from ops_engine.leads ${f.tests ? sql`` : sql`where not is_test`}`);
    return { ...empty, ...((res.rows[0] ?? {}) as Record<Queue, number>) };
  });
}

function author(m: Raw): ConversationMessage["author"] {
  if (m.direction === "in") return "client";
  const delivery = String(m.delivery ?? "");
  return m.sent_by === "owen" || delivery.includes(":owen") ? "team" : "engine";
}

export async function getConversation(ctx: AccessContext, id: string): Promise<ConversationDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !canViewConversations(ctx)) return null;
  return withScope(scope(ctx), async (tx) => {
    const lead = (await tx.execute(sql`select * from ops_engine.leads where id = ${id}`)).rows[0] as Raw | undefined;
    if (!lead) return null;
    const msgs = (await tx.execute(sql`
      select * from (select * from ops_engine.messages where lead_id = ${id} order by created_at desc limit 400) t
      order by created_at`)).rows as Raw[];
    const props = (await tx.execute(sql`select * from ops_engine.proposals where lead_id = ${id} order by created_at desc`)).rows as Raw[];
    const lastWhatsappIn = msgs.filter((m) => m.channel === "whatsapp" && m.direction === "in").at(-1);
    const until = lastWhatsappIn ? new Date(date(lastWhatsappIn.created_at)!.getTime() + 24 * 3600_000) : null;
    return {
      conversation: toRow(lead),
      instructions: (lead.instructions ?? {}) as Record<string, unknown>,
      whatsappOpenUntil: until && until.getTime() > Date.now() ? until : null,
      messages: msgs.map((m) => ({
        id: String(m.id),
        createdAt: date(m.created_at)!,
        channel: String(m.channel ?? ""),
        direction: m.direction === "in" ? "in" : "out",
        body: String(m.body ?? ""),
        delivery: str(m.delivery),
        skippedReason: str(m.skipped_reason),
        author: author(m),
        failed: m.direction === "out" && /failed|not_sent/.test(String(m.delivery ?? "")),
      })),
      proposals: props.map((p) => ({
        slug: String(p.slug),
        status: String(p.status ?? ""),
        ref: str(p.ref),
        matter: str(p.matter),
        firm: str(p.firm),
        currency: String(p.currency ?? "zar"),
        depositPct: Number(p.deposit_pct ?? 50),
        core: Number(p.core ?? 0),
        note: str(p.note),
        createdAt: date(p.created_at)!,
      })),
    };
  });
}

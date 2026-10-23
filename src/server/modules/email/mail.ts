import "server-only";
import { and, asc, desc, eq, gte, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { db, withScope, type Scope, type Tx } from "../../db/client";
import {
  activities,
  clients,
  emailMessages,
  emailTemplates,
  emailThreads,
  firms,
  leads,
  mailboxes,
  organisations,
  users,
  type EmailBlock,
} from "../../db/schema";
import { env } from "../../env";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { resendGetReceived, resendSend, type ReceivedEmail } from "../../integrations/resend";
import { parseOrThrow } from "../../validation";
import { storeIntake } from "../intake/intake";
import { brandFor, plainBlocks, renderEmail, type MergeValues } from "./render";

/** Where a mailbox, thread or template lives: a firm, or the Hub itself. */
export type EmailScope = { kind: "firm"; firmId: string } | { kind: "hub" };

const uuid = z.string().uuid();
const isUuid = (s: string) => uuid.safeParse(s).success;

function scopeOf(ctx: AccessContext, where: EmailScope): Scope {
  return where.kind === "firm" ? ctx.scopeFor(where.firmId) : { orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true };
}

function requireView(ctx: AccessContext, where: EmailScope) {
  if (where.kind === "firm") ctx.require("email:view", where.firmId);
  else ctx.require("intake:view");
}
function requireSend(ctx: AccessContext, where: EmailScope) {
  if (where.kind === "firm") ctx.require("email:send", where.firmId);
  else ctx.require("hub_email:send");
}
const firmCond = (col: typeof emailThreads.firmId, where: EmailScope) => (where.kind === "firm" ? eq(col, where.firmId) : isNull(col));

/* ───────────────────────── Addresses ───────────────────────── */

/** `veritas@in.thegih.com` + thread id → `veritas+t<32 hex>@in.thegih.com`, so replies find their thread. */
export function threadReplyAddress(inbound: string, threadId: string) {
  const [local, domain] = inbound.split("@");
  return `${local}+t${threadId.replace(/-/g, "")}@${domain}`;
}

export function parseRecipient(address: string): { base: string; threadId: string | null } {
  const m = address.trim().toLowerCase().match(/^([^@+\s]+)(?:\+t([0-9a-f]{32}))?(?:\+[^@]*)?@([^@\s]+)$/);
  if (!m) return { base: address.trim().toLowerCase(), threadId: null };
  const hex = m[2];
  const threadId = hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null;
  return { base: `${m[1]}@${m[3]}`, threadId };
}

/** "Thandi Test <thandi@example.com>" → parts. */
export function parseAddress(raw: string): { email: string; name: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

const fromHeader = (name: string, address: string) => `${name.replace(/[<>"\r\n]/g, "")} <${address}>`;

/* ───────────────────────── Mailboxes ───────────────────────── */

const mailboxSchema = z.object({
  firmId: z.string().optional().transform((v) => (v ? v : null)).refine((v) => v === null || isUuid(v), "Choose a firm."),
  label: z.string().trim().min(2, "Name the mailbox.").max(80),
  inboundAddress: z.string().trim().toLowerCase().email("Enter the receiving address.").refine((v) => !v.includes("+"), "Don't use + in the receiving address."),
  forwardedFrom: z.string().trim().max(200).optional().transform((v) => v || null),
  fromName: z.string().trim().min(2, "Enter the name clients see.").max(80),
  fromAddress: z.string().trim().toLowerCase().email("Enter the sending address."),
  signature: z.string().trim().max(1000).optional().transform((v) => v || null),
  isActive: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on"),
});

export async function listMailboxes(ctx: AccessContext) {
  if (!ctx.has("mailboxes:manage") && !ctx.has("intake:view")) throw new AccessDeniedError("mailboxes:manage");
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] }, (tx) =>
    tx
      .select({ mailbox: mailboxes, firmName: firms.tradingName })
      .from(mailboxes)
      .leftJoin(firms, eq(firms.id, mailboxes.firmId))
      .where(eq(mailboxes.orgId, ctx.orgId))
      .orderBy(asc(firms.tradingName), asc(mailboxes.label)),
  );
}

export async function saveMailbox(ctx: AccessContext, id: string | null, raw: unknown) {
  ctx.require("mailboxes:manage");
  const input = parseOrThrow(mailboxSchema, raw);
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] }, async (tx) => {
    if (input.firmId) {
      const [f] = await tx.select({ id: firms.id }).from(firms).where(and(eq(firms.id, input.firmId), eq(firms.orgId, ctx.orgId)));
      if (!f) throw new ValidationError("Choose a firm.", { firmId: "Choose a firm." });
    }
    const [clash] = await tx.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.inboundAddress, input.inboundAddress));
    if (clash && clash.id !== id) throw new ValidationError("Another mailbox already uses that receiving address.", { inboundAddress: "Already in use." });
    const values = { ...input, orgId: ctx.orgId, updatedAt: new Date() };
    let row;
    if (id) {
      if (!isUuid(id)) throw new NotFoundError("Mailbox");
      [row] = await tx.update(mailboxes).set(values).where(and(eq(mailboxes.id, id), eq(mailboxes.orgId, ctx.orgId))).returning();
      if (!row) throw new NotFoundError("Mailbox");
    } else {
      [row] = await tx.insert(mailboxes).values(values).returning();
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: row.firmId, action: id ? "mailbox.updated" : "mailbox.created", entityType: "mailbox", entityId: row.id, summary: `${id ? "Updated" : "Added"} mailbox ${row.inboundAddress}`, ip: ctx.ip }, tx);
    return row;
  });
}

async function mailboxFor(tx: Tx, orgId: string, where: EmailScope) {
  const [m] = await tx
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.orgId, orgId), where.kind === "firm" ? eq(mailboxes.firmId, where.firmId) : isNull(mailboxes.firmId), eq(mailboxes.isActive, true)))
    .orderBy(asc(mailboxes.createdAt))
    .limit(1);
  return m ?? null;
}

/* ───────────────────────── Templates ───────────────────────── */

const blockSchema: z.ZodType<EmailBlock> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("paragraph"), text: z.string().trim().min(1).max(5000) }),
  z.object({ type: z.literal("button"), label: z.string().trim().min(1).max(60), url: z.string().trim().min(4).max(500) }),
  z.object({ type: z.literal("details"), rows: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(300) })).min(1).max(15) }),
  z.object({ type: z.literal("notice"), text: z.string().trim().min(1).max(1000) }),
  z.object({ type: z.literal("divider") }),
]);

const templateSchema = z.object({
  name: z.string().trim().min(2, "Name the template.").max(120),
  category: z.string().trim().min(1).max(60).default("General"),
  subject: z.string().trim().min(2, "Write a subject line.").max(200),
  preheader: z.string().trim().max(200).optional().transform((v) => v || null),
  blocks: z.array(blockSchema).min(1, "Add at least one block.").max(40),
  isActive: z.boolean().default(true),
});

function requireTemplates(ctx: AccessContext, where: EmailScope) {
  if (where.kind === "firm") ctx.require("templates:manage", where.firmId);
  else ctx.require("hub_templates:manage");
}

/** Templates usable in a scope. Firms also see the Hub's shared templates. */
export async function listTemplates(ctx: AccessContext, where: EmailScope, opts: { includeHub?: boolean; activeOnly?: boolean } = {}) {
  if (where.kind === "firm") ctx.requireAny(["email:view", "templates:manage"], where.firmId);
  else if (!ctx.has("hub_templates:manage") && !ctx.has("intake:view")) throw new AccessDeniedError("hub_templates:manage");
  return withScope(scopeOf(ctx, where), (tx) => {
    const own = where.kind === "firm" ? eq(emailTemplates.firmId, where.firmId) : isNull(emailTemplates.firmId);
    const scope = where.kind === "firm" && opts.includeHub ? or(own, isNull(emailTemplates.firmId))! : own;
    return tx
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.orgId, ctx.orgId), scope, opts.activeOnly ? eq(emailTemplates.isActive, true) : undefined))
      .orderBy(asc(emailTemplates.category), asc(emailTemplates.name));
  });
}

export async function getTemplate(ctx: AccessContext, where: EmailScope, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Template");
  const rows = await listTemplates(ctx, where, { includeHub: true });
  const t = rows.find((r) => r.id === id);
  if (!t) throw new NotFoundError("Template");
  return t;
}

export async function saveTemplate(ctx: AccessContext, where: EmailScope, id: string | null, raw: unknown) {
  requireTemplates(ctx, where);
  const input = parseOrThrow(templateSchema, raw);
  return withScope(scopeOf(ctx, where), async (tx) => {
    const firmId = where.kind === "firm" ? where.firmId : null;
    let row;
    if (id) {
      if (!isUuid(id)) throw new NotFoundError("Template");
      [row] = await tx
        .update(emailTemplates)
        .set({ ...input, version: sql`${emailTemplates.version} + 1`, updatedById: ctx.user.id, updatedAt: new Date() })
        .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, ctx.orgId), firmId ? eq(emailTemplates.firmId, firmId) : isNull(emailTemplates.firmId)))
        .returning();
      if (!row) throw new NotFoundError("Template");
    } else {
      [row] = await tx.insert(emailTemplates).values({ ...input, orgId: ctx.orgId, firmId, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: id ? "email_template.updated" : "email_template.created", entityType: "email_template", entityId: row.id, summary: `${id ? "Updated" : "Created"} template “${row.name}”`, ip: ctx.ip }, tx);
    return row;
  });
}

/* ───────────────────────── Rendering for a recipient ───────────────────────── */

type Recipient = { email: string; name: string; firstName: string; reference: string | null; leadId: string | null; clientId: string | null };

async function brandAndFirm(tx: Tx, where: EmailScope) {
  if (where.kind === "hub") return { brand: brandFor(null, env().APP_URL), firmName: "Global Immigration Hub" };
  const [f] = await tx.select({ slug: firms.slug, tradingName: firms.tradingName, brandColor: firms.brandColor }).from(firms).where(eq(firms.id, where.firmId));
  return { brand: brandFor(f, env().APP_URL), firmName: f.tradingName };
}

function values(r: Recipient, firmName: string, sender: { name: string; email: string }): MergeValues {
  return {
    first_name: r.firstName,
    full_name: r.name,
    email: r.email,
    reference: r.reference ?? "",
    firm_name: firmName,
    sender_name: sender.name,
    sender_email: sender.email,
    today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  };
}

const composeSchema = z.object({
  templateId: z.string().optional().transform((v) => v || null),
  subject: z.string().trim().max(200).optional().transform((v) => v || null),
  body: z.string().trim().max(20000).optional().transform((v) => v || null),
  cc: z.string().trim().max(500).optional().transform((v) => (v ? v.split(/[,;\s]+/).filter(Boolean) : [])),
});

async function loadRecipient(tx: Tx, firmId: string, target: { leadId?: string; clientId?: string }): Promise<Recipient> {
  if (target.leadId) {
    if (!isUuid(target.leadId)) throw new NotFoundError("Lead");
    const [l] = await tx.select().from(leads).where(and(eq(leads.id, target.leadId), eq(leads.firmId, firmId), isNull(leads.deletedAt)));
    if (!l) throw new NotFoundError("Lead");
    if (!l.email) throw new ValidationError("This lead has no email address. Add one first.");
    return { email: l.email, name: [l.firstName, l.lastName].filter(Boolean).join(" "), firstName: l.firstName, reference: l.ref, leadId: l.id, clientId: null };
  }
  if (target.clientId) {
    if (!isUuid(target.clientId)) throw new NotFoundError("Client");
    const [c] = await tx.select().from(clients).where(and(eq(clients.id, target.clientId), eq(clients.firmId, firmId), isNull(clients.deletedAt)));
    if (!c) throw new NotFoundError("Client");
    if (!c.email) throw new ValidationError("This client has no email address. Add one first.");
    return { email: c.email, name: [c.firstName, c.lastName].filter(Boolean).join(" "), firstName: c.firstName, reference: c.ref, leadId: null, clientId: c.id };
  }
  throw new ValidationError("Choose who to email.");
}

async function buildMessage(tx: Tx, ctx: AccessContext, where: EmailScope, recipient: Recipient, input: z.infer<typeof composeSchema>, mailbox: typeof mailboxes.$inferSelect) {
  const { brand, firmName } = await brandAndFirm(tx, where);
  let subject: string;
  let blocks: EmailBlock[];
  let preheader: string | null = null;
  let templateId: string | null = null;
  if (input.templateId) {
    if (!isUuid(input.templateId)) throw new NotFoundError("Template");
    const own = where.kind === "firm" ? eq(emailTemplates.firmId, where.firmId) : isNull(emailTemplates.firmId);
    const [t] = await tx.select().from(emailTemplates).where(and(eq(emailTemplates.id, input.templateId), eq(emailTemplates.orgId, ctx.orgId), or(own, isNull(emailTemplates.firmId)), eq(emailTemplates.isActive, true)));
    if (!t) throw new NotFoundError("Template");
    subject = input.subject ?? t.subject;
    blocks = input.body ? [...t.blocks.slice(0, 1), ...plainBlocks(input.body), ...t.blocks.slice(1)] : t.blocks;
    preheader = t.preheader;
    templateId = t.id;
  } else {
    if (!input.subject) throw new ValidationError("Write a subject line.", { subject: "Write a subject line." });
    if (!input.body) throw new ValidationError("Write a message.", { body: "Write a message." });
    subject = input.subject;
    blocks = plainBlocks(input.body);
  }
  const sender = { name: ctx.user.name, email: mailbox.fromAddress };
  const rendered = renderEmail({ brand, subject, preheader, blocks, signature: mailbox.signature ?? `${ctx.user.name}\n${firmName}`, values: values(recipient, firmName, sender), reference: recipient.reference });
  return { ...rendered, templateId };
}

/* ───────────────────────── Sending ───────────────────────── */

async function deliver(ctx: AccessContext, where: EmailScope, messageId: string, send: Parameters<typeof resendSend>[0]) {
  const result = await resendSend({ ...send, idempotencyKey: messageId });
  await withScope(scopeOf(ctx, where), (tx) =>
    tx
      .update(emailMessages)
      .set(result.status === "sent" ? { status: "sent", providerId: result.id } : result.status === "failed" ? { status: "failed", error: result.error } : { status: "not_configured" })
      .where(eq(emailMessages.id, messageId)),
  );
  return result;
}

/** Email a lead or client of a firm, from that firm's mailbox. Logged on their timeline. */
export async function sendToRecord(ctx: AccessContext, firmId: string, target: { leadId?: string; clientId?: string }, raw: unknown) {
  const where: EmailScope = { kind: "firm", firmId };
  requireSend(ctx, where);
  const input = parseOrThrow(composeSchema, raw);
  const prepared = await withScope(ctx.scopeFor(firmId), async (tx) => {
    const mailbox = await mailboxFor(tx, ctx.orgId, where);
    if (!mailbox) throw new ValidationError("This firm has no sending mailbox yet. A Hub administrator can add one under Hub › Email settings.");
    const recipient = await loadRecipient(tx, firmId, target);
    const msg = await buildMessage(tx, ctx, where, recipient, input, mailbox);
    const [thread] = await tx
      .insert(emailThreads)
      .values({ orgId: ctx.orgId, firmId, mailboxId: mailbox.id, subject: msg.subject, counterpartEmail: recipient.email, counterpartName: recipient.name, leadId: recipient.leadId, clientId: recipient.clientId, assignedToId: ctx.user.id })
      .returning();
    const [message] = await tx
      .insert(emailMessages)
      .values({
        orgId: ctx.orgId, firmId, threadId: thread.id, direction: "outbound", status: "queued", fromAddress: mailbox.fromAddress, fromName: mailbox.fromName,
        toAddresses: [recipient.email], ccAddresses: input.cc, subject: msg.subject, textBody: msg.text, htmlBody: msg.html, templateId: msg.templateId, sentById: ctx.user.id,
      })
      .returning();
    await tx.insert(activities).values({ firmId, leadId: recipient.leadId, clientId: recipient.clientId, type: "email", body: msg.subject, actorId: ctx.user.id, data: { threadId: thread.id, direction: "outbound" } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "email.sent", entityType: "email_thread", entityId: thread.id, summary: `Emailed ${recipient.reference ?? "a contact"}`, data: { templateId: msg.templateId }, ip: ctx.ip }, tx);
    return { thread, message, mailbox, recipient, msg };
  });
  const result = await deliver(ctx, where, prepared.message.id, {
    from: fromHeader(prepared.mailbox.fromName, prepared.mailbox.fromAddress),
    to: [prepared.recipient.email],
    cc: input.cc,
    replyTo: threadReplyAddress(prepared.mailbox.inboundAddress, prepared.thread.id),
    subject: prepared.msg.subject,
    html: prepared.msg.html,
    text: prepared.msg.text,
  });
  return { threadId: prepared.thread.id, status: result.status };
}

/** Reply in an existing thread (firm or Hub). */
export async function replyToThread(ctx: AccessContext, where: EmailScope, threadId: string, raw: unknown) {
  requireSend(ctx, where);
  if (!isUuid(threadId)) throw new NotFoundError("Conversation");
  const input = parseOrThrow(composeSchema, raw);
  const prepared = await withScope(scopeOf(ctx, where), async (tx) => {
    const [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.orgId, ctx.orgId), firmCond(emailThreads.firmId, where))).for("update");
    if (!thread) throw new NotFoundError("Conversation");
    const mailbox = (thread.mailboxId ? (await tx.select().from(mailboxes).where(eq(mailboxes.id, thread.mailboxId)))[0] : null) ?? (await mailboxFor(tx, ctx.orgId, where));
    if (!mailbox) throw new ValidationError("There is no sending mailbox for this inbox yet.");
    const [last] = await tx.select().from(emailMessages).where(and(eq(emailMessages.threadId, thread.id), eq(emailMessages.direction, "inbound"))).orderBy(desc(emailMessages.createdAt)).limit(1);
    const firstName = (thread.counterpartName ?? thread.counterpartEmail).split(/[\s@]/)[0];
    const recipient: Recipient = { email: thread.counterpartEmail, name: thread.counterpartName ?? thread.counterpartEmail, firstName, reference: null, leadId: thread.leadId, clientId: thread.clientId };
    if (thread.leadId) recipient.reference = (await tx.select({ ref: leads.ref }).from(leads).where(eq(leads.id, thread.leadId)))[0]?.ref ?? null;
    if (thread.clientId) recipient.reference = (await tx.select({ ref: clients.ref }).from(clients).where(eq(clients.id, thread.clientId)))[0]?.ref ?? null;
    const subject = input.subject ?? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`);
    const msg = await buildMessage(tx, ctx, where, recipient, { ...input, subject }, mailbox);
    const [message] = await tx
      .insert(emailMessages)
      .values({
        orgId: ctx.orgId, firmId: thread.firmId, threadId: thread.id, direction: "outbound", status: "queued", fromAddress: mailbox.fromAddress, fromName: mailbox.fromName,
        toAddresses: [thread.counterpartEmail], ccAddresses: input.cc, subject: msg.subject, textBody: msg.text, htmlBody: msg.html, templateId: msg.templateId,
        inReplyTo: last?.messageId ?? null, sentById: ctx.user.id,
      })
      .returning();
    await tx.update(emailThreads).set({ lastMessageAt: new Date(), unread: false, status: "open" }).where(eq(emailThreads.id, thread.id));
    if (thread.leadId || thread.clientId) {
      await tx.insert(activities).values({ firmId: thread.firmId!, leadId: thread.leadId, clientId: thread.clientId, type: "email", body: msg.subject, actorId: ctx.user.id, data: { threadId: thread.id, direction: "outbound" } });
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: thread.firmId, action: "email.replied", entityType: "email_thread", entityId: thread.id, summary: "Replied to a conversation", ip: ctx.ip }, tx);
    return { thread, mailbox, message, msg, inReplyTo: last?.messageId ?? null };
  });
  const headers: Record<string, string> = {};
  if (prepared.inReplyTo) {
    headers["In-Reply-To"] = prepared.inReplyTo;
    headers["References"] = prepared.inReplyTo;
  }
  const result = await deliver(ctx, where, prepared.message.id, {
    from: fromHeader(prepared.mailbox.fromName, prepared.mailbox.fromAddress),
    to: [prepared.thread.counterpartEmail],
    cc: input.cc,
    replyTo: threadReplyAddress(prepared.mailbox.inboundAddress, prepared.thread.id),
    subject: prepared.msg.subject,
    html: prepared.msg.html,
    text: prepared.msg.text,
    headers,
  });
  return { status: result.status };
}

/** Render a message without sending, for the compose preview. */
export async function previewForRecord(ctx: AccessContext, firmId: string, target: { leadId?: string; clientId?: string }, raw: unknown) {
  const where: EmailScope = { kind: "firm", firmId };
  requireSend(ctx, where);
  const input = parseOrThrow(composeSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const mailbox = (await mailboxFor(tx, ctx.orgId, where)) ?? { fromAddress: "not-set@example.invalid", fromName: "Not set", signature: null, inboundAddress: "", id: "" };
    const recipient = await loadRecipient(tx, firmId, target);
    const msg = await buildMessage(tx, ctx, where, recipient, input, mailbox as typeof mailboxes.$inferSelect);
    return { subject: msg.subject, html: msg.html, to: recipient.email, from: fromHeader(mailbox.fromName, mailbox.fromAddress) };
  });
}

/** Preview a template with sample values (template editor). */
export async function previewTemplate(ctx: AccessContext, where: EmailScope, raw: unknown) {
  if (where.kind === "firm") ctx.requireAny(["templates:manage", "email:view"], where.firmId);
  const input = parseOrThrow(templateSchema.partial({ name: true }), raw);
  return withScope(scopeOf(ctx, where), async (tx) => {
    const { brand, firmName } = await brandAndFirm(tx, where);
    const mailbox = await mailboxFor(tx, ctx.orgId, where);
    return renderEmail({
      brand, subject: input.subject, preheader: input.preheader, blocks: input.blocks,
      signature: mailbox?.signature ?? `${ctx.user.name}\n${firmName}`,
      values: { first_name: "Thandi", full_name: "Thandi Ndlovu", email: "thandi@example.com", reference: "VE-L-000123", firm_name: firmName, sender_name: ctx.user.name, sender_email: mailbox?.fromAddress ?? "hello@thegih.com", today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) },
      reference: "VE-L-000123",
    });
  });
}

/* ───────────────────────── Reading ───────────────────────── */

export async function listThreads(ctx: AccessContext, where: EmailScope, f: { q?: string; status?: "open" | "closed" | "all"; unread?: boolean } = {}) {
  requireView(ctx, where);
  const conds: SQL[] = [eq(emailThreads.orgId, ctx.orgId), firmCond(emailThreads.firmId, where)];
  if (f.status !== "all") conds.push(eq(emailThreads.status, f.status ?? "open"));
  if (f.unread) conds.push(eq(emailThreads.unread, true));
  if (f.q) {
    const term = `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(emailThreads.subject, term), ilike(emailThreads.counterpartEmail, term), ilike(emailThreads.counterpartName, term))!);
  }
  return withScope(scopeOf(ctx, where), async (tx) =>
    tx
      .select({
        id: emailThreads.id, subject: emailThreads.subject, counterpartEmail: emailThreads.counterpartEmail, counterpartName: emailThreads.counterpartName,
        unread: emailThreads.unread, status: emailThreads.status, lastMessageAt: emailThreads.lastMessageAt, leadId: emailThreads.leadId, clientId: emailThreads.clientId,
        intakeItemId: emailThreads.intakeItemId,
        preview: sql<string | null>`(select left(m.text_body, 160) from email_messages m where m.thread_id = ${emailThreads.id} order by m.created_at desc limit 1)`,
        lastDirection: sql<string | null>`(select m.direction::text from email_messages m where m.thread_id = ${emailThreads.id} order by m.created_at desc limit 1)`,
      })
      .from(emailThreads)
      .where(and(...conds))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(100),
  );
}

export async function getThread(ctx: AccessContext, where: EmailScope, threadId: string) {
  requireView(ctx, where);
  if (!isUuid(threadId)) throw new NotFoundError("Conversation");
  return withScope(scopeOf(ctx, where), async (tx) => {
    const [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.orgId, ctx.orgId), firmCond(emailThreads.firmId, where)));
    if (!thread) throw new NotFoundError("Conversation");
    if (thread.unread) await tx.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, thread.id));
    const messages = await tx
      .select({ m: emailMessages, sender: users.name })
      .from(emailMessages)
      .leftJoin(users, eq(users.id, emailMessages.sentById))
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(asc(emailMessages.createdAt));
    const lead = thread.leadId ? (await tx.select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName }).from(leads).where(eq(leads.id, thread.leadId)))[0] ?? null : null;
    const client = thread.clientId ? (await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(eq(clients.id, thread.clientId)))[0] ?? null : null;
    return { thread, messages: messages.map((r) => ({ ...r.m, senderName: r.sender })), lead, client };
  });
}

export async function setThreadStatus(ctx: AccessContext, where: EmailScope, threadId: string, status: "open" | "closed") {
  requireSend(ctx, where);
  if (!isUuid(threadId)) throw new NotFoundError("Conversation");
  return withScope(scopeOf(ctx, where), async (tx) => {
    const [t] = await tx.update(emailThreads).set({ status }).where(and(eq(emailThreads.id, threadId), eq(emailThreads.orgId, ctx.orgId), firmCond(emailThreads.firmId, where))).returning({ id: emailThreads.id });
    if (!t) throw new NotFoundError("Conversation");
  });
}

/** Firm inbox: turn an unknown sender into a lead, and link the conversation. */
export async function createLeadFromThread(ctx: AccessContext, firmId: string, threadId: string) {
  ctx.require("leads:create", firmId);
  const { createLead } = await import("../crm/leads");
  const { thread, messages } = await getThread(ctx, { kind: "firm", firmId }, threadId);
  if (thread.leadId || thread.clientId) throw new ValidationError("This conversation is already linked to a record.");
  const firstIn = messages.find((m) => m.direction === "inbound");
  const name = (thread.counterpartName ?? thread.counterpartEmail.split("@")[0]).trim();
  const [firstName, ...rest] = name.split(/\s+/);
  const { lead } = await createLead(ctx, firmId, {
    firstName: firstName || "Unknown", lastName: rest.join(" "), email: thread.counterpartEmail, phone: "",
    enquiry: `${thread.subject}\n\n${(firstIn?.textBody ?? "").slice(0, 4000)}`.trim(), source: "email", sourceDetail: "Firm inbox",
  });
  await withScope(ctx.scopeFor(firmId), (tx) => tx.update(emailThreads).set({ leadId: lead.id }).where(eq(emailThreads.id, thread.id)));
  return lead;
}

/* ───────────────────────── Receiving (webhook, no user) ───────────────────────── */

export type InboundOutcome = { status: "stored"; threadId: string; created: boolean } | { status: "duplicate" } | { status: "no_mailbox" } | { status: "not_found" };

const authLabel = (a: ReceivedEmail["authentication"]) => (a ? `spf=${a.spf ?? "?"} dkim=${a.dkim ?? "?"} dmarc=${a.dmarc ?? "?"}` : null);
const authFailed = (a: ReceivedEmail["authentication"]) => !!a && (a.dmarc === "fail" || (a.spf === "fail" && a.dkim === "fail"));

/** Find the single organisation this deployment serves (mail arrives with no user context). */
async function orgIdForMail() {
  const [o] = await db().select({ id: organisations.id }).from(organisations).limit(1);
  return o?.id ?? null;
}

/**
 * Store one received email. Steps: find the mailbox by the address it was sent
 * to, find or start the conversation, link it to a lead or client with the
 * same email in that firm, and for the Hub mailbox, open a Hub intake enquiry
 * for a new sender so it can be routed like any other enquiry.
 */
export async function ingestReceived(emailId: string, fetcher: (id: string) => Promise<ReceivedEmail | null> = resendGetReceived): Promise<InboundOutcome> {
  const mail = await fetcher(emailId);
  if (!mail) return { status: "not_found" };

  // One organisation per deployment; mailboxes are its configuration.
  const ownerOrg = await orgIdForMail();
  if (!ownerOrg) return { status: "no_mailbox" };

  const recipients = [...(mail.received_for ?? []), ...(mail.to ?? []), ...(mail.cc ?? [])].map((a) => parseRecipient(parseAddress(a).email));
  const boxes = await withScope({ orgId: ownerOrg, userId: null, firmIds: [] }, (tx) => tx.select().from(mailboxes).where(and(eq(mailboxes.orgId, ownerOrg), eq(mailboxes.isActive, true))));
  let mailbox: (typeof boxes)[number] | undefined;
  let taggedThread: string | null = null;
  for (const r of recipients) {
    const hit = boxes.find((b) => b.inboundAddress.toLowerCase() === r.base);
    if (hit) {
      mailbox = hit;
      taggedThread = r.threadId;
      break;
    }
  }
  if (!mailbox) return { status: "no_mailbox" };

  const from = parseAddress(mail.from);
  const where: EmailScope = mailbox.firmId ? { kind: "firm", firmId: mailbox.firmId } : { kind: "hub" };
  const scope: Scope = { orgId: ownerOrg, userId: null, firmIds: mailbox.firmId ? [mailbox.firmId] : [], intake: !mailbox.firmId };
  const subject = (mail.subject || "(no subject)").slice(0, 300);
  const inReplyTo = mail.headers?.["in-reply-to"] ?? mail.headers?.["In-Reply-To"] ?? null;

  return withScope(scope, async (tx) => {
    const [dup] = await tx.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.providerId, mail.id));
    if (dup) return { status: "duplicate" } as const;

    // 1. The thread tag in the reply-to address, 2. In-Reply-To of one of ours, 3. same sender + subject in 60 days.
    let thread: typeof emailThreads.$inferSelect | undefined;
    if (taggedThread) {
      [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, taggedThread), firmCond(emailThreads.firmId, where)));
    }
    if (!thread && inReplyTo) {
      const [m] = await tx.select({ threadId: emailMessages.threadId }).from(emailMessages).where(and(eq(emailMessages.messageId, inReplyTo))).limit(1);
      if (m) [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, m.threadId), firmCond(emailThreads.firmId, where)));
    }
    if (!thread) {
      const base = subject.replace(/^(re|fw|fwd)\s*:\s*/gi, "").trim();
      [thread] = await tx
        .select()
        .from(emailThreads)
        .where(and(firmCond(emailThreads.firmId, where), eq(emailThreads.counterpartEmail, from.email), gte(emailThreads.lastMessageAt, new Date(Date.now() - 60 * 864e5)), or(eq(emailThreads.subject, base), eq(emailThreads.subject, subject))))
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(1);
    }

    let created = false;
    if (!thread) {
      let leadId: string | null = null;
      let clientId: string | null = null;
      let intakeItemId: string | null = null;
      if (mailbox!.firmId) {
        const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.firmId, mailbox!.firmId), eq(clients.email, from.email), isNull(clients.deletedAt))).limit(1);
        if (c) clientId = c.id;
        else {
          const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.firmId, mailbox!.firmId), eq(leads.email, from.email), isNull(leads.deletedAt))).orderBy(desc(leads.createdAt)).limit(1);
          if (l) leadId = l.id;
        }
      } else if (!authFailed(mail.authentication)) {
        const name = (from.name ?? from.email.split("@")[0]).trim();
        const [firstName, ...rest] = name.split(/\s+/);
        const { item } = await storeIntake(tx, ownerOrg, {
          firstName: (firstName || "Unknown").slice(0, 80), lastName: rest.join(" ").slice(0, 80), email: from.email, phone: "",
          enquiry: `${subject}\n\n${(mail.text ?? "").slice(0, 4500)}`.trim(), source: "email", sourceRef: `email:${mail.id}`, consentContact: true,
        }, null);
        intakeItemId = item.id;
      }
      [thread] = await tx
        .insert(emailThreads)
        .values({ orgId: ownerOrg, firmId: mailbox!.firmId, mailboxId: mailbox!.id, subject, counterpartEmail: from.email, counterpartName: from.name, leadId, clientId, intakeItemId, unread: true })
        .returning();
      created = true;
    } else {
      await tx.update(emailThreads).set({ unread: true, status: "open", lastMessageAt: new Date() }).where(eq(emailThreads.id, thread.id));
    }

    await tx.insert(emailMessages).values({
      orgId: ownerOrg, firmId: mailbox!.firmId, threadId: thread.id, direction: "inbound", status: "received", providerId: mail.id, messageId: mail.message_id, inReplyTo,
      fromAddress: from.email, fromName: from.name, toAddresses: (mail.to ?? []).slice(0, 20), ccAddresses: (mail.cc ?? []).slice(0, 20), subject,
      textBody: mail.text?.slice(0, 200_000) ?? null, htmlBody: mail.html?.slice(0, 500_000) ?? null,
      attachments: (mail.attachments ?? []).slice(0, 30).map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size ?? null })),
      authResult: authLabel(mail.authentication),
    });
    if (thread.firmId && (thread.leadId || thread.clientId)) {
      await tx.insert(activities).values({ firmId: thread.firmId, leadId: thread.leadId, clientId: thread.clientId, type: "email", body: subject, data: { threadId: thread.id, direction: "inbound" } });
    }
    await audit({ orgId: ownerOrg, actorId: null, firmId: mailbox!.firmId, action: "email.received", entityType: "email_thread", entityId: thread.id, summary: `Email received at ${mailbox!.label}` }, tx);
    return { status: "stored", threadId: thread.id, created } as const;
  });
}

/** Delivery events for messages we sent (delivered, bounced…). */
export async function recordDelivery(providerId: string, status: string, error?: string) {
  await db().execute(sql`select email_record_delivery(${providerId}, ${status}, ${error ?? null})`);
}

/** Unread conversation counts for the sidebar badges. */
export async function unreadCount(ctx: AccessContext, where: EmailScope) {
  try {
    requireView(ctx, where);
  } catch {
    return 0;
  }
  return withScope(scopeOf(ctx, where), async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(emailThreads).where(and(eq(emailThreads.orgId, ctx.orgId), firmCond(emailThreads.firmId, where), eq(emailThreads.unread, true), eq(emailThreads.status, "open")));
    return r?.n ?? 0;
  });
}

import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { db, withScope, type Scope, type Tx } from "../../db/client";
import {
  activities,
  clients,
  emailDrafts,
  emailMessages,
  emailNotes,
  emailTemplates,
  emailThreads,
  firmMemberships,
  firms,
  groupMemberships,
  intakeItems,
  leads,
  mailboxes,
  organisations,
  roles,
  storedFiles,
  users,
  type EmailAttachmentMeta,
  type EmailBlock,
  type TemplateSlot,
} from "../../db/schema";
import { env } from "../../env";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { resendGetReceived, resendSend, type ReceivedEmail } from "../../integrations/resend";
import { parseOrThrow } from "../../validation";
import { storeIntake } from "../intake/intake";
import { loadVisibleLead } from "../crm/leads";
import { loadVisibleClient } from "../clients/clients";
import { canSendInbox, canViewInbox, inboxReach, inboxScope, requireSendInbox, requireViewInbox, scopeForFirm, visibleMailboxes, type MailboxRow } from "./access";
import { loadAttachmentsTx } from "./files";
import { renderHtmlTemplate, sanitizeTemplateHtml, templateTokens } from "./html-template";
import { brandFor, plainBlocks, renderEmail, unknownFields, type MergeValues } from "./render";
import { resolveSignatureTx } from "./signatures";

/** Where a mailbox, thread or template lives: a firm, or the Hub itself. */
export type EmailScope = { kind: "firm"; firmId: string } | { kind: "hub" };

const uuid = z.string().uuid();
const isUuid = (s: string | null | undefined): s is string => !!s && uuid.safeParse(s).success;
const firmIdOf = (where: EmailScope) => (where.kind === "firm" ? where.firmId : null);

function scopeOf(ctx: AccessContext, where: EmailScope): Scope {
  return scopeForFirm(ctx, firmIdOf(where));
}
function requireView(ctx: AccessContext, where: EmailScope) {
  requireViewInbox(ctx, firmIdOf(where));
}
const firmCond = (col: typeof emailThreads.firmId, where: EmailScope) => (where.kind === "firm" ? eq(col, where.firmId) : isNull(col));

export { TEMPLATE_CATEGORIES } from "@/lib/email-categories";

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

/** "a@b.com; c@d.com, Name <e@f.com>" → ["a@b.com", "c@d.com", "e@f.com"], validated. */
export function parseAddressField(raw: string | string[] | undefined | null): string[] {
  const parts = Array.isArray(raw) ? raw : (raw ?? "").split(/[,;\n]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const { email } = parseAddress(t);
    if (!z.string().email().safeParse(email).success) throw new ValidationError(`“${t.slice(0, 80)}” isn't a valid email address.`);
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

const fromHeader = (name: string, address: string) => `${name.replace(/[<>"\r\n]/g, "")} <${address}>`;

/* ───────────────────────── Mailboxes (settings) ───────────────────────── */

const mailboxSchema = z.object({
  firmId: z.string().optional().transform((v) => (v ? v : null)).refine((v) => v === null || isUuid(v), "Choose a firm."),
  label: z.string().trim().min(2, "Name the mailbox.").max(80),
  inboundAddress: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter the receiving address.")
    .refine((v) => v === null || !v.includes("+"), "Don't use + in the receiving address."),
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
      .where(and(eq(mailboxes.orgId, ctx.orgId), eq(mailboxes.kind, "shared")))
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
    if (input.inboundAddress) {
      const [clash] = await tx.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.inboundAddress, input.inboundAddress));
      if (clash && clash.id !== id) throw new ValidationError("Another mailbox already uses that receiving address.", { inboundAddress: "Already in use." });
    }
    const values = { ...input, orgId: ctx.orgId, updatedAt: new Date() };
    let row;
    if (id) {
      if (!isUuid(id)) throw new NotFoundError("Mailbox");
      [row] = await tx.update(mailboxes).set(values).where(and(eq(mailboxes.id, id), eq(mailboxes.orgId, ctx.orgId), eq(mailboxes.kind, "shared"))).returning();
      if (!row) throw new NotFoundError("Mailbox");
    } else {
      [row] = await tx.insert(mailboxes).values(values).returning();
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: row.firmId, action: id ? "mailbox.updated" : "mailbox.created", entityType: "mailbox", entityId: row.id, summary: `${id ? "Updated" : "Added"} mailbox ${row.label}`, ip: ctx.ip }, tx);
    return row;
  });
}

async function defaultMailboxTx(tx: Tx, orgId: string, firmId: string | null) {
  const [m] = await tx
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.orgId, orgId), firmId ? eq(mailboxes.firmId, firmId) : isNull(mailboxes.firmId), eq(mailboxes.isActive, true), eq(mailboxes.kind, "shared")))
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

const slotSchema: z.ZodType<TemplateSlot> = z.object({
  key: z.string().regex(/^[a-z_]{1,40}$/),
  label: z.string().trim().min(1).max(80),
  default: z.string().max(2000).default(""),
  multiline: z.boolean().default(true),
});

const templateSchema = z
  .object({
    name: z.string().trim().min(2, "Name the template.").max(120),
    category: z.string().trim().min(1).max(60).default("General"),
    subject: z.string().trim().min(2, "Write a subject line.").max(200),
    preheader: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
    format: z.enum(["blocks", "html"]).default("blocks"),
    blocks: z.array(blockSchema).max(40).default([]),
    html: z.string().max(300_000).optional().nullable().transform((v) => v || null),
    slots: z.array(slotSchema).max(20).default([]),
    textOverride: z.string().max(20_000).optional().nullable().transform((v) => v || null),
    sourceNote: z.string().max(300).optional().nullable().transform((v) => v || null),
    isActive: z.boolean().default(true),
  })
  .superRefine((t, c) => {
    if (t.format === "blocks" && !t.blocks.length) c.addIssue({ code: "custom", path: ["blocks"], message: "Add at least one block." });
    if (t.format === "html" && !t.html?.trim()) c.addIssue({ code: "custom", path: ["html"], message: "Paste or upload the template's HTML." });
    const tokens = templateTokens(t.subject, t.preheader, t.html, t.textOverride, ...t.blocks.map((b) => JSON.stringify(b)));
    const unknown = [...tokens.unknownFields, ...unknownFields(t.subject)].filter((v, i, a) => a.indexOf(v) === i);
    if (unknown.length) c.addIssue({ code: "custom", path: ["html"], message: `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}.` });
    if (t.format === "html") {
      const declared = new Set(t.slots.map((s) => s.key));
      const missing = tokens.slots.filter((s) => !declared.has(s));
      if (missing.length) c.addIssue({ code: "custom", path: ["slots"], message: `Describe the editable section${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` });
    }
  });

export type TemplateInput = z.input<typeof templateSchema>;

function requireTemplates(ctx: AccessContext, where: EmailScope) {
  if (where.kind === "firm") ctx.require("templates:manage", where.firmId);
  else ctx.require("hub_templates:manage");
}

/** Templates usable in a scope. Firms also see the Hub's shared templates. */
export async function listTemplates(ctx: AccessContext, where: EmailScope, opts: { includeHub?: boolean; activeOnly?: boolean } = {}) {
  if (where.kind === "firm") ctx.requireAny(["email:view", "templates:manage"], where.firmId);
  else if (!ctx.has("hub_templates:manage") && !ctx.has("intake:view") && !ctx.has("hub_email:send")) throw new AccessDeniedError("hub_templates:manage");
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
  const values = { ...input, html: input.html ? sanitizeTemplateHtml(input.html) : null };
  return withScope(scopeOf(ctx, where), async (tx) => {
    const firmId = firmIdOf(where);
    let row;
    if (id) {
      if (!isUuid(id)) throw new NotFoundError("Template");
      [row] = await tx
        .update(emailTemplates)
        .set({ ...values, version: sql`${emailTemplates.version} + 1`, updatedById: ctx.user.id, updatedAt: new Date() })
        .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, ctx.orgId), firmId ? eq(emailTemplates.firmId, firmId) : isNull(emailTemplates.firmId)))
        .returning();
      if (!row) throw new NotFoundError("Template");
    } else {
      [row] = await tx.insert(emailTemplates).values({ ...values, orgId: ctx.orgId, firmId, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: id ? "email_template.updated" : "email_template.created", entityType: "email_template", entityId: row.id, summary: `${id ? "Updated" : "Created"} template “${row.name}”`, ip: ctx.ip }, tx);
    return row;
  });
}

/* ───────────────────────── Merge values ───────────────────────── */

type Recipient = { email: string; name: string; firstName: string; reference: string | null; leadId: string | null; clientId: string | null; service: string | null; caseManager: string | null };

async function recordRecipient(tx: Tx, ctx: AccessContext, firmId: string, target: { leadId?: string | null; clientId?: string | null }): Promise<Recipient | null> {
  if (target.leadId) {
    const l = await loadVisibleLead(tx, ctx, firmId, target.leadId);
    const cm = l.assignedToId ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, l.assignedToId)))[0]?.name ?? null : null;
    return { email: l.email ?? "", name: [l.firstName, l.lastName].filter(Boolean).join(" "), firstName: l.firstName, reference: l.ref, leadId: l.id, clientId: null, service: l.immigrationCategory, caseManager: cm };
  }
  if (target.clientId) {
    const c = await loadVisibleClient(tx, ctx, firmId, target.clientId);
    const cm = c.primaryConsultantId ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, c.primaryConsultantId)))[0]?.name ?? null : null;
    return { email: c.email ?? "", name: [c.firstName, c.lastName].filter(Boolean).join(" "), firstName: c.firstName, reference: c.ref, leadId: null, clientId: c.id, service: null, caseManager: cm };
  }
  return null;
}

function mergeValues(r: Recipient | null, fallback: { email: string; name: string | null }, practice: string, sender: { name: string; email: string }, booking: string | null, extra: Record<string, string>): MergeValues {
  const name = r?.name || fallback.name || "";
  const first = r?.firstName || (fallback.name ?? "").split(/\s+/)[0] || "";
  const base: MergeValues = {
    first_name: first,
    full_name: name,
    email: r?.email || fallback.email,
    reference: r?.reference ?? "",
    firm_name: practice,
    practice_name: practice,
    matter_reference: r?.clientId ? (r.reference ?? "") : "",
    service: r?.service ?? "",
    case_manager: r?.caseManager ?? "",
    booking_link: booking ?? "",
    payment_link: "",
    sender_name: sender.name,
    sender_email: sender.email,
    today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  };
  for (const [k, v] of Object.entries(extra)) if (v.trim() && k in base) (base as Record<string, string>)[k] = v.trim();
  return base;
}

/* ───────────────────────── Compose, preview, send ───────────────────────── */

const addrList = z.union([z.string(), z.array(z.string())]).optional().transform((v) => parseAddressField(v));

const composeSchema = z.object({
  mailboxId: z.string().refine(isUuid, "Choose who you're sending from."),
  to: addrList,
  cc: addrList,
  bcc: addrList,
  subject: z.string().trim().max(250).optional().transform((v) => v || null),
  body: z.string().trim().max(50_000).optional().transform((v) => v || null),
  templateId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  slots: z.record(z.string(), z.string().max(10_000)).optional().default({}),
  fields: z.record(z.string(), z.string().max(500)).optional().default({}),
  format: z.enum(["branded", "plain"]).default("branded"),
  attachmentIds: z.array(z.string()).max(20).optional().default([]),
  threadId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  mode: z.enum(["new", "reply", "reply_all", "forward"]).default("new"),
  replyToMessageId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  leadId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  clientId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  draftId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
});

export type ComposeInput = z.input<typeof composeSchema>;
type Compose = z.infer<typeof composeSchema>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function quoteBlock(original: { fromName: string | null; fromAddress: string; createdAt: Date; providerDate: Date | null; subject: string; textBody: string | null; toAddresses: string[] }, mode: Compose["mode"]) {
  const when = (original.providerDate ?? original.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const who = original.fromName ? `${original.fromName} <${original.fromAddress}>` : original.fromAddress;
  const body = (original.textBody ?? "").slice(0, 6000);
  if (mode === "forward") {
    const head = `---------- Forwarded message ----------\nFrom: ${who}\nDate: ${when}\nSubject: ${original.subject}\nTo: ${original.toAddresses.join(", ")}`;
    return {
      html: `<div style="margin-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555"><p style="margin:0 0 8px;white-space:pre-line">${esc(head)}</p><div style="white-space:pre-line">${esc(body)}</div></div>`,
      text: `${head}\n\n${body}`,
    };
  }
  return {
    html: `<div style="margin-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555"><p style="margin:0 0 6px">On ${esc(when)}, ${esc(who)} wrote:</p><blockquote style="margin:0;padding:0 0 0 12px;border-left:3px solid #d5d7d4;white-space:pre-line">${esc(body)}</blockquote></div>`,
    text: `On ${when}, ${who} wrote:\n${body.split("\n").map((l) => `> ${l}`).join("\n")}`,
  };
}

function plainHtml(body: string, signatureHtml: string, quote: string) {
  const paras = esc(body.trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#202326">${paras}${signatureHtml}${quote}</body></html>`;
}

type Prepared = {
  mailbox: MailboxRow;
  thread: typeof emailThreads.$inferSelect | null;
  replied: typeof emailMessages.$inferSelect | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  missingFields: string[];
  emptySlots: string[];
  templateId: string | null;
  recipient: Recipient | null;
  attachments: (typeof storedFiles.$inferSelect)[];
};

/** Everything needed to show or send a message. Throws on permission or input problems. */
async function prepare(tx: Tx, ctx: AccessContext, input: Compose): Promise<Prepared> {
  const boxes = await visibleMailboxes(ctx, { tx });
  const mailbox = boxes.find((b) => b.id === input.mailboxId);
  if (!mailbox) throw new ValidationError("Choose a mailbox you can send from.", { mailboxId: "Not available to you." });
  if (!mailbox.canSend) throw new AccessDeniedError("email:send");
  const firmId = mailbox.firmId;
  requireSendInbox(ctx, firmId);

  let thread: typeof emailThreads.$inferSelect | null = null;
  let replied: typeof emailMessages.$inferSelect | null = null;
  if (input.threadId) {
    [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, input.threadId), eq(emailThreads.orgId, ctx.orgId)));
    if (!thread) throw new NotFoundError("Conversation");
    if ((thread.firmId ?? null) !== firmId) throw new ValidationError("Reply from a mailbox of the same practice as the conversation.", { mailboxId: "Choose this practice's mailbox." });
    const msgs = await tx.select().from(emailMessages).where(eq(emailMessages.threadId, thread.id)).orderBy(desc(emailMessages.createdAt));
    replied = (input.replyToMessageId ? msgs.find((m) => m.id === input.replyToMessageId) : (msgs.find((m) => m.direction === "inbound") ?? msgs[0])) ?? null;
    if (input.replyToMessageId && !replied) throw new NotFoundError("Message");
  } else if (input.mode !== "new") {
    throw new ValidationError("Choose the message you're replying to.");
  }

  const leadId = input.leadId ?? (input.clientId ? null : (thread?.leadId ?? null));
  const clientId = input.clientId ?? (input.leadId ? null : (thread?.clientId ?? null));
  if (!firmId && (leadId || clientId)) throw new ValidationError("Hub conversations aren't linked to a practice's records.");
  const recipient = firmId ? await recordRecipient(tx, ctx, firmId, { leadId, clientId }) : null;

  let to = input.to;
  if (!to.length && recipient?.email && input.mode === "new") to = [recipient.email];
  if (!to.length) throw new ValidationError("Add at least one recipient.", { to: "Add a recipient." });
  if (input.to.length + input.cc.length + input.bcc.length > 50) throw new ValidationError("Send to 50 people or fewer at a time.");

  const sig = await resolveSignatureTx(tx, ctx.orgId, firmId, { id: ctx.user.id, name: ctx.user.name });
  const f = firmId ? (await tx.select({ slug: firms.slug, tradingName: firms.tradingName, brandColor: firms.brandColor }).from(firms).where(eq(firms.id, firmId)))[0] : null;
  const brand = brandFor(f ?? null, env().APP_URL);
  const practice = f?.tradingName ?? "Global Immigration Hub";
  const values = mergeValues(recipient, { email: to[0], name: thread?.counterpartName ?? null }, practice, { name: ctx.user.name, email: mailbox.fromAddress }, sig.data.bookingUrl, input.fields);
  const quote = replied && input.mode !== "new" ? quoteBlock(replied, input.mode) : null;

  let subject: string;
  let html: string;
  let text: string;
  let missingFields: string[] = [];
  let emptySlots: string[] = [];
  let templateId: string | null = null;

  const defaultSubject = thread ? (input.mode === "forward" ? `Fwd: ${thread.subject.replace(/^(re|fwd?):\s*/i, "")}` : /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`) : null;

  if (input.templateId) {
    const own = firmId ? eq(emailTemplates.firmId, firmId) : isNull(emailTemplates.firmId);
    const [t] = await tx.select().from(emailTemplates).where(and(eq(emailTemplates.id, input.templateId), eq(emailTemplates.orgId, ctx.orgId), or(own, isNull(emailTemplates.firmId)), eq(emailTemplates.isActive, true)));
    if (!t) throw new NotFoundError("Template");
    templateId = t.id;
    if (t.format === "html" && t.html) {
      const r = renderHtmlTemplate({ html: t.html, subject: input.subject ?? t.subject, preheader: t.preheader, values, slots: input.slots, signatureHtml: sig.html, signatureText: sig.text, textOverride: t.textOverride });
      subject = r.subject;
      html = quote ? r.html.replace(/<\/body>/i, `${quote.html}</body>`) : r.html;
      text = quote ? `${r.text}\n\n${quote.text}` : r.text;
      missingFields = r.missingFields;
      emptySlots = r.emptySlots;
    } else {
      const blocks = input.body ? [...t.blocks.slice(0, 1), ...plainBlocks(input.body), ...t.blocks.slice(1)] : t.blocks;
      const tokens = templateTokens(input.subject ?? t.subject, ...blocks.map((b) => JSON.stringify(b)));
      missingFields = tokens.fields.filter((k) => !values[k as keyof MergeValues]);
      const r = renderEmail({ brand, subject: input.subject ?? t.subject, preheader: t.preheader, blocks, signature: sig.text, signatureHtml: sig.html, values, reference: recipient?.reference ?? null });
      subject = r.subject;
      html = quote ? r.html.replace(/<\/body>/i, `${quote.html}</body>`) : r.html;
      text = quote ? `${r.text}\n\n${quote.text}` : r.text;
    }
  } else {
    subject = (input.subject ?? defaultSubject ?? "").replace(/[\r\n]+/g, " ").trim();
    if (!input.body && input.mode !== "forward") throw new ValidationError("Write a message.", { body: "Write a message." });
    const body = input.body ?? "";
    const tokens = templateTokens(subject, body);
    missingFields = tokens.fields.filter((k) => !values[k as keyof MergeValues]);
    const mergeText = (s: string) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => values[k as keyof MergeValues] || m);
    subject = mergeText(subject);
    if (input.format === "plain") {
      const b = mergeText(body);
      html = plainHtml(b, sig.html, quote?.html ?? "");
      text = [b, sig.text, quote?.text].filter(Boolean).join("\n\n");
    } else {
      const r = renderEmail({ brand, subject, blocks: body ? plainBlocks(body) : [], signature: sig.text, signatureHtml: sig.html, values, reference: recipient?.reference ?? null });
      html = quote ? r.html.replace(/<\/body>/i, `${quote.html}</body>`) : r.html;
      text = quote ? `${r.text}\n\n${quote.text}` : r.text;
    }
  }
  if (!subject) throw new ValidationError("Write a subject line.", { subject: "Write a subject line." });

  const attachments = await loadAttachmentsTx(tx, ctx, firmId, input.attachmentIds);
  return { mailbox, thread, replied, to, cc: input.cc, bcc: input.bcc, subject, html, text, missingFields, emptySlots, templateId, recipient, attachments };
}

/** Render without sending: for the compose preview and the missing-field check. */
export async function previewMessage(ctx: AccessContext, raw: unknown) {
  const input = parseOrThrow(composeSchema, raw);
  return withScope(inboxScope(ctx), async (tx) => {
    const p = await prepare(tx, ctx, input);
    return {
      subject: p.subject, html: p.html, text: p.text, to: p.to, cc: p.cc, bcc: p.bcc,
      from: fromHeader(p.mailbox.fromName, p.mailbox.accountEmail ?? p.mailbox.fromAddress),
      via: p.mailbox.provider, missingFields: p.missingFields, emptySlots: p.emptySlots,
      attachments: p.attachments.map((a) => ({ id: a.id, filename: a.filename, size: a.size })),
    };
  });
}

export type SendOutcome = { threadId: string; messageId: string; status: "sent" | "failed" | "not_configured"; error?: string };

/** Send a new message, reply, reply-all or forward from a mailbox the user may use. */
export async function sendMessage(ctx: AccessContext, raw: unknown): Promise<SendOutcome> {
  const input = parseOrThrow(composeSchema, raw);
  const stored = await withScope(inboxScope(ctx), async (tx) => {
    const p = await prepare(tx, ctx, input);
    if (p.missingFields.length) throw new ValidationError(`Fill in the missing details before sending: ${p.missingFields.join(", ").replace(/_/g, " ")}.`, { fields: p.missingFields.join(",") });
    if (p.emptySlots.length) throw new ValidationError(`Complete the template sections before sending: ${p.emptySlots.join(", ").replace(/_/g, " ")}.`, { slots: p.emptySlots.join(",") });
    const firmId = p.mailbox.firmId;
    let thread = p.thread;
    if (thread && input.mode === "forward") thread = null; // a forward starts its own conversation
    if (!thread) {
      [thread] = await tx
        .insert(emailThreads)
        .values({
          orgId: ctx.orgId, firmId, mailboxId: p.mailbox.id, subject: p.subject.slice(0, 300), counterpartEmail: p.to[0], counterpartName: p.recipient?.email === p.to[0] ? p.recipient.name : null,
          leadId: p.recipient?.leadId ?? null, clientId: p.recipient?.clientId ?? null, assignedToId: ctx.user.id,
        })
        .returning();
    } else {
      await tx.update(emailThreads).set({ lastMessageAt: new Date(), unread: false, status: "open", ...(p.recipient && !thread.leadId && !thread.clientId ? { leadId: p.recipient.leadId, clientId: p.recipient.clientId } : {}) }).where(eq(emailThreads.id, thread.id));
    }
    const via = p.mailbox.provider === "forwarding" ? "resend" : p.mailbox.provider;
    const attachMeta: EmailAttachmentMeta[] = p.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.contentType, size: a.size, fileId: a.id }));
    const [message] = await tx
      .insert(emailMessages)
      .values({
        orgId: ctx.orgId, firmId, threadId: thread.id, direction: "outbound", status: "queued", fromAddress: p.mailbox.accountEmail ?? p.mailbox.fromAddress, fromName: p.mailbox.fromName,
        toAddresses: p.to, ccAddresses: p.cc, bccAddresses: p.bcc, subject: p.subject.slice(0, 300), textBody: p.text, htmlBody: p.html, templateId: p.templateId,
        inReplyTo: input.mode !== "forward" ? (p.replied?.messageId ?? null) : null, attachments: attachMeta, sentById: ctx.user.id, via,
      })
      .returning();
    const linkLead = thread.leadId ?? p.recipient?.leadId ?? null;
    const linkClient = thread.clientId ?? p.recipient?.clientId ?? null;
    if (firmId && (linkLead || linkClient)) {
      await tx.insert(activities).values({ firmId, leadId: linkLead, clientId: linkClient, type: "email", body: p.subject.slice(0, 300), actorId: ctx.user.id, data: { threadId: thread.id, direction: "outbound" } });
    }
    if (input.draftId) await tx.delete(emailDrafts).where(and(eq(emailDrafts.id, input.draftId), eq(emailDrafts.userId, ctx.user.id)));
    await audit({
      orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: input.mode === "new" ? "email.sent" : input.mode === "forward" ? "email.forwarded" : "email.replied",
      entityType: "email_thread", entityId: thread.id, summary: `${input.mode === "new" ? "Sent" : input.mode === "forward" ? "Forwarded" : "Replied to"} an email from ${p.mailbox.label}`,
      data: { templateId: p.templateId, recipients: p.to.length + p.cc.length + p.bcc.length, attachments: p.attachments.length }, ip: ctx.ip,
    }, tx);
    return { p, thread, message };
  });
  const result = await deliver(ctx, stored.p, stored.thread, stored.message, input.mode);
  return { threadId: stored.thread.id, messageId: stored.message.id, ...result };
}

/**
 * Hand the message to its route. Status becomes "sent" only after the
 * provider accepts it; "delivered" comes later from delivery events where
 * the provider reports them (Resend). Never throws.
 */
async function deliver(ctx: AccessContext, p: Prepared, thread: typeof emailThreads.$inferSelect, message: typeof emailMessages.$inferSelect, mode: Compose["mode"]): Promise<{ status: "sent" | "failed" | "not_configured"; error?: string }> {
  const scope: Scope = { ...scopeForFirm(ctx, p.mailbox.firmId) };
  const record = (set: Partial<typeof emailMessages.$inferInsert>, threadKey?: string | null) =>
    withScope(scope, async (tx) => {
      await tx.update(emailMessages).set(set).where(eq(emailMessages.id, message.id));
      if (threadKey && !thread.providerThreadId) await tx.update(emailThreads).set({ providerThreadId: threadKey }).where(and(eq(emailThreads.id, thread.id), isNull(emailThreads.providerThreadId)));
    });
  const files = p.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, data: a.data }));

  if (p.mailbox.provider === "forwarding") {
    const headers: Record<string, string> = {};
    if (message.inReplyTo && /^<[^\r\n<>\s]{3,250}>$/.test(message.inReplyTo)) {
      headers["In-Reply-To"] = message.inReplyTo;
      headers["References"] = message.inReplyTo;
    }
    const result = await resendSend({
      from: fromHeader(p.mailbox.fromName, p.mailbox.fromAddress), to: p.to, cc: p.cc, bcc: p.bcc,
      replyTo: p.mailbox.inboundAddress ? threadReplyAddress(p.mailbox.inboundAddress, thread.id) : undefined,
      subject: p.subject, html: p.html, text: p.text, headers, idempotencyKey: message.id,
      attachments: files.map((f) => ({ filename: f.filename, content: f.data, contentType: f.contentType })),
    });
    if (result.status === "sent") await record({ status: "sent", providerId: result.id, acceptedAt: new Date() });
    else if (result.status === "failed") await record({ status: "failed", error: result.error });
    else await record({ status: "not_configured" });
    return result.status === "failed" ? { status: "failed", error: result.error } : { status: result.status };
  }

  const { sendThroughProvider } = await import("./sync");
  const replied = p.replied && mode !== "new" && p.replied.providerId?.startsWith(p.mailbox.provider === "microsoft" ? "ms:" : "gm:")
    ? { providerId: p.replied.providerId, internetMessageId: p.replied.messageId, threadKey: thread.providerThreadId, mode: mode as "reply" | "reply_all" | "forward" }
    : null;
  const r = await sendThroughProvider(ctx.orgId, p.mailbox.id, {
    from: { email: p.mailbox.accountEmail ?? p.mailbox.fromAddress, name: p.mailbox.fromName }, to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, html: p.html, text: p.text, attachments: files, replyTo: replied,
  });
  if (r.ok) {
    await record({ status: "sent", providerId: r.accepted.providerId, messageId: r.accepted.internetMessageId, acceptedAt: new Date() }, r.accepted.threadKey);
    return { status: "sent" };
  }
  await record({ status: "failed", error: r.error });
  return { status: "failed", error: r.error };
}

/* ───────── Compatibility wrappers (lead/client pages, older inbox) ───────── */

const legacySchema = z.object({
  templateId: z.string().optional().transform((v) => v || null),
  subject: z.string().trim().max(200).optional().transform((v) => v || null),
  body: z.string().trim().max(20000).optional().transform((v) => v || null),
  cc: z.string().trim().max(500).optional().transform((v) => v ?? ""),
});

/** Email a lead or client of a firm, from that firm's mailbox. Logged on their timeline. */
export async function sendToRecord(ctx: AccessContext, firmId: string, target: { leadId?: string; clientId?: string }, raw: unknown) {
  requireSendInbox(ctx, firmId);
  const input = parseOrThrow(legacySchema, raw);
  const mailbox = await withScope(ctx.scopeFor(firmId), (tx) => defaultMailboxTx(tx, ctx.orgId, firmId));
  if (!mailbox) throw new ValidationError("This firm has no sending mailbox yet. A Hub administrator can add one under Settings › Email.");
  if (!input.templateId && !input.subject) throw new ValidationError("Write a subject line.", { subject: "Write a subject line." });
  if (!input.templateId && !input.body) throw new ValidationError("Write a message.", { body: "Write a message." });
  const r = await sendMessage(ctx, { mailboxId: mailbox.id, cc: input.cc, subject: input.subject ?? undefined, body: input.body ?? undefined, templateId: input.templateId, leadId: target.leadId, clientId: target.clientId });
  return { threadId: r.threadId, status: r.status };
}

export async function previewForRecord(ctx: AccessContext, firmId: string, target: { leadId?: string; clientId?: string }, raw: unknown) {
  requireSendInbox(ctx, firmId);
  const input = parseOrThrow(legacySchema, raw);
  const mailbox = await withScope(ctx.scopeFor(firmId), (tx) => defaultMailboxTx(tx, ctx.orgId, firmId));
  if (!mailbox) throw new ValidationError("This firm has no sending mailbox yet.");
  const r = await previewMessage(ctx, { mailboxId: mailbox.id, subject: input.subject ?? (input.templateId ? undefined : "(no subject)"), body: input.body ?? (input.templateId ? undefined : " "), templateId: input.templateId, leadId: target.leadId, clientId: target.clientId });
  return { subject: r.subject, html: r.html, to: r.to.join(", "), from: r.from, missingFields: r.missingFields };
}

/** Reply in an existing thread (firm or Hub), from the thread's mailbox. */
export async function replyToThread(ctx: AccessContext, where: EmailScope, threadId: string, raw: unknown) {
  requireSendInbox(ctx, firmIdOf(where));
  if (!isUuid(threadId)) throw new NotFoundError("Conversation");
  const input = parseOrThrow(legacySchema, raw);
  const thread = await withScope(scopeOf(ctx, where), async (tx) => (await tx.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), firmCond(emailThreads.firmId, where))))[0]);
  if (!thread) throw new NotFoundError("Conversation");
  const mailboxId = thread.mailboxId ?? (await withScope(scopeOf(ctx, where), (tx) => defaultMailboxTx(tx, ctx.orgId, firmIdOf(where))))?.id;
  if (!mailboxId) throw new ValidationError("There is no sending mailbox for this inbox yet.");
  const r = await sendMessage(ctx, { mailboxId, threadId, mode: "reply", to: [thread.counterpartEmail], cc: input.cc, subject: input.subject ?? undefined, body: input.body ?? undefined, templateId: input.templateId });
  return { status: r.status };
}

/** Preview a template with sample values (template editor). */
export async function previewTemplate(ctx: AccessContext, where: EmailScope, raw: unknown) {
  if (where.kind === "firm") ctx.requireAny(["templates:manage", "email:view"], where.firmId);
  else if (!ctx.has("hub_templates:manage") && !ctx.has("intake:view")) throw new AccessDeniedError("hub_templates:manage");
  const input = parseOrThrow(
    z.object({
      subject: z.string().max(250).default(""),
      preheader: z.string().max(250).optional().nullable(),
      format: z.enum(["blocks", "html"]).default("blocks"),
      blocks: z.array(z.any()).max(40).default([]),
      html: z.string().max(300_000).optional().nullable(),
      slots: z.array(z.object({ key: z.string(), default: z.string().optional() })).max(20).default([]),
      textOverride: z.string().max(20_000).optional().nullable(),
    }),
    raw,
  );
  return withScope(scopeOf(ctx, where), async (tx) => {
    const firmId = firmIdOf(where);
    const f = firmId ? (await tx.select({ slug: firms.slug, tradingName: firms.tradingName, brandColor: firms.brandColor }).from(firms).where(eq(firms.id, firmId)))[0] : null;
    const brand = brandFor(f ?? null, env().APP_URL);
    const practice = f?.tradingName ?? "Global Immigration Hub";
    const sig = await resolveSignatureTx(tx, ctx.orgId, firmId, { id: ctx.user.id, name: ctx.user.name });
    const sampleRef = where.kind === "hub" ? "GIH-000123" : `${ctx.firm(where.firmId).refPrefix}-L-000123`;
    const values: MergeValues = {
      first_name: "Thandi", full_name: "Thandi Ndlovu", email: "thandi@example.com", reference: sampleRef, firm_name: practice, practice_name: practice,
      matter_reference: sampleRef.replace("-L-", "-C-"), service: "Critical Skills Work Visa", case_manager: ctx.user.name, booking_link: sig.data.bookingUrl ?? "https://thegih.com/book",
      payment_link: "https://pay.example.com/sample", sender_name: ctx.user.name, sender_email: "hello@thegih.com", today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    };
    if (input.format === "html" && input.html) {
      const slots = Object.fromEntries(input.slots.map((s) => [s.key, s.default || `[${s.key.replace(/_/g, " ")}]`]));
      return renderHtmlTemplate({ html: input.html, subject: input.subject, preheader: input.preheader, values, slots, signatureHtml: sig.html, signatureText: sig.text, textOverride: input.textOverride });
    }
    const blocks = input.blocks.map((b) => blockSchema.safeParse(b)).filter((r) => r.success).map((r) => r.data!);
    return { ...renderEmail({ brand, subject: input.subject, preheader: input.preheader, blocks, signature: sig.text, signatureHtml: sig.html, values, reference: sampleRef }), missingFields: [], emptySlots: [] };
  });
}

/* ───────────────────────── Drafts ───────────────────────── */

const draftSchema = z.object({
  id: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  mailboxId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  threadId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  replyToMessageId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  mode: z.enum(["new", "reply", "reply_all", "forward"]).default("new"),
  to: z.string().max(4000).optional().default(""),
  cc: z.string().max(4000).optional().default(""),
  bcc: z.string().max(4000).optional().default(""),
  subject: z.string().max(250).optional().default(""),
  body: z.string().max(50_000).optional().default(""),
  templateId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  slots: z.record(z.string(), z.string().max(10_000)).optional().default({}),
  fields: z.record(z.string(), z.string().max(500)).optional().default({}),
  attachmentIds: z.array(z.string()).max(20).optional().default([]),
  leadId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
  clientId: z.string().optional().nullable().transform((v) => (v && isUuid(v) ? v : null)),
});

const looseList = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 50);

/** Save (create or update) one of the user's drafts. Drafts are private to their author. */
export async function saveDraft(ctx: AccessContext, raw: unknown) {
  const d = parseOrThrow(draftSchema, raw);
  return withScope(inboxScope(ctx), async (tx) => {
    let firmId: string | null = null;
    if (d.mailboxId) {
      const box = (await visibleMailboxes(ctx, { tx, sendable: true })).find((b) => b.id === d.mailboxId);
      if (!box) throw new ValidationError("Choose a mailbox you can send from.");
      firmId = box.firmId;
    } else if (d.threadId) {
      const [t] = await tx.select({ firmId: emailThreads.firmId }).from(emailThreads).where(eq(emailThreads.id, d.threadId));
      if (!t) throw new NotFoundError("Conversation");
      firmId = t.firmId;
    } else {
      throw new ValidationError("Choose who you're sending from.");
    }
    requireSendInbox(ctx, firmId);
    if (!firmId && (d.leadId || d.clientId)) throw new ValidationError("Hub drafts aren't linked to a practice's records.");
    if (firmId && d.leadId) await loadVisibleLead(tx, ctx, firmId, d.leadId);
    if (firmId && d.clientId) await loadVisibleClient(tx, ctx, firmId, d.clientId);
    const values = {
      orgId: ctx.orgId, firmId, userId: ctx.user.id, mailboxId: d.mailboxId, threadId: d.threadId, replyToMessageId: d.replyToMessageId, mode: d.mode,
      toAddresses: looseList(d.to), ccAddresses: looseList(d.cc), bccAddresses: looseList(d.bcc), subject: d.subject, body: d.body, templateId: d.templateId,
      slotValues: d.slots, fieldValues: d.fields, attachmentFileIds: d.attachmentIds.filter(isUuid), leadId: d.leadId, clientId: d.clientId, updatedAt: new Date(),
    };
    if (d.id) {
      const [row] = await tx.update(emailDrafts).set(values).where(and(eq(emailDrafts.id, d.id), eq(emailDrafts.userId, ctx.user.id))).returning();
      if (row) return row;
    }
    const [row] = await tx.insert(emailDrafts).values(values).returning();
    return row;
  });
}

export async function listMyDrafts(ctx: AccessContext) {
  return withScope(inboxScope(ctx), (tx) =>
    tx
      .select({ d: emailDrafts, mailboxLabel: mailboxes.label, firmName: firms.tradingName })
      .from(emailDrafts)
      .leftJoin(mailboxes, eq(mailboxes.id, emailDrafts.mailboxId))
      .leftJoin(firms, eq(firms.id, emailDrafts.firmId))
      .where(eq(emailDrafts.userId, ctx.user.id))
      .orderBy(desc(emailDrafts.updatedAt))
      .limit(100),
  );
}

export async function getDraft(ctx: AccessContext, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Draft");
  return withScope(inboxScope(ctx), async (tx) => {
    const [d] = await tx.select().from(emailDrafts).where(and(eq(emailDrafts.id, id), eq(emailDrafts.userId, ctx.user.id)));
    if (!d) throw new NotFoundError("Draft");
    return d;
  });
}

export async function deleteDraft(ctx: AccessContext, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Draft");
  await withScope(inboxScope(ctx), (tx) => tx.delete(emailDrafts).where(and(eq(emailDrafts.id, id), eq(emailDrafts.userId, ctx.user.id))));
}

/* ───────────────────────── Reading ───────────────────────── */

export type InboxFilters = {
  q?: string;
  status?: "open" | "closed" | "all";
  unread?: boolean;
  mailboxId?: string;
  /** "hub" or a firm id */
  practice?: string;
  assignee?: "me" | "unassigned" | string;
  linked?: "linked" | "unlinked";
  leadId?: string;
  clientId?: string;
};

/** Conversations across every inbox the user can read, newest first. */
export async function listInbox(ctx: AccessContext, f: InboxFilters = {}) {
  const reach = inboxReach(ctx);
  if (!reach.hub && !reach.firmIds.length) throw new AccessDeniedError("email:view");
  const conds: SQL[] = [eq(emailThreads.orgId, ctx.orgId)];
  const firmScope: SQL[] = [];
  if (reach.firmIds.length) firmScope.push(inArray(emailThreads.firmId, reach.firmIds));
  if (reach.hub) firmScope.push(isNull(emailThreads.firmId));
  conds.push(or(...firmScope)!);
  if (f.status !== "all") conds.push(eq(emailThreads.status, f.status ?? "open"));
  if (f.unread) conds.push(eq(emailThreads.unread, true));
  if (isUuid(f.mailboxId)) conds.push(eq(emailThreads.mailboxId, f.mailboxId));
  if (f.practice === "hub") conds.push(isNull(emailThreads.firmId));
  else if (isUuid(f.practice)) conds.push(eq(emailThreads.firmId, f.practice));
  if (f.assignee === "me") conds.push(eq(emailThreads.assignedToId, ctx.user.id));
  else if (f.assignee === "unassigned") conds.push(isNull(emailThreads.assignedToId));
  else if (isUuid(f.assignee)) conds.push(eq(emailThreads.assignedToId, f.assignee));
  if (f.linked === "linked") conds.push(or(isNotNull(emailThreads.leadId), isNotNull(emailThreads.clientId), isNotNull(emailThreads.intakeItemId))!);
  else if (f.linked === "unlinked") conds.push(and(isNull(emailThreads.leadId), isNull(emailThreads.clientId), isNull(emailThreads.intakeItemId))!);
  if (isUuid(f.leadId)) conds.push(eq(emailThreads.leadId, f.leadId));
  if (isUuid(f.clientId)) conds.push(eq(emailThreads.clientId, f.clientId));
  if (f.q?.trim()) {
    const term = `%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(emailThreads.subject, term),
        ilike(emailThreads.counterpartEmail, term),
        ilike(emailThreads.counterpartName, term),
        sql`exists (select 1 from email_messages m where m.thread_id = email_threads.id and (m.text_body ilike ${term} or m.from_address::text ilike ${term} or array_to_string(m.to_addresses, ',') ilike ${term}))`,
      )!,
    );
  }
  return withScope(inboxScope(ctx), (tx) =>
    tx
      .select({
        id: emailThreads.id, subject: emailThreads.subject, counterpartEmail: emailThreads.counterpartEmail, counterpartName: emailThreads.counterpartName,
        unread: emailThreads.unread, status: emailThreads.status, lastMessageAt: emailThreads.lastMessageAt, leadId: emailThreads.leadId, clientId: emailThreads.clientId,
        intakeItemId: emailThreads.intakeItemId, firmId: emailThreads.firmId, mailboxId: emailThreads.mailboxId, assignedToId: emailThreads.assignedToId,
        assigneeName: users.name, mailboxLabel: mailboxes.label, firmName: firms.tradingName, firmColor: firms.brandColor, firmSlug: firms.slug,
        preview: sql<string | null>`(select left(m.text_body, 160) from email_messages m where m.thread_id = email_threads.id order by m.created_at desc limit 1)`,
        unverified: sql<boolean>`exists (select 1 from email_messages m where m.thread_id = email_threads.id and m.direction = 'inbound' and m.auth_result like '%dmarc=fail%')`,
        lastDirection: sql<string | null>`(select m.direction::text from email_messages m where m.thread_id = email_threads.id order by m.created_at desc limit 1)`,
        lastStatus: sql<string | null>`(select m.status::text from email_messages m where m.thread_id = email_threads.id order by m.created_at desc limit 1)`,
        messageCount: sql<number>`(select count(*)::int from email_messages m where m.thread_id = email_threads.id)`,
        hasAttachments: sql<boolean>`exists (select 1 from email_messages m where m.thread_id = email_threads.id and jsonb_array_length(m.attachments) > 0)`,
        noteCount: sql<number>`(select count(*)::int from email_notes n where n.thread_id = email_threads.id)`,
      })
      .from(emailThreads)
      .leftJoin(users, eq(users.id, emailThreads.assignedToId))
      .leftJoin(mailboxes, eq(mailboxes.id, emailThreads.mailboxId))
      .leftJoin(firms, eq(firms.id, emailThreads.firmId))
      .where(and(...conds))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(150),
  );
}

/** Older per-scope list (firm or Hub only). */
export async function listThreads(ctx: AccessContext, where: EmailScope, f: { q?: string; status?: "open" | "closed" | "all"; unread?: boolean } = {}) {
  requireView(ctx, where);
  return listInbox(ctx, { ...f, practice: where.kind === "hub" ? "hub" : where.firmId });
}

/** One conversation with its messages, internal notes and linked records. Marks it read. */
export async function getConversation(ctx: AccessContext, threadId: string) {
  if (!isUuid(threadId)) throw new NotFoundError("Conversation");
  return withScope(inboxScope(ctx), async (tx) => {
    const [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.orgId, ctx.orgId)));
    if (!thread || !canViewInbox(ctx, thread.firmId)) throw new NotFoundError("Conversation");
    if (thread.unread) await tx.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, thread.id));
    const messages = await tx
      .select({ m: emailMessages, sender: users.name })
      .from(emailMessages)
      .leftJoin(users, eq(users.id, emailMessages.sentById))
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(asc(sql`coalesce(${emailMessages.providerDate}, ${emailMessages.createdAt})`));
    const notes = await tx
      .select({ n: emailNotes, author: users.name })
      .from(emailNotes)
      .leftJoin(users, eq(users.id, emailNotes.authorId))
      .where(eq(emailNotes.threadId, thread.id))
      .orderBy(asc(emailNotes.createdAt));
    const lead = thread.leadId ? (await tx.select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, phone: leads.phone, category: leads.immigrationCategory, assignedToId: leads.assignedToId }).from(leads).where(eq(leads.id, thread.leadId)))[0] ?? null : null;
    const client = thread.clientId ? (await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName, email: clients.email, phone: clients.phone, status: clients.status }).from(clients).where(eq(clients.id, thread.clientId)))[0] ?? null : null;
    const intake = thread.intakeItemId ? (await tx.select({ id: intakeItems.id, firstName: intakeItems.firstName, status: intakeItems.status }).from(intakeItems).where(eq(intakeItems.id, thread.intakeItemId)))[0] ?? null : null;
    const [mailbox] = thread.mailboxId ? await tx.select({ id: mailboxes.id, label: mailboxes.label, provider: mailboxes.provider, kind: mailboxes.kind, fromAddress: mailboxes.fromAddress }).from(mailboxes).where(eq(mailboxes.id, thread.mailboxId)) : [];
    const firm = thread.firmId ? (await tx.select({ id: firms.id, slug: firms.slug, tradingName: firms.tradingName, brandColor: firms.brandColor }).from(firms).where(eq(firms.id, thread.firmId)))[0] ?? null : null;
    const assignee = thread.assignedToId ? (await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, thread.assignedToId)))[0] ?? null : null;
    const related = await tx
      .select({ id: emailThreads.id, subject: emailThreads.subject, lastMessageAt: emailThreads.lastMessageAt, status: emailThreads.status })
      .from(emailThreads)
      .where(and(eq(emailThreads.counterpartEmail, thread.counterpartEmail), ne(emailThreads.id, thread.id), thread.firmId ? eq(emailThreads.firmId, thread.firmId) : isNull(emailThreads.firmId)))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(8);
    const drafts = await tx.select().from(emailDrafts).where(and(eq(emailDrafts.threadId, thread.id), eq(emailDrafts.userId, ctx.user.id))).orderBy(desc(emailDrafts.updatedAt));
    return {
      thread, mailbox: mailbox ?? null, firm, assignee, lead, client, intake, related, drafts,
      messages: messages.map((r) => ({ ...r.m, senderName: r.sender })),
      notes: notes.map((r) => ({ ...r.n, authorName: r.author })),
      canSend: canSendInbox(ctx, thread.firmId),
    };
  });
}

/** Older per-scope read. */
export async function getThread(ctx: AccessContext, where: EmailScope, threadId: string) {
  requireView(ctx, where);
  const c = await getConversation(ctx, threadId);
  if ((c.thread.firmId ?? null) !== firmIdOf(where)) throw new NotFoundError("Conversation");
  return { thread: c.thread, messages: c.messages, lead: c.lead, client: c.client };
}

async function loadThreadForAction(tx: Tx, ctx: AccessContext, threadId: string) {
  if (!isUuid(threadId)) throw new NotFoundError("Conversation");
  const [t] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.orgId, ctx.orgId))).for("update");
  if (!t || !canViewInbox(ctx, t.firmId)) throw new NotFoundError("Conversation");
  requireSendInbox(ctx, t.firmId);
  return t;
}

export async function setConversationStatus(ctx: AccessContext, threadId: string, status: "open" | "closed") {
  await withScope(inboxScope(ctx), async (tx) => {
    const t = await loadThreadForAction(tx, ctx, threadId);
    await tx.update(emailThreads).set({ status }).where(eq(emailThreads.id, t.id));
  });
}

export async function setThreadStatus(ctx: AccessContext, where: EmailScope, threadId: string, status: "open" | "closed") {
  requireSendInbox(ctx, firmIdOf(where));
  await setConversationStatus(ctx, threadId, status);
}

export async function markUnread(ctx: AccessContext, threadId: string) {
  await withScope(inboxScope(ctx), async (tx) => {
    if (!isUuid(threadId)) throw new NotFoundError("Conversation");
    const [t] = await tx.select({ id: emailThreads.id, firmId: emailThreads.firmId }).from(emailThreads).where(eq(emailThreads.id, threadId));
    if (!t || !canViewInbox(ctx, t.firmId)) throw new NotFoundError("Conversation");
    await tx.update(emailThreads).set({ unread: true }).where(eq(emailThreads.id, t.id));
  });
}

/** Staff who can work a conversation in this inbox (for assignment). */
export async function inboxAssignees(ctx: AccessContext, firmId: string | null) {
  requireViewInbox(ctx, firmId);
  return withScope(scopeForFirm(ctx, firmId), (tx) => assigneesTx(tx, ctx.orgId, firmId));
}

async function assigneesTx(tx: Tx, orgId: string, firmId: string | null) {
  if (firmId) {
    return tx
      .select({ id: users.id, name: users.name })
      .from(firmMemberships)
      .innerJoin(users, eq(users.id, firmMemberships.userId))
      .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
      .where(and(eq(firmMemberships.firmId, firmId), eq(firmMemberships.status, "active"), eq(users.status, "active"), sql`${roles.permissions} @> ARRAY['email:view']::text[]`))
      .orderBy(asc(users.name));
  }
  return tx
    .select({ id: users.id, name: users.name })
    .from(groupMemberships)
    .innerJoin(users, eq(users.id, groupMemberships.userId))
    .innerJoin(roles, eq(roles.id, groupMemberships.roleId))
    .where(and(eq(users.orgId, orgId), eq(users.status, "active"), sql`${roles.permissions} @> ARRAY['intake:view']::text[]`))
    .orderBy(asc(users.name));
}

export async function assignConversation(ctx: AccessContext, threadId: string, userId: string | null) {
  return withScope(inboxScope(ctx), async (tx) => {
    const t = await loadThreadForAction(tx, ctx, threadId);
    if (userId) {
      const ok = (await assigneesTx(tx, ctx.orgId, t.firmId)).some((u) => u.id === userId);
      if (!ok) throw new ValidationError("That person can't work in this inbox.");
    }
    await tx.update(emailThreads).set({ assignedToId: userId }).where(eq(emailThreads.id, t.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: t.firmId, action: "email.assigned", entityType: "email_thread", entityId: t.id, summary: userId ? "Assigned a conversation" : "Unassigned a conversation", data: { assignedToId: userId }, ip: ctx.ip }, tx);
  });
}

export async function addNote(ctx: AccessContext, threadId: string, body: string) {
  const text = body.trim();
  if (!text) throw new ValidationError("Write the note first.", { body: "Write the note first." });
  if (text.length > 5000) throw new ValidationError("Keep notes under 5,000 characters.");
  return withScope(inboxScope(ctx), async (tx) => {
    if (!isUuid(threadId)) throw new NotFoundError("Conversation");
    const [t] = await tx.select().from(emailThreads).where(eq(emailThreads.id, threadId));
    if (!t || !canViewInbox(ctx, t.firmId)) throw new NotFoundError("Conversation");
    const [note] = await tx.insert(emailNotes).values({ orgId: ctx.orgId, firmId: t.firmId, threadId: t.id, authorId: ctx.user.id, body: text }).returning();
    if (t.firmId && (t.leadId || t.clientId)) await tx.insert(activities).values({ firmId: t.firmId, leadId: t.leadId, clientId: t.clientId, type: "note", body: text.slice(0, 1000), actorId: ctx.user.id, data: { threadId: t.id, source: "email_note" } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: t.firmId, action: "email.note_added", entityType: "email_thread", entityId: t.id, summary: "Added an internal note to a conversation", ip: ctx.ip }, tx);
    return note;
  });
}

/** Link a conversation to a lead or client of its practice (or unlink). */
export async function linkConversation(ctx: AccessContext, threadId: string, target: { leadId?: string | null; clientId?: string | null }) {
  return withScope(inboxScope(ctx), async (tx) => {
    const t = await loadThreadForAction(tx, ctx, threadId);
    if (!t.firmId) throw new ValidationError("Hub conversations are linked through Hub intake.");
    const firmId = t.firmId;
    if (target.leadId) await loadVisibleLead(tx, ctx, firmId, target.leadId);
    if (target.clientId) await loadVisibleClient(tx, ctx, firmId, target.clientId);
    const untrusted = (await tx.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.threadId, t.id), eq(emailMessages.direction, "inbound"), ilike(emailMessages.authResult, "%dmarc=fail%"))).limit(1)).length > 0;
    if (untrusted && (target.leadId || target.clientId)) throw new ValidationError("This conversation has a sender that failed verification. Don't link it to a client record.");
    await tx.update(emailThreads).set({ leadId: target.leadId ?? null, clientId: target.leadId ? null : (target.clientId ?? null) }).where(eq(emailThreads.id, t.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "email.linked", entityType: "email_thread", entityId: t.id, summary: target.leadId || target.clientId ? "Linked a conversation to a record" : "Unlinked a conversation", data: target, ip: ctx.ip }, tx);
  });
}

/** Records in a practice that a conversation could be linked to. */
export async function searchLinkTargets(ctx: AccessContext, firmId: string, q: string) {
  requireViewInbox(ctx, firmId);
  const term = `%${q.trim().slice(0, 60).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { leadVisibility } = await import("../crm/leads");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const ls = ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId)
      ? await tx.select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, email: leads.email }).from(leads).where(and(...leadVisibility(ctx, firmId), or(ilike(leads.ref, term), ilike(leads.firstName, term), ilike(leads.lastName, term), ilike(leads.email, term)))).limit(8)
      : [];
    const cs = ctx.has("clients:view_all", firmId) || ctx.has("clients:view_assigned", firmId)
      ? await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName, email: clients.email }).from(clients).where(and(eq(clients.firmId, firmId), isNull(clients.deletedAt), ctx.has("clients:view_all", firmId) ? undefined : eq(clients.primaryConsultantId, ctx.user.id), or(ilike(clients.ref, term), ilike(clients.firstName, term), ilike(clients.lastName, term), ilike(clients.email, term)))).limit(8)
      : [];
    return { leads: ls, clients: cs };
  });
}

/** Firm inbox: turn an unknown sender into a lead, and link the conversation. */
export async function createLeadFromThread(ctx: AccessContext, firmId: string, threadId: string) {
  ctx.require("leads:create", firmId);
  const { createLead } = await import("../crm/leads");
  const c = await getConversation(ctx, threadId);
  if (c.thread.firmId !== firmId) throw new NotFoundError("Conversation");
  if (c.thread.leadId || c.thread.clientId) throw new ValidationError("This conversation is already linked to a record.");
  if (c.messages.some((m) => m.direction === "inbound" && m.authResult?.includes("dmarc=fail"))) throw new ValidationError("This sender failed verification, so it can't become a lead automatically.");
  const firstIn = c.messages.find((m) => m.direction === "inbound");
  const name = (c.thread.counterpartName ?? c.thread.counterpartEmail.split("@")[0]).trim();
  const [firstName, ...rest] = name.split(/\s+/);
  const { lead } = await createLead(ctx, firmId, {
    firstName: firstName || "Unknown", lastName: rest.join(" "), email: c.thread.counterpartEmail, phone: "",
    enquiry: `${c.thread.subject}\n\n${(firstIn?.textBody ?? "").slice(0, 4000)}`.trim(), source: "email", sourceDetail: "Inbox",
  });
  await withScope(ctx.scopeFor(firmId), (tx) => tx.update(emailThreads).set({ leadId: lead.id }).where(eq(emailThreads.id, c.thread.id)));
  return lead;
}

/** Hub inbox: open a Hub intake enquiry for a conversation that doesn't have one. */
export async function createIntakeFromThread(ctx: AccessContext, threadId: string) {
  ctx.require("intake:create");
  const c = await getConversation(ctx, threadId);
  if (c.thread.firmId) throw new ValidationError("Use “Create lead” in a practice inbox.");
  if (c.thread.intakeItemId) throw new ValidationError("This conversation already has a Hub enquiry.");
  const firstIn = c.messages.find((m) => m.direction === "inbound");
  const name = (c.thread.counterpartName ?? c.thread.counterpartEmail.split("@")[0]).trim();
  const [firstName, ...rest] = name.split(/\s+/);
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, async (tx) => {
    const { item } = await storeIntake(tx, ctx.orgId, {
      firstName: (firstName || "Unknown").slice(0, 80), lastName: rest.join(" ").slice(0, 80), email: c.thread.counterpartEmail, phone: "",
      enquiry: `${c.thread.subject}\n\n${(firstIn?.textBody ?? "").slice(0, 4500)}`.trim(), source: "email", sourceRef: `thread:${c.thread.id}`, consentContact: false,
    }, ctx.user.id);
    await tx.update(emailThreads).set({ intakeItemId: item.id }).where(eq(emailThreads.id, c.thread.id));
    return item;
  });
}

/* ───────────────────────── Receiving ───────────────────────── */

export type InboundOutcome = { status: "stored"; threadId: string; created: boolean } | { status: "duplicate" } | { status: "no_mailbox" } | { status: "not_found" };

const authLabel = (a: ReceivedEmail["authentication"]) => (a ? `spf=${a.spf ?? "?"} dkim=${a.dkim ?? "?"} dmarc=${a.dmarc ?? "?"}` : null);
const authFailed = (a: ReceivedEmail["authentication"]) => !!a && (a.dmarc === "fail" || (a.spf === "fail" && a.dkim === "fail"));

/** Find the single organisation this deployment serves (mail arrives with no user context). */
async function orgIdForMail() {
  const [o] = await db().select({ id: organisations.id }).from(organisations).limit(1);
  return o?.id ?? null;
}

export type IncomingMail = {
  providerId: string;
  threadKey: string | null;
  taggedThreadId: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  from: { email: string; name: string | null };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  date: Date | null;
  outbound: boolean;
  attachments: EmailAttachmentMeta[];
  authResult: string | null;
  untrusted: boolean;
  /** Live mail (not history import): may open a Hub enquiry and shows as unread. */
  live: boolean;
};

/**
 * File one message from a mailbox (forwarded via Resend, or found by provider
 * sync). Runs in a mail-system scope for that mailbox's practice. Steps: skip
 * duplicates, find the conversation, link it to a lead or client by address,
 * for the Hub mailbox open a Hub enquiry for a new live sender, store it.
 */
export async function fileMail(tx: Tx, orgId: string, mailbox: typeof mailboxes.$inferSelect, mail: IncomingMail): Promise<InboundOutcome> {
  const [dup] = await tx.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.providerId, mail.providerId));
  if (dup) return { status: "duplicate" };
  if (mail.internetMessageId) {
    const [same] = await tx
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .where(and(eq(emailMessages.messageId, mail.internetMessageId), eq(emailThreads.mailboxId, mailbox.id), eq(emailMessages.direction, mail.outbound ? "outbound" : "inbound")))
      .limit(1);
    if (same) return { status: "duplicate" };
  }
  const where: EmailScope = mailbox.firmId ? { kind: "firm", firmId: mailbox.firmId } : { kind: "hub" };
  const subject = (mail.subject || "(no subject)").slice(0, 300);
  const counterpart = mail.outbound ? { email: (mail.to[0] ?? mail.cc[0] ?? mail.from.email).toLowerCase(), name: null as string | null } : mail.from;

  let thread: typeof emailThreads.$inferSelect | undefined;
  if (!mail.untrusted) {
    if (mail.threadKey) [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.mailboxId, mailbox.id), eq(emailThreads.providerThreadId, mail.threadKey)));
    if (!thread && mail.taggedThreadId) [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, mail.taggedThreadId), firmCond(emailThreads.firmId, where)));
    if (!thread && mail.inReplyTo) {
      const [m] = await tx.select({ threadId: emailMessages.threadId }).from(emailMessages).where(eq(emailMessages.messageId, mail.inReplyTo)).limit(1);
      if (m) [thread] = await tx.select().from(emailThreads).where(and(eq(emailThreads.id, m.threadId), firmCond(emailThreads.firmId, where)));
    }
    if (!thread && !mail.threadKey) {
      const base = subject.replace(/^(re|fw|fwd)\s*:\s*/gi, "").trim();
      [thread] = await tx
        .select()
        .from(emailThreads)
        .where(and(firmCond(emailThreads.firmId, where), eq(emailThreads.counterpartEmail, counterpart.email), gte(emailThreads.lastMessageAt, new Date(Date.now() - 60 * 864e5)), or(eq(emailThreads.subject, base), eq(emailThreads.subject, subject))))
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(1);
    }
  }

  const when = mail.date ?? new Date();
  let created = false;
  if (!thread) {
    let leadId: string | null = null;
    let clientId: string | null = null;
    let intakeItemId: string | null = null;
    if (!mail.untrusted && mailbox.firmId) {
      const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.firmId, mailbox.firmId), eq(clients.email, counterpart.email), isNull(clients.deletedAt))).limit(1);
      if (c) clientId = c.id;
      else {
        const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.firmId, mailbox.firmId), eq(leads.email, counterpart.email), isNull(leads.deletedAt))).orderBy(desc(leads.createdAt)).limit(1);
        if (l) leadId = l.id;
      }
    } else if (!mail.untrusted && !mailbox.firmId && mail.live && !mail.outbound) {
      const name = (mail.from.name ?? mail.from.email.split("@")[0]).trim();
      const [firstName, ...rest] = name.split(/\s+/);
      const { item } = await storeIntake(tx, orgId, {
        firstName: (firstName || "Unknown").slice(0, 80), lastName: rest.join(" ").slice(0, 80), email: mail.from.email, phone: "",
        enquiry: `${subject}\n\n${(mail.text ?? "").slice(0, 4500)}`.trim(), source: "email", sourceRef: `email:${mail.providerId}`.slice(0, 200), consentContact: false,
      }, null);
      intakeItemId = item.id;
    }
    [thread] = await tx
      .insert(emailThreads)
      .values({
        orgId, firmId: mailbox.firmId, mailboxId: mailbox.id, subject, counterpartEmail: counterpart.email, counterpartName: counterpart.name, leadId, clientId, intakeItemId,
        unread: mail.live && !mail.outbound, lastMessageAt: when, providerThreadId: mail.untrusted ? null : mail.threadKey,
      })
      .returning();
    created = true;
  } else {
    const later = when > thread.lastMessageAt;
    await tx
      .update(emailThreads)
      .set({ ...(mail.live && !mail.outbound ? { unread: true, status: "open" as const } : {}), ...(later ? { lastMessageAt: when } : {}), ...(!thread.providerThreadId && mail.threadKey && !mail.untrusted ? { providerThreadId: mail.threadKey } : {}) })
      .where(eq(emailThreads.id, thread.id));
  }

  await tx.insert(emailMessages).values({
    orgId, firmId: mailbox.firmId, threadId: thread.id, direction: mail.outbound ? "outbound" : "inbound", status: mail.outbound ? "sent" : "received",
    providerId: mail.providerId, messageId: mail.internetMessageId, inReplyTo: mail.inReplyTo,
    fromAddress: mail.from.email || "unknown@invalid", fromName: mail.from.name, toAddresses: mail.to.slice(0, 50), ccAddresses: mail.cc.slice(0, 50), bccAddresses: mail.bcc.slice(0, 50), subject,
    textBody: mail.text?.slice(0, 200_000) ?? null, htmlBody: mail.html?.slice(0, 500_000) ?? null, attachments: mail.attachments.slice(0, 40), authResult: mail.authResult,
    via: mail.providerId.startsWith("ms:") ? "microsoft" : mail.providerId.startsWith("gm:") ? "google" : "resend", providerDate: mail.date, acceptedAt: mail.outbound ? mail.date : null,
  });
  if (!mail.untrusted && thread.firmId && (thread.leadId || thread.clientId) && mail.live) {
    await tx.insert(activities).values({ firmId: thread.firmId, leadId: thread.leadId, clientId: thread.clientId, type: "email", body: subject, data: { threadId: thread.id, direction: mail.outbound ? "outbound" : "inbound" } });
  }
  if (mail.live) await audit({ orgId, actorId: null, firmId: mailbox.firmId, action: mail.outbound ? "email.synced_sent" : "email.received", entityType: "email_thread", entityId: thread.id, summary: `Email ${mail.outbound ? "sent from" : "received at"} ${mailbox.label}` }, tx);
  return { status: "stored", threadId: thread.id, created };
}

/** Store one email that arrived through forwarding (Resend receiving webhook). */
export async function ingestReceived(emailId: string, fetcher: (id: string) => Promise<ReceivedEmail | null> = resendGetReceived): Promise<InboundOutcome> {
  const mail = await fetcher(emailId);
  if (!mail) return { status: "not_found" };
  const ownerOrg = await orgIdForMail();
  if (!ownerOrg) return { status: "no_mailbox" };

  const recipients = [...(mail.received_for ?? []), ...(mail.to ?? []), ...(mail.cc ?? [])].map((a) => parseRecipient(parseAddress(a).email));
  const boxes = await withScope({ orgId: ownerOrg, userId: null, firmIds: [], mailSystem: true }, (tx) => tx.select().from(mailboxes).where(and(eq(mailboxes.orgId, ownerOrg), eq(mailboxes.isActive, true))));
  let mailbox: (typeof boxes)[number] | undefined;
  let taggedThread: string | null = null;
  for (const r of recipients) {
    const hit = boxes.find((b) => b.inboundAddress?.toLowerCase() === r.base);
    if (hit) {
      mailbox = hit;
      taggedThread = r.threadId;
      break;
    }
  }
  if (!mailbox) return { status: "no_mailbox" };
  const scope: Scope = { orgId: ownerOrg, userId: null, firmIds: mailbox.firmId ? [mailbox.firmId] : [], intake: !mailbox.firmId, mailSystem: true };
  const inReplyTo = mail.headers?.["in-reply-to"] ?? mail.headers?.["In-Reply-To"] ?? null;
  const from = parseAddress(mail.from);
  return withScope(scope, (tx) =>
    fileMail(tx, ownerOrg, mailbox!, {
      providerId: mail.id, threadKey: null, taggedThreadId: taggedThread, internetMessageId: mail.message_id, inReplyTo,
      from, to: (mail.to ?? []).map((a) => parseAddress(a).email), cc: (mail.cc ?? []).map((a) => parseAddress(a).email), bcc: [],
      subject: mail.subject, text: mail.text, html: mail.html, date: mail.created_at ? new Date(mail.created_at) : null, outbound: false,
      attachments: (mail.attachments ?? []).slice(0, 30).map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size ?? null })),
      authResult: authLabel(mail.authentication), untrusted: authFailed(mail.authentication), live: true,
    }),
  );
}

/** Delivery events for messages we sent (delivered, bounced…). */
export async function recordDelivery(providerId: string, status: string, error?: string) {
  await db().execute(sql`select email_record_delivery(${providerId}, ${status}, ${error ?? null})`);
}

/** Unread conversation counts for the sidebar badge. */
export async function unreadCount(ctx: AccessContext, where?: EmailScope) {
  const reach = inboxReach(ctx);
  if (!reach.hub && !reach.firmIds.length) return 0;
  if (where && !canViewInbox(ctx, firmIdOf(where))) return 0;
  return withScope(inboxScope(ctx), async (tx) => {
    const scopeConds: SQL[] = [];
    if (where) scopeConds.push(firmCond(emailThreads.firmId, where));
    else {
      const parts: SQL[] = [];
      if (reach.firmIds.length) parts.push(inArray(emailThreads.firmId, reach.firmIds));
      if (reach.hub) parts.push(isNull(emailThreads.firmId));
      scopeConds.push(or(...parts)!);
    }
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(emailThreads).where(and(eq(emailThreads.orgId, ctx.orgId), ...scopeConds, eq(emailThreads.unread, true), eq(emailThreads.status, "open")));
    return r?.n ?? 0;
  });
}

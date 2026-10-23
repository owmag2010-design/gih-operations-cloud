import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { activities, clients, consentRecords, firmMemberships, leads, pipelineStages, roles, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { normalisePhone, optionalCountry, optionalDate, optionalEmail, optionalText, optionalUuid, parseOrThrow, tagsField } from "../../validation";
import { nextRef } from "../refs";

/* ───────────────────────── Validation ───────────────────────── */

export const LEAD_SOURCES = ["website_form", "assessment_form", "email", "whatsapp", "referral", "manual", "integration", "hub_intake"] as const;
export const LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const leadFields = {
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: optionalText(80),
  email: optionalEmail,
  phone: optionalText(40),
  nationality: optionalCountry,
  currentCountry: optionalCountry,
  destinationCountry: optionalCountry,
  immigrationCategory: optionalText(120),
  enquiry: optionalText(5000),
  source: z.enum(LEAD_SOURCES).default("manual"),
  sourceDetail: optionalText(200),
  priority: z.enum(LEAD_PRIORITIES).default("normal"),
  assignedToId: optionalUuid,
  followUpAt: optionalDate,
  tags: tagsField,
};

export const createLeadSchema = z
  .object({
    ...leadFields,
    consentContact: z.union([z.literal("on"), z.literal("true"), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
    consentMethod: optionalText(120),
  })
  .refine((v) => v.email || v.phone, { message: "Add an email address or a phone number.", path: ["email"] });

export const updateLeadSchema = z.object(leadFields).refine((v) => v.email || v.phone, { message: "Add an email address or a phone number.", path: ["email"] });

export type LeadFilters = {
  q?: string;
  stage?: string[];
  assignee?: string; // "me" | "unassigned" | user id
  priority?: string;
  source?: string;
  tag?: string;
  followUp?: "overdue" | "today" | "week" | "none";
  status?: "open" | "all" | "won" | "lost" | "closed";
  sort?: "created" | "updated" | "name" | "follow_up" | "priority";
  dir?: "asc" | "desc";
  page?: number;
  followUpFrom?: Date;
  followUpTo?: Date;
};

/* ───────────────────────── Access helpers ───────────────────────── */

function viewMode(ctx: AccessContext, firmId: string): "all" | "assigned" {
  if (ctx.has("leads:view_all", firmId)) return "all";
  if (ctx.has("leads:view_assigned", firmId)) return "assigned";
  throw new AccessDeniedError("leads:view");
}

export function leadVisibility(ctx: AccessContext, firmId: string): SQL[] {
  const conds: SQL[] = [eq(leads.firmId, firmId), isNull(leads.deletedAt)];
  if (viewMode(ctx, firmId) === "assigned") conds.push(eq(leads.assignedToId, ctx.user.id));
  return conds;
}

/** Load one visible lead or throw NotFound (also when it exists but is out of scope). */
export async function loadVisibleLead(tx: Tx, ctx: AccessContext, firmId: string, leadId: string, lock = false) {
  if (!z.string().uuid().safeParse(leadId).success) throw new NotFoundError("Lead");
  const q = tx.select().from(leads).where(and(eq(leads.id, leadId), ...leadVisibility(ctx, firmId))).limit(1);
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("Lead");
  return row;
}

/** Users who may be assigned leads in a firm: active members whose role can see leads. */
export async function assignableUsers(ctx: AccessContext, firmId: string) {
  ctx.firm(firmId);
  return withScope(ctx.scopeFor(firmId), (tx) => assignableUsersTx(tx, firmId));
}

async function assignableUsersTx(tx: Tx, firmId: string) {
  return tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(firmMemberships)
    .innerJoin(users, eq(users.id, firmMemberships.userId))
    .innerJoin(roles, eq(roles.id, firmMemberships.roleId))
    .where(
      and(
        eq(firmMemberships.firmId, firmId),
        eq(firmMemberships.status, "active"),
        eq(users.status, "active"),
        sql`(${roles.permissions} && ARRAY['leads:view_all','leads:view_assigned']::text[])`,
      ),
    )
    .orderBy(asc(users.name));
}

async function assertAssignable(tx: Tx, firmId: string, userId: string | undefined | null) {
  if (!userId) return;
  const ok = (await assignableUsersTx(tx, firmId)).some((u) => u.id === userId);
  if (!ok) throw new ValidationError("That person can't be assigned leads in this firm.", { assignedToId: "Choose a member of this firm." });
}

/* ───────────────────────── Stages ───────────────────────── */

export async function listStages(ctx: AccessContext, firmId: string, includeInactive = false) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.firmId, firmId), includeInactive ? undefined : eq(pipelineStages.isActive, true)))
      .orderBy(asc(pipelineStages.position)),
  );
}

async function defaultStage(tx: Tx, firmId: string) {
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.firmId, firmId), eq(pipelineStages.isActive, true), eq(pipelineStages.category, "open")))
    .orderBy(asc(pipelineStages.position))
    .limit(1);
  if (!stage) throw new ValidationError("This firm has no open pipeline stage. Add one in Settings.");
  return stage;
}

/* ───────────────────────── Queries ───────────────────────── */

const PAGE_SIZE = 50;

function filterConditions(ctx: AccessContext, firmId: string, f: LeadFilters): SQL[] {
  const conds = leadVisibility(ctx, firmId);
  if (f.q) {
    const term = `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(leads.firstName, term),
        ilike(leads.lastName, term),
        ilike(sql`${leads.firstName} || ' ' || coalesce(${leads.lastName}, '')`, term),
        ilike(leads.email, term),
        ilike(leads.phone, term),
        ilike(leads.ref, term),
        ilike(leads.immigrationCategory, term),
      )!,
    );
  }
  if (f.stage?.length) conds.push(inArray(leads.stageId, f.stage.filter((s) => z.string().uuid().safeParse(s).success)));
  if (f.assignee === "me") conds.push(eq(leads.assignedToId, ctx.user.id));
  else if (f.assignee === "unassigned") conds.push(isNull(leads.assignedToId));
  else if (f.assignee && z.string().uuid().safeParse(f.assignee).success) conds.push(eq(leads.assignedToId, f.assignee));
  if (f.priority && (LEAD_PRIORITIES as readonly string[]).includes(f.priority)) conds.push(eq(leads.priority, f.priority as (typeof LEAD_PRIORITIES)[number]));
  if (f.source && (LEAD_SOURCES as readonly string[]).includes(f.source)) conds.push(eq(leads.source, f.source as (typeof LEAD_SOURCES)[number]));
  if (f.tag) conds.push(sql`${f.tag} = any(${leads.tags})`);
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);
  if (f.followUp === "overdue") conds.push(lt(leads.followUpAt, now));
  if (f.followUp === "today") conds.push(and(gte(leads.followUpAt, now), lte(leads.followUpAt, endOfToday))!);
  if (f.followUp === "week") conds.push(and(gte(leads.followUpAt, now), lte(leads.followUpAt, new Date(now.getTime() + 7 * 864e5)))!);
  if (f.followUp === "none") conds.push(isNull(leads.followUpAt));
  if (f.followUpFrom) conds.push(gte(leads.followUpAt, f.followUpFrom));
  if (f.followUpTo) conds.push(lt(leads.followUpAt, f.followUpTo));
  if (f.followUpFrom || f.followUpTo) conds.push(isNotNull(leads.followUpAt));
  const status = f.status ?? "open";
  if (status !== "all") conds.push(eq(pipelineStages.category, status));
  return conds;
}

const PRIORITY_ORDER = sql`case ${leads.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;

export async function listLeads(ctx: AccessContext, firmId: string, f: LeadFilters = {}, opts: { limit?: number } = {}) {
  const conds = filterConditions(ctx, firmId, f);
  const dir = f.dir === "asc" ? asc : desc;
  const order =
    f.sort === "name" ? [dir(leads.firstName), dir(leads.lastName)]
    : f.sort === "updated" ? [dir(leads.updatedAt)]
    : f.sort === "follow_up" ? [sql`${leads.followUpAt} ${f.dir === "desc" ? sql`desc` : sql`asc`} nulls last`]
    : f.sort === "priority" ? [f.dir === "desc" ? desc(PRIORITY_ORDER) : asc(PRIORITY_ORDER), desc(leads.createdAt)]
    : [dir(leads.createdAt)];
  const limit = Math.min(opts.limit ?? PAGE_SIZE, 1000);
  const page = Math.max(1, Math.floor(f.page ?? 1));

  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({
        id: leads.id,
        ref: leads.ref,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        currentCountry: leads.currentCountry,
        destinationCountry: leads.destinationCountry,
        immigrationCategory: leads.immigrationCategory,
        source: leads.source,
        priority: leads.priority,
        followUpAt: leads.followUpAt,
        tags: leads.tags,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        convertedClientId: leads.convertedClientId,
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        stageCategory: pipelineStages.category,
        assigneeId: users.id,
        assigneeName: users.name,
      })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .leftJoin(users, eq(users.id, leads.assignedToId))
      .where(and(...conds))
      .orderBy(...order)
      .limit(limit)
      .offset((page - 1) * limit);
    const [{ total }] = await tx
      .select({ total: count() })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(and(...conds));
    return { rows, total, page, pageSize: limit };
  });
}

export async function getLead(ctx: AccessContext, firmId: string, leadId: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, firmId, leadId);
    const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, lead.stageId));
    const assignee = lead.assignedToId
      ? (await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, lead.assignedToId)))[0] ?? null
      : null;
    const timeline = await tx
      .select({ id: activities.id, type: activities.type, body: activities.body, data: activities.data, createdAt: activities.createdAt, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .where(and(eq(activities.firmId, firmId), eq(activities.leadId, lead.id)))
      .orderBy(desc(activities.createdAt))
      .limit(200);
    const consents = await tx.select().from(consentRecords).where(eq(consentRecords.leadId, lead.id)).orderBy(desc(consentRecords.recordedAt));
    const duplicates = await findDuplicates(tx, ctx, firmId, { email: lead.email, phone: lead.phone, excludeId: lead.id });
    const client = lead.convertedClientId
      ? (await tx.select({ id: clients.id, ref: clients.ref }).from(clients).where(eq(clients.id, lead.convertedClientId)))[0] ?? null
      : null;
    return { lead, stage, assignee, timeline, consents, duplicates, client };
  });
}

/** Other visible leads in the same firm sharing an email or phone number. */
async function findDuplicates(tx: Tx, ctx: AccessContext, firmId: string, p: { email?: string | null; phone?: string | null; excludeId?: string }) {
  const match: SQL[] = [];
  if (p.email) match.push(eq(leads.email, p.email));
  if (p.phone) match.push(eq(leads.phone, p.phone));
  if (!match.length) return [];
  return tx
    .select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, createdAt: leads.createdAt })
    .from(leads)
    .where(and(...leadVisibility(ctx, firmId), or(...match), p.excludeId ? ne(leads.id, p.excludeId) : undefined))
    .orderBy(desc(leads.createdAt))
    .limit(10);
}

async function findDuplicatesInFirm(tx: Tx, firmId: string, p: { email?: string | null; phone?: string | null; excludeId?: string }) {
  const match: SQL[] = [];
  if (p.email) match.push(eq(leads.email, p.email));
  if (p.phone) match.push(eq(leads.phone, p.phone));
  if (!match.length) return [];
  return tx
    .select({ id: leads.id, ref: leads.ref })
    .from(leads)
    .where(and(eq(leads.firmId, firmId), isNull(leads.deletedAt), or(...match), p.excludeId ? ne(leads.id, p.excludeId) : undefined))
    .limit(10);
}

/* ───────────────────────── Mutations ───────────────────────── */

type CreateOpts = { tx?: Tx; actorId?: string | null; intakeItemId?: string; skipPermission?: boolean };

/**
 * Create a lead. Returns the lead plus any possible duplicates (it is still
 * created: people decide whether it really is a duplicate).
 */
export async function createLead(ctx: AccessContext, firmId: string, raw: unknown, opts: CreateOpts = {}) {
  if (!opts.skipPermission) ctx.require("leads:create", firmId);
  const input = parseOrThrow(createLeadSchema, raw);
  const run = async (tx: Tx) => {
    const firm = ctx.firms.get(firmId);
    const prefix = firm?.refPrefix ?? (await firmPrefix(tx, firmId));
    if (input.assignedToId) {
      if (!opts.skipPermission && !ctx.has("leads:assign", firmId) && input.assignedToId !== ctx.user.id) throw new AccessDeniedError("leads:assign");
      await assertAssignable(tx, firmId, input.assignedToId);
    }
    const stage = await defaultStage(tx, firmId);
    const phone = normalisePhone(input.phone, input.currentCountry);
    const [lead] = await tx
      .insert(leads)
      .values({
        firmId,
        ref: await nextRef(tx, firmId, prefix, "lead"),
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone,
        nationality: input.nationality,
        currentCountry: input.currentCountry,
        destinationCountry: input.destinationCountry,
        immigrationCategory: input.immigrationCategory,
        enquiry: input.enquiry,
        source: input.source,
        sourceDetail: input.sourceDetail,
        priority: input.priority,
        assignedToId: input.assignedToId,
        stageId: stage.id,
        followUpAt: input.followUpAt,
        tags: input.tags,
        intakeItemId: opts.intakeItemId,
        createdById: opts.actorId === undefined ? ctx.user.id : opts.actorId,
      })
      .returning();
    const actorId = opts.actorId === undefined ? ctx.user.id : opts.actorId;
    await tx.insert(activities).values({ firmId, leadId: lead.id, type: "created", actorId, body: null, data: { source: input.source } });
    if (input.consentContact) {
      await tx.insert(consentRecords).values({ firmId, leadId: lead.id, purpose: "contact", granted: true, method: input.consentMethod ?? "Recorded by staff", recordedById: actorId });
      await tx.insert(activities).values({ firmId, leadId: lead.id, type: "consent", actorId, data: { purpose: "contact", granted: true } });
    }
    // Callers without lead access (e.g. Hub triage routing into a firm) still flag
    // duplicates on the lead, but get nothing back about other records.
    const canView = ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId);
    const found = canView
      ? await findDuplicates(tx, ctx, firmId, { email: lead.email, phone: lead.phone, excludeId: lead.id })
      : await findDuplicatesInFirm(tx, firmId, { email: lead.email, phone: lead.phone, excludeId: lead.id });
    if (found.length) {
      await tx.insert(activities).values({ firmId, leadId: lead.id, type: "duplicate_flagged", actorId, data: { refs: found.map((d) => d.ref) } });
    }
    const duplicates = canView ? found : [];
    await audit({ orgId: ctx.orgId, actorId, firmId, action: "lead.created", entityType: "lead", entityId: lead.id, summary: `Created ${lead.ref}`, ip: ctx.ip }, tx);
    return { lead, duplicates };
  };
  return opts.tx ? run(opts.tx) : withScope(ctx.scopeFor(firmId), run);
}

async function firmPrefix(tx: Tx, firmId: string) {
  const res = await tx.execute<{ ref_prefix: string }>(sql`select ref_prefix from firms where id = ${firmId}`);
  if (!res.rows[0]) throw new NotFoundError("Firm");
  return res.rows[0].ref_prefix;
}

const TRACKED: (keyof z.infer<typeof updateLeadSchema>)[] = [
  "firstName", "lastName", "email", "phone", "nationality", "currentCountry", "destinationCountry",
  "immigrationCategory", "enquiry", "source", "sourceDetail", "priority", "followUpAt", "tags", "assignedToId",
];

export async function updateLead(ctx: AccessContext, firmId: string, leadId: string, raw: unknown) {
  ctx.require("leads:edit", firmId);
  const input = parseOrThrow(updateLeadSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const before = await loadVisibleLead(tx, ctx, firmId, leadId, true);
    if ((input.assignedToId ?? null) !== (before.assignedToId ?? null)) {
      ctx.require("leads:assign", firmId);
      await assertAssignable(tx, firmId, input.assignedToId);
    }
    const next = { ...input, phone: normalisePhone(input.phone, input.currentCountry) };
    const changed: string[] = [];
    for (const k of TRACKED) {
      const a = (before as Record<string, unknown>)[k] ?? null;
      const b = (next as Record<string, unknown>)[k] ?? null;
      const same = a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime() : JSON.stringify(a) === JSON.stringify(b);
      if (!same) changed.push(k);
    }
    if (!changed.length) return before;
    const [lead] = await tx
      .update(leads)
      .set({
        firstName: next.firstName, lastName: next.lastName ?? null, email: next.email ?? null, phone: next.phone ?? null,
        nationality: next.nationality ?? null, currentCountry: next.currentCountry ?? null, destinationCountry: next.destinationCountry ?? null,
        immigrationCategory: next.immigrationCategory ?? null, enquiry: next.enquiry ?? null, source: next.source, sourceDetail: next.sourceDetail ?? null,
        priority: next.priority, followUpAt: next.followUpAt ?? null, tags: next.tags, assignedToId: next.assignedToId ?? null, updatedAt: new Date(),
      })
      .where(eq(leads.id, before.id))
      .returning();
    if (changed.includes("assignedToId")) {
      await tx.insert(activities).values({ firmId, leadId: lead.id, type: "assignment", actorId: ctx.user.id, data: { to: lead.assignedToId } });
    }
    const other = changed.filter((c) => c !== "assignedToId");
    if (other.length) await tx.insert(activities).values({ firmId, leadId: lead.id, type: "updated", actorId: ctx.user.id, data: { fields: other } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.updated", entityType: "lead", entityId: lead.id, summary: `Updated ${lead.ref}`, data: { fields: changed }, ip: ctx.ip }, tx);
    return lead;
  });
}

export async function changeStage(ctx: AccessContext, firmId: string, leadIds: string[], stageId: string) {
  ctx.require("leads:edit", firmId);
  if (!leadIds.length || leadIds.length > 200) throw new ValidationError("Select between 1 and 200 leads.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [stage] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.firmId, firmId), eq(pipelineStages.isActive, true)));
    if (!stage) throw new ValidationError("Choose a stage from this firm's pipeline.");
    if (stage.category === "won") throw new ValidationError("Use “Convert to client” to move a lead to a won stage.");
    let moved = 0;
    for (const id of leadIds) {
      const lead = await loadVisibleLead(tx, ctx, firmId, id, true);
      if (lead.stageId === stage.id || lead.convertedClientId) continue;
      await tx.update(leads).set({ stageId: stage.id, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      await tx.insert(activities).values({ firmId, leadId: lead.id, type: "stage_change", actorId: ctx.user.id, data: { from: lead.stageId, to: stage.id, toName: stage.name } });
      moved++;
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.stage_changed", entityType: "lead", entityId: leadIds.length === 1 ? leadIds[0] : undefined, summary: `Moved ${moved} lead(s) to ${stage.name}`, data: { count: moved, stageId: stage.id }, ip: ctx.ip }, tx);
    return { moved, stage };
  });
}

export async function assignLeads(ctx: AccessContext, firmId: string, leadIds: string[], userId: string | null) {
  ctx.require("leads:assign", firmId);
  if (!leadIds.length || leadIds.length > 200) throw new ValidationError("Select between 1 and 200 leads.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    await assertAssignable(tx, firmId, userId);
    let changed = 0;
    for (const id of leadIds) {
      const lead = await loadVisibleLead(tx, ctx, firmId, id, true);
      if ((lead.assignedToId ?? null) === userId) continue;
      await tx.update(leads).set({ assignedToId: userId, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      await tx.insert(activities).values({ firmId, leadId: lead.id, type: "assignment", actorId: ctx.user.id, data: { from: lead.assignedToId, to: userId } });
      changed++;
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.assigned", entityType: "lead", summary: `Assigned ${changed} lead(s)`, data: { count: changed, to: userId }, ip: ctx.ip }, tx);
    return { changed };
  });
}

export async function addLeadNote(ctx: AccessContext, firmId: string, leadId: string, body: string) {
  ctx.require("leads:edit", firmId);
  const text = body.trim();
  if (!text) throw new ValidationError("Write a note first.", { body: "Write a note first." });
  if (text.length > 5000) throw new ValidationError("Keep notes under 5,000 characters.", { body: "Too long." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, firmId, leadId);
    const [note] = await tx.insert(activities).values({ firmId, leadId: lead.id, type: "note", body: text, actorId: ctx.user.id }).returning();
    await tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, lead.id));
    return note;
  });
}

export async function recordLeadConsent(ctx: AccessContext, firmId: string, leadId: string, raw: unknown) {
  ctx.require("leads:edit", firmId);
  const input = parseOrThrow(
    z.object({
      purpose: z.enum(["contact", "data_processing", "marketing"]),
      granted: z.union([z.literal("yes"), z.literal("no")]).transform((v) => v === "yes"),
      method: z.string().trim().min(2, "Say how consent was given.").max(120),
      evidence: optionalText(500),
    }),
    raw,
  );
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, firmId, leadId);
    await tx.insert(consentRecords).values({ firmId, leadId: lead.id, purpose: input.purpose, granted: input.granted, method: input.method, evidence: input.evidence, recordedById: ctx.user.id });
    await tx.insert(activities).values({ firmId, leadId: lead.id, type: "consent", actorId: ctx.user.id, data: { purpose: input.purpose, granted: input.granted } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.consent_recorded", entityType: "lead", entityId: lead.id, data: { purpose: input.purpose, granted: input.granted }, ip: ctx.ip }, tx);
  });
}

export async function markDuplicate(ctx: AccessContext, firmId: string, leadId: string, originalId: string) {
  ctx.require("leads:edit", firmId);
  if (leadId === originalId) throw new ValidationError("A lead can't duplicate itself.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, firmId, leadId, true);
    const original = await loadVisibleLead(tx, ctx, firmId, originalId);
    const [dupStage] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.firmId, firmId), eq(pipelineStages.key, "duplicate")));
    await tx
      .update(leads)
      .set({ duplicateOfId: original.id, stageId: dupStage?.id ?? lead.stageId, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    await tx.insert(activities).values({ firmId, leadId: lead.id, type: "duplicate_flagged", actorId: ctx.user.id, data: { of: original.ref } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.marked_duplicate", entityType: "lead", entityId: lead.id, summary: `${lead.ref} marked as duplicate of ${original.ref}`, ip: ctx.ip }, tx);
  });
}

export async function deleteLeads(ctx: AccessContext, firmId: string, leadIds: string[]) {
  ctx.require("leads:delete", firmId);
  if (!leadIds.length || leadIds.length > 200) throw new ValidationError("Select between 1 and 200 leads.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    let removed = 0;
    for (const id of leadIds) {
      const lead = await loadVisibleLead(tx, ctx, firmId, id, true);
      if (lead.convertedClientId) throw new ValidationError(`${lead.ref} has been converted to a client and can't be deleted.`);
      await tx.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, lead.id));
      removed++;
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.deleted", entityType: "lead", summary: `Deleted ${removed} lead(s)`, data: { ids: leadIds }, ip: ctx.ip }, tx);
    return { removed };
  });
}

/**
 * Convert a lead into a client. Idempotent: converting twice returns the
 * client created the first time (the lead row is locked while converting).
 */
export async function convertLead(ctx: AccessContext, firmId: string, leadId: string) {
  ctx.require("leads:convert", firmId);
  ctx.require("clients:create", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, firmId, leadId, true);
    if (lead.convertedClientId) {
      const [existing] = await tx.select().from(clients).where(eq(clients.id, lead.convertedClientId));
      return { client: existing, created: false };
    }
    const prefix = ctx.firm(firmId).refPrefix;
    const [client] = await tx
      .insert(clients)
      .values({
        firmId,
        ref: await nextRef(tx, firmId, prefix, "client"),
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        nationality: lead.nationality,
        countryOfResidence: lead.currentCountry,
        primaryConsultantId: lead.assignedToId ?? ctx.user.id,
        sourceLeadId: lead.id,
        createdById: ctx.user.id,
      })
      .returning();
    const [won] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.firmId, firmId), eq(pipelineStages.category, "won"), eq(pipelineStages.isActive, true))).orderBy(asc(pipelineStages.position)).limit(1);
    await tx.update(leads).set({ convertedClientId: client.id, convertedAt: new Date(), stageId: won?.id ?? lead.stageId, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    // Carry consent forward so the client record shows its legal basis.
    const consents = await tx.select().from(consentRecords).where(eq(consentRecords.leadId, lead.id));
    for (const c of consents) {
      await tx.insert(consentRecords).values({ firmId, clientId: client.id, purpose: c.purpose, granted: c.granted, method: c.method, evidence: `Carried over from lead ${lead.ref}`, recordedById: ctx.user.id, recordedAt: c.recordedAt });
    }
    await tx.insert(activities).values({ firmId, leadId: lead.id, type: "converted", actorId: ctx.user.id, data: { clientId: client.id, clientRef: client.ref } });
    await tx.insert(activities).values({ firmId, clientId: client.id, type: "created", actorId: ctx.user.id, data: { fromLead: lead.ref } });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.converted", entityType: "lead", entityId: lead.id, summary: `Converted ${lead.ref} to client ${client.ref}`, data: { clientId: client.id }, ip: ctx.ip }, tx);
    return { client, created: true };
  });
}

/** CSV export of the current filter. Audited with the row count. */
export async function exportLeadsCsv(ctx: AccessContext, firmId: string, f: LeadFilters) {
  ctx.require("leads:export", firmId);
  const { rows } = await listLeads(ctx, firmId, { ...f, page: 1 }, { limit: 1000 });
  const header = ["Reference", "First name", "Last name", "Email", "Phone", "Current country", "Destination", "Category", "Stage", "Assigned to", "Priority", "Source", "Follow-up", "Tags", "Created"];
  const cell = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [r.ref, r.firstName, r.lastName, r.email, r.phone, r.currentCountry, r.destinationCountry, r.immigrationCategory, r.stageName, r.assigneeName, r.priority, r.source, r.followUpAt, r.tags.join(" "), r.createdAt].map(cell).join(","),
    ),
  );
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "lead.exported", entityType: "lead", summary: `Exported ${rows.length} lead(s) to CSV`, data: { count: rows.length, filters: { ...f, q: f.q ? "(search text)" : undefined } }, ip: ctx.ip });
  return lines.join("\r\n");
}

/** Tags on the leads the caller can see (assigned-only roles see only their own leads' tags). */
export async function leadTags(ctx: AccessContext, firmId: string) {
  const mineOnly = viewMode(ctx, firmId) === "assigned";
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const res = await tx.execute<{ tag: string }>(
      sql`select distinct unnest(tags) as tag from leads where firm_id = ${firmId} and deleted_at is null ${mineOnly ? sql`and assigned_to_id = ${ctx.user.id}` : sql``} order by 1 limit 200`,
    );
    return res.rows.map((r) => r.tag);
  });
}

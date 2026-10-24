import "server-only";
import { and, asc, count, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import {
  activities,
  calendarEvents,
  clients,
  deadlineRules,
  matterDates,
  matterFacts,
  matterMembers,
  matterPeople,
  matterStages,
  matters,
  proposals,
  services,
  tasks,
  users,
} from "../../db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { optionalCountry, optionalText, optionalUuid, parseOrThrow } from "../../validation";
import { nextRef } from "../refs";
import { applyTaskTemplates } from "../tasks/tasks";
import { addBusinessDays, addCalendarDays, isIsoDate } from "./dates";

/* ───────── Access ───────── */

export function matterViewMode(ctx: AccessContext, firmId: string) {
  if (ctx.has("matters:view_all", firmId)) return "all" as const;
  if (ctx.has("matters:view_assigned", firmId)) return "assigned" as const;
  throw new AccessDeniedError("matters:view");
}

export function canViewMatters(ctx: AccessContext, firmId: string) {
  return ctx.has("matters:view_all", firmId) || ctx.has("matters:view_assigned", firmId);
}

/** On the matter team: case manager, consultant or added member. */
function onTeam(userId: string): SQL {
  return or(
    eq(matters.caseManagerId, userId),
    eq(matters.consultantId, userId),
    exists(sql`(select 1 from matter_members mm where mm.matter_id = ${matters.id} and mm.user_id = ${userId})`),
  )!;
}

/**
 * Conditions for matters this person may see in a practice. Restricted
 * matters are also filtered by the database (row-level security).
 */
export function matterVisibility(ctx: AccessContext, firmId: string): SQL[] {
  const c: SQL[] = [eq(matters.firmId, firmId), isNull(matters.deletedAt)];
  if (matterViewMode(ctx, firmId) === "assigned") c.push(onTeam(ctx.user.id));
  return c;
}

export async function loadVisibleMatter(tx: Tx, ctx: AccessContext, firmId: string, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Matter");
  const q = tx.select().from(matters).where(and(eq(matters.id, id), ...matterVisibility(ctx, firmId))).limit(1);
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("Matter");
  return row;
}

function requireEdit(ctx: AccessContext, firmId: string) {
  if (!ctx.has("matters:edit", firmId)) throw new AccessDeniedError("matters:edit");
}

async function assertMember(tx: Tx, firmId: string, userId: string | undefined, field: string) {
  if (!userId) return;
  const res = await tx.execute(sql`select 1 from firm_memberships m join users u on u.id = m.user_id
    where m.firm_id = ${firmId} and m.user_id = ${userId} and m.status = 'active' and u.status = 'active'`);
  if (!res.rows.length) throw new ValidationError("Choose a member of this practice.", { [field]: "Choose a member of this practice." });
}

async function logActivity(tx: Tx, ctx: AccessContext, m: { id: string; firmId: string; clientId: string }, type: typeof activities.$inferInsert.type, body: string | null, data: Record<string, unknown> = {}) {
  await tx.insert(activities).values({ firmId: m.firmId, clientId: m.clientId, matterId: m.id, type, body, data, actorId: ctx.user.id });
}

/* ───────── Stages ───────── */

/** Stages that apply to a matter: the service's own set if it has one, otherwise the practice's default set. */
export async function stagesFor(tx: Tx, firmId: string, serviceId: string | null) {
  if (serviceId) {
    const own = await tx
      .select()
      .from(matterStages)
      .where(and(eq(matterStages.firmId, firmId), eq(matterStages.serviceId, serviceId), eq(matterStages.isActive, true)))
      .orderBy(asc(matterStages.position));
    if (own.length) return own;
  }
  return tx
    .select()
    .from(matterStages)
    .where(and(eq(matterStages.firmId, firmId), isNull(matterStages.serviceId), eq(matterStages.isActive, true)))
    .orderBy(asc(matterStages.position));
}

export async function listStageSets(ctx: AccessContext, firmId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({ s: matterStages, serviceName: services.name })
      .from(matterStages)
      .leftJoin(services, eq(services.id, matterStages.serviceId))
      .where(eq(matterStages.firmId, firmId))
      .orderBy(asc(matterStages.serviceId), asc(matterStages.position));
    const svc = await tx.select({ id: services.id, name: services.name }).from(services).where(and(eq(services.firmId, firmId), eq(services.isActive, true))).orderBy(asc(services.name));
    return { stages: rows.map((r) => ({ ...r.s, serviceName: r.serviceName })), services: svc };
  });
}

const stageSchema = z.object({
  name: z.string().trim().min(2, "Name the stage.").max(60),
  category: z.enum(["opening", "active", "submitted", "closed"]),
  serviceId: optionalUuid,
});

export async function addMatterStage(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(stageSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const serviceId = input.serviceId ?? null;
    if (serviceId) {
      const [svc] = await tx.select({ id: services.id }).from(services).where(and(eq(services.id, serviceId), eq(services.firmId, firmId)));
      if (!svc) throw new ValidationError("Choose a service from this practice.", { serviceId: "Choose a service from this practice." });
    }
    const [{ n }] = await tx.select({ n: count() }).from(matterStages).where(and(eq(matterStages.firmId, firmId), serviceId ? eq(matterStages.serviceId, serviceId) : isNull(matterStages.serviceId)));
    const key = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "stage"}_${Date.now().toString(36)}`;
    const [stage] = await tx.insert(matterStages).values({ firmId, serviceId, key, name: input.name, category: input.category, position: Number(n) }).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter_stage.created", entityType: "matter_stage", entityId: stage.id, summary: `Added matter stage ${stage.name}`, ip: ctx.ip }, tx);
    return stage;
  });
}

export async function updateMatterStage(ctx: AccessContext, firmId: string, stageId: string, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(stageSchema.extend({ isActive: z.union([z.boolean(), z.literal("on"), z.literal("off"), z.literal("")]).optional() }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    // The form always shows the checkbox, so an absent value means unticked.
    const isActive = input.isActive === true || input.isActive === "on";
    const [stage] = await tx
      .update(matterStages)
      .set({ name: input.name, category: input.category, isActive })
      .where(and(eq(matterStages.id, stageId), eq(matterStages.firmId, firmId)))
      .returning();
    if (!stage) throw new NotFoundError("Stage");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter_stage.updated", entityType: "matter_stage", entityId: stage.id, summary: `Updated matter stage ${stage.name}`, ip: ctx.ip }, tx);
    return stage;
  });
}

export async function moveMatterStage(ctx: AccessContext, firmId: string, stageId: string, direction: "up" | "down") {
  ctx.require("firm:manage", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [stage] = await tx.select().from(matterStages).where(and(eq(matterStages.id, stageId), eq(matterStages.firmId, firmId)));
    if (!stage) throw new NotFoundError("Stage");
    const set = await tx
      .select()
      .from(matterStages)
      .where(and(eq(matterStages.firmId, firmId), stage.serviceId ? eq(matterStages.serviceId, stage.serviceId) : isNull(matterStages.serviceId)))
      .orderBy(asc(matterStages.position));
    const i = set.findIndex((s) => s.id === stageId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= set.length) return;
    [set[i], set[j]] = [set[j], set[i]];
    for (const [pos, s] of set.entries()) await tx.update(matterStages).set({ position: pos }).where(eq(matterStages.id, s.id));
  });
}

/* ───────── Matters ───────── */

export type MatterFilters = { q?: string; stage?: string; status?: "open" | "closed" | "all"; mine?: boolean; clientId?: string; page?: number };

export async function listMatters(ctx: AccessContext, firmId: string, f: MatterFilters = {}) {
  const conds = matterVisibility(ctx, firmId);
  if (f.q?.trim()) {
    const term = `%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(matters.title, term), ilike(matters.ref, term), ilike(clients.firstName, term), ilike(clients.lastName, term), ilike(sql`${clients.firstName} || ' ' || coalesce(${clients.lastName}, '')`, term), ilike(matters.submissionReference, term))!);
  }
  if (f.stage && z.string().uuid().safeParse(f.stage).success) conds.push(eq(matters.stageId, f.stage));
  if (f.status !== "all") conds.push(f.status === "closed" ? eq(matterStages.category, "closed") : sql`${matterStages.category} <> 'closed'`);
  if (f.mine) conds.push(onTeam(ctx.user.id));
  if (f.clientId && z.string().uuid().safeParse(f.clientId).success) conds.push(eq(matters.clientId, f.clientId));
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const cm = sql<string | null>`(select name from users u where u.id = ${matters.caseManagerId})`;
    const rows = await tx
      .select({
        id: matters.id, ref: matters.ref, title: matters.title, restricted: matters.restricted, risk: matters.risk, openedAt: matters.openedAt, updatedAt: matters.updatedAt,
        clientId: clients.id, clientFirst: clients.firstName, clientLast: clients.lastName, clientRef: clients.ref,
        stageName: matterStages.name, stageCategory: matterStages.category, serviceName: services.name, caseManager: cm,
        nextDate: sql<string | null>`(select min(d.due_on)::text from matter_dates d where d.matter_id = ${matters.id} and d.completed_at is null and d.kind in ('deadline','submission'))`,
        openTasks: sql<number>`(select count(*)::int from tasks t where t.matter_id = ${matters.id} and t.status = 'open')`,
      })
      .from(matters)
      .innerJoin(clients, eq(clients.id, matters.clientId))
      .innerJoin(matterStages, eq(matterStages.id, matters.stageId))
      .leftJoin(services, eq(services.id, matters.serviceId))
      .where(and(...conds))
      .orderBy(desc(matters.updatedAt))
      .limit(50)
      .offset((page - 1) * 50);
    const [{ total }] = await tx
      .select({ total: count() })
      .from(matters)
      .innerJoin(clients, eq(clients.id, matters.clientId))
      .innerJoin(matterStages, eq(matterStages.id, matters.stageId))
      .where(and(...conds));
    const stages = await tx.select({ id: matterStages.id, name: matterStages.name, serviceId: matterStages.serviceId }).from(matterStages).where(and(eq(matterStages.firmId, firmId), eq(matterStages.isActive, true))).orderBy(asc(matterStages.serviceId), asc(matterStages.position));
    return { rows, total: Number(total), page, pageSize: 50, stages };
  });
}

export async function getMatter(ctx: AccessContext, firmId: string, id: string) {
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const matter = await loadVisibleMatter(tx, ctx, firmId, id);
    const [client] = await tx.select().from(clients).where(eq(clients.id, matter.clientId));
    const stages = await stagesFor(tx, firmId, matter.serviceId);
    const [stage] = await tx.select().from(matterStages).where(eq(matterStages.id, matter.stageId));
    const service = matter.serviceId ? ((await tx.select({ id: services.id, name: services.name, code: services.code }).from(services).where(eq(services.id, matter.serviceId)))[0] ?? null) : null;
    const proposal = matter.proposalId ? ((await tx.select({ id: proposals.id, ref: proposals.ref, title: proposals.title, status: proposals.status }).from(proposals).where(eq(proposals.id, matter.proposalId)))[0] ?? null) : null;
    const teamIds = [matter.caseManagerId, matter.consultantId].filter((x): x is string => !!x);
    const members = await tx.select({ userId: matterMembers.userId, name: users.name, email: users.email }).from(matterMembers).innerJoin(users, eq(users.id, matterMembers.userId)).where(eq(matterMembers.matterId, matter.id));
    const named = teamIds.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, teamIds)) : [];
    const nameOf = (uid: string | null) => named.find((u) => u.id === uid)?.name ?? null;
    const people = await tx.select().from(matterPeople).where(eq(matterPeople.matterId, matter.id)).orderBy(asc(matterPeople.position), asc(matterPeople.createdAt));
    const facts = await tx
      .select({ f: matterFacts, recordedBy: sql<string | null>`(select name from users u where u.id = ${matterFacts.recordedById})`, verifiedBy: sql<string | null>`(select name from users u where u.id = ${matterFacts.verifiedById})` })
      .from(matterFacts)
      .where(eq(matterFacts.matterId, matter.id))
      .orderBy(asc(matterFacts.createdAt));
    const dates = await tx
      .select({ d: matterDates, ruleName: deadlineRules.name, ruleSource: deadlineRules.source, reviewedBy: sql<string | null>`(select name from users u where u.id = ${matterDates.reviewedById})` })
      .from(matterDates)
      .leftJoin(deadlineRules, eq(deadlineRules.id, matterDates.ruleId))
      .where(eq(matterDates.matterId, matter.id))
      .orderBy(asc(matterDates.dueOn));
    const events = await tx
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.matterId, matter.id), isNull(calendarEvents.cancelledAt)))
      .orderBy(asc(calendarEvents.startsAt));
    const timeline = await tx
      .select({ id: activities.id, type: activities.type, body: activities.body, data: activities.data, createdAt: activities.createdAt, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .where(eq(activities.matterId, matter.id))
      .orderBy(desc(activities.createdAt))
      .limit(200);
    const rules = await tx.select().from(deadlineRules).where(and(eq(deadlineRules.firmId, firmId), eq(deadlineRules.isActive, true))).orderBy(asc(deadlineRules.name));
    return {
      matter, client, stage, stages, service, proposal, people, events, timeline,
      facts: facts.map((r) => ({ ...r.f, recordedBy: r.recordedBy, verifiedBy: r.verifiedBy })),
      dates: dates.map((r) => ({ ...r.d, ruleName: r.ruleName, ruleSource: r.ruleSource, reviewedBy: r.reviewedBy })),
      team: { caseManager: matter.caseManagerId ? { id: matter.caseManagerId, name: nameOf(matter.caseManagerId) } : null, consultant: matter.consultantId ? { id: matter.consultantId, name: nameOf(matter.consultantId) } : null, members },
      rules: rules.map((r) => ({ id: r.id, name: r.name, jurisdiction: r.jurisdiction, offsetDays: r.offsetDays, businessDays: r.businessDays, fromLabel: r.fromLabel, source: r.source, validated: !!r.validatedAt })),
    };
  });
}

const matterSchema = z.object({
  clientId: z.string().uuid("Choose a client."),
  title: z.string().trim().min(3, "Give the matter a short title.").max(160),
  serviceId: optionalUuid,
  legalCategory: optionalText(120),
  jurisdiction: optionalCountry,
  caseManagerId: optionalUuid,
  consultantId: optionalUuid,
  restricted: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  proposalId: optionalUuid,
});

export async function createMatter(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("matters:create", firmId);
  const input = parseOrThrow(matterSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.firmId, firmId), isNull(clients.deletedAt)));
    if (!client) throw new ValidationError("Choose a client from this practice.", { clientId: "Choose a client from this practice." });
    await assertMember(tx, firmId, input.caseManagerId, "caseManagerId");
    await assertMember(tx, firmId, input.consultantId, "consultantId");
    let service: { id: string; name: string; jurisdiction: string; category: string } | null = null;
    if (input.serviceId) {
      [service] = await tx.select({ id: services.id, name: services.name, jurisdiction: services.jurisdiction, category: services.category }).from(services).where(and(eq(services.id, input.serviceId), eq(services.firmId, firmId)));
      if (!service) throw new ValidationError("Choose a service from this practice.", { serviceId: "Choose a service from this practice." });
    }
    if (input.proposalId) {
      const [p] = await tx.select({ id: proposals.id, status: proposals.status, leadId: proposals.leadId }).from(proposals).where(and(eq(proposals.id, input.proposalId), eq(proposals.firmId, firmId)));
      if (!p) throw new ValidationError("Choose a proposal from this practice.", { proposalId: "Choose a proposal from this practice." });
      if (p.status !== "accepted") throw new ValidationError("Only an accepted proposal can open a matter.", { proposalId: "This proposal hasn't been accepted." });
      const [already] = await tx.select({ ref: matters.ref }).from(matters).where(and(eq(matters.proposalId, p.id), isNull(matters.deletedAt)));
      if (already) throw new ConflictError(`This proposal already opened matter ${already.ref}.`);
    }
    const stages = await stagesFor(tx, firmId, service?.id ?? null);
    if (!stages.length) throw new ValidationError("Set up matter stages for this practice first (Settings › Matters).");
    const first = stages[0];
    const [matter] = await tx
      .insert(matters)
      .values({
        firmId, clientId: client.id, ref: await nextRef(tx, firmId, ctx.firm(firmId).refPrefix, "matter"), title: input.title,
        serviceId: service?.id ?? null, legalCategory: input.legalCategory ?? service?.category ?? null, jurisdiction: input.jurisdiction ?? service?.jurisdiction ?? null,
        stageId: first.id, caseManagerId: input.caseManagerId ?? ctx.user.id, consultantId: input.consultantId ?? client.primaryConsultantId ?? null,
        restricted: input.restricted, proposalId: input.proposalId ?? null, createdById: ctx.user.id,
      })
      .returning();
    await tx.insert(matterPeople).values({ firmId, matterId: matter.id, role: "main_applicant", firstName: client.firstName, lastName: client.lastName, nationality: client.nationality });
    await logActivity(tx, ctx, matter, "matter", `Opened matter ${matter.ref}: ${matter.title}`, { stage: first.name });
    await tx.insert(activities).values({ firmId, clientId: client.id, type: "matter", body: `Opened matter ${matter.ref}`, data: { matterId: matter.id }, actorId: ctx.user.id });
    await applyTaskTemplates(tx, ctx, matter, null);
    await applyTaskTemplates(tx, ctx, matter, first.id);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.opened", entityType: "matter", entityId: matter.id, summary: `Opened matter ${matter.ref}${matter.restricted ? " (restricted)" : ""}`, ip: ctx.ip }, tx);
    return matter;
  });
}

const updateSchema = z.object({
  title: z.string().trim().min(3, "Give the matter a short title.").max(160),
  legalCategory: optionalText(120),
  jurisdiction: optionalCountry,
  caseManagerId: optionalUuid,
  consultantId: optionalUuid,
  restricted: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  risk: z.enum(["low", "medium", "high"]).default("low"),
  riskNote: optionalText(2000),
  submissionReference: optionalText(120),
  submissionChannel: optionalText(120),
  submittedOn: z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."),
  outcome: optionalText(2000),
});

export async function updateMatter(ctx: AccessContext, firmId: string, id: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(updateSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, id, true);
    await assertMember(tx, firmId, input.caseManagerId, "caseManagerId");
    await assertMember(tx, firmId, input.consultantId, "consultantId");
    // Only the practice's administrators or the case manager may change who can see a matter.
    if (input.restricted !== m.restricted && !(ctx.has("firm:manage", firmId) || m.caseManagerId === ctx.user.id)) {
      throw new AccessDeniedError("firm:manage");
    }
    const [updated] = await tx
      .update(matters)
      .set({
        title: input.title, legalCategory: input.legalCategory ?? null, jurisdiction: input.jurisdiction ?? null,
        caseManagerId: input.caseManagerId ?? null, consultantId: input.consultantId ?? null, restricted: input.restricted,
        risk: input.risk, riskNote: input.riskNote ?? null, submissionReference: input.submissionReference ?? null,
        submissionChannel: input.submissionChannel ?? null, submittedOn: input.submittedOn ?? null, outcome: input.outcome ?? null, updatedAt: new Date(),
      })
      .where(eq(matters.id, m.id))
      .returning();
    const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => String(m[k as keyof typeof m] ?? "") !== String(updated[k as keyof typeof updated] ?? ""));
    if (changed.length) await logActivity(tx, ctx, m, "updated", null, { fields: changed });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.updated", entityType: "matter", entityId: m.id, summary: `Updated matter ${m.ref}${changed.length ? `: ${changed.join(", ")}` : ""}`, ip: ctx.ip }, tx);
    return updated;
  });
}

export async function changeMatterStage(ctx: AccessContext, firmId: string, id: string, stageId: string) {
  requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, id, true);
    const stages = await stagesFor(tx, firmId, m.serviceId);
    const next = stages.find((s) => s.id === stageId);
    if (!next) throw new ValidationError("Choose a stage for this matter.");
    if (next.id === m.stageId) return { matter: m, stage: next, tasksCreated: 0 };
    const from = (await tx.select({ name: matterStages.name }).from(matterStages).where(eq(matterStages.id, m.stageId)))[0]?.name;
    const closing = next.category === "closed";
    const [updated] = await tx.update(matters).set({ stageId: next.id, closedAt: closing ? new Date() : null, updatedAt: new Date() }).where(eq(matters.id, m.id)).returning();
    await logActivity(tx, ctx, m, "stage_change", null, { fromName: from, toName: next.name });
    const tasksCreated = await applyTaskTemplates(tx, ctx, updated, next.id);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.stage_changed", entityType: "matter", entityId: m.id, summary: `Matter ${m.ref}: ${from} → ${next.name}`, ip: ctx.ip }, tx);
    return { matter: updated, stage: next, tasksCreated };
  });
}

export async function addMatterMember(ctx: AccessContext, firmId: string, id: string, userId: string) {
  requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, id);
    await assertMember(tx, firmId, userId, "userId");
    await tx.insert(matterMembers).values({ firmId, matterId: m.id, userId, addedById: ctx.user.id }).onConflictDoNothing();
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await logActivity(tx, ctx, m, "assignment", `Added ${u?.name ?? "a team member"} to the team`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.member_added", entityType: "matter", entityId: m.id, summary: `Added ${u?.name} to matter ${m.ref}`, ip: ctx.ip }, tx);
  });
}

export async function removeMatterMember(ctx: AccessContext, firmId: string, id: string, userId: string) {
  requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, id);
    await tx.delete(matterMembers).where(and(eq(matterMembers.matterId, m.id), eq(matterMembers.userId, userId)));
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await logActivity(tx, ctx, m, "assignment", `Removed ${u?.name ?? "a team member"} from the team`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.member_removed", entityType: "matter", entityId: m.id, summary: `Removed ${u?.name} from matter ${m.ref}`, ip: ctx.ip }, tx);
  });
}

/* ───────── People ───────── */

const isoDate = z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date.");
const personSchema = z.object({
  role: z.enum(["main_applicant", "spouse_partner", "dependant_child", "dependant_other", "sponsor", "employer_contact"]),
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: optionalText(80),
  dateOfBirth: isoDate,
  nationality: optionalCountry,
  immigrationStatus: optionalText(120),
  statusExpiresOn: isoDate,
  passportExpiresOn: isoDate,
});

export async function savePerson(ctx: AccessContext, firmId: string, matterId: string, personId: string | null, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(personSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const values = {
      role: input.role, firstName: input.firstName, lastName: input.lastName ?? null, dateOfBirth: input.dateOfBirth ?? null, nationality: input.nationality ?? null,
      immigrationStatus: input.immigrationStatus ?? null, statusExpiresOn: input.statusExpiresOn ?? null, passportExpiresOn: input.passportExpiresOn ?? null,
    };
    let person;
    if (personId) {
      [person] = await tx.update(matterPeople).set({ ...values, updatedAt: new Date() }).where(and(eq(matterPeople.id, personId), eq(matterPeople.matterId, m.id))).returning();
      if (!person) throw new NotFoundError("Person");
    } else {
      const [{ n }] = await tx.select({ n: count() }).from(matterPeople).where(eq(matterPeople.matterId, m.id));
      [person] = await tx.insert(matterPeople).values({ firmId, matterId: m.id, position: Number(n), ...values }).returning();
    }
    await logActivity(tx, ctx, m, "people", `${personId ? "Updated" : "Added"} ${[person.firstName, person.lastName].filter(Boolean).join(" ")} (${person.role.replace(/_/g, " ")})`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: personId ? "matter.person_updated" : "matter.person_added", entityType: "matter", entityId: m.id, summary: `${personId ? "Updated" : "Added"} a person on matter ${m.ref}`, ip: ctx.ip }, tx);
    return person;
  });
}

export async function removePerson(ctx: AccessContext, firmId: string, matterId: string, personId: string) {
  requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [p] = await tx.select().from(matterPeople).where(and(eq(matterPeople.id, personId), eq(matterPeople.matterId, m.id)));
    if (!p) throw new NotFoundError("Person");
    if (p.role === "main_applicant") {
      const [{ n }] = await tx.select({ n: count() }).from(matterPeople).where(and(eq(matterPeople.matterId, m.id), eq(matterPeople.role, "main_applicant")));
      if (Number(n) <= 1) throw new ValidationError("A matter keeps at least one main applicant.");
    }
    await tx.delete(matterPeople).where(eq(matterPeople.id, p.id));
    await logActivity(tx, ctx, m, "people", `Removed ${[p.firstName, p.lastName].filter(Boolean).join(" ")}`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.person_removed", entityType: "matter", entityId: m.id, summary: `Removed a person from matter ${m.ref}`, ip: ctx.ip }, tx);
  });
}

/* ───────── Facts ───────── */

const factSchema = z.object({
  label: z.string().trim().min(2, "Say what this fact is about.").max(120),
  value: z.string().trim().min(1, "Enter the fact.").max(2000),
  basis: z.enum(["client_statement", "staff_assessment", "verified"]),
  evidence: optionalText(500),
  personId: optionalUuid,
  sensitive: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal(""), z.literal("false")]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

export async function addFact(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(factSchema, raw);
  if (input.basis === "verified" && !input.evidence) throw new ValidationError("Say what the fact was verified against.", { evidence: "Name the document or source checked." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    if (input.personId) {
      const [p] = await tx.select({ id: matterPeople.id }).from(matterPeople).where(and(eq(matterPeople.id, input.personId), eq(matterPeople.matterId, m.id)));
      if (!p) throw new ValidationError("Choose a person on this matter.", { personId: "Choose a person on this matter." });
    }
    const verified = input.basis === "verified";
    const [fact] = await tx
      .insert(matterFacts)
      .values({ firmId, matterId: m.id, personId: input.personId ?? null, label: input.label, value: input.value, basis: input.basis, evidence: input.evidence ?? null, sensitive: input.sensitive, recordedById: ctx.user.id, verifiedById: verified ? ctx.user.id : null, verifiedAt: verified ? new Date() : null })
      .returning();
    await logActivity(tx, ctx, m, "fact", `${input.label}: recorded as ${input.basis.replace("_", " ")}`);
    return fact;
  });
}

/** Mark a client statement or staff assessment as verified, naming the evidence. */
export async function verifyFact(ctx: AccessContext, firmId: string, matterId: string, factId: string, evidence: string) {
  requireEdit(ctx, firmId);
  const ev = evidence.trim();
  if (ev.length < 3) throw new ValidationError("Say what the fact was verified against.", { evidence: "Name the document or source checked." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [f] = await tx.select().from(matterFacts).where(and(eq(matterFacts.id, factId), eq(matterFacts.matterId, m.id)));
    if (!f) throw new NotFoundError("Fact");
    const [fact] = await tx.update(matterFacts).set({ basis: "verified", evidence: ev.slice(0, 500), verifiedById: ctx.user.id, verifiedAt: new Date(), updatedAt: new Date() }).where(eq(matterFacts.id, f.id)).returning();
    await logActivity(tx, ctx, m, "fact", `${f.label}: verified against ${ev.slice(0, 120)}`, { was: f.basis });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.fact_verified", entityType: "matter", entityId: m.id, summary: `Verified "${f.label}" on matter ${m.ref}`, ip: ctx.ip }, tx);
    return fact;
  });
}

export async function removeFact(ctx: AccessContext, firmId: string, matterId: string, factId: string) {
  requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [f] = await tx.delete(matterFacts).where(and(eq(matterFacts.id, factId), eq(matterFacts.matterId, m.id))).returning();
    if (!f) throw new NotFoundError("Fact");
    await logActivity(tx, ctx, m, "fact", `Removed "${f.label}" (${f.basis.replace("_", " ")}: ${f.value.slice(0, 120)})`);
  });
}

/* ───────── Deadline rules ───────── */

const ruleSchema = z.object({
  name: z.string().trim().min(3, "Name the rule.").max(120),
  jurisdiction: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country."),
  offsetDays: z.coerce.number().int("Whole days only.").min(-3650).max(3650),
  businessDays: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  fromLabel: z.string().trim().min(3, "Say which date the rule counts from.").max(120),
  source: z.string().trim().min(5, "Cite the source: the Act, regulation, directive or official page.").max(500),
});

export async function listDeadlineRules(ctx: AccessContext, firmId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select({ r: deadlineRules, validatedBy: sql<string | null>`(select name from users u where u.id = ${deadlineRules.validatedById})` })
      .from(deadlineRules)
      .where(eq(deadlineRules.firmId, firmId))
      .orderBy(asc(deadlineRules.name))
      .then((rows) => rows.map((r) => ({ ...r.r, validatedBy: r.validatedBy }))),
  );
}

/** Add or edit a rule. Any change clears its validation until someone reviews it again. */
export async function saveDeadlineRule(ctx: AccessContext, firmId: string, ruleId: string | null, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(ruleSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const values = { ...input, validatedById: null, validatedAt: null, updatedAt: new Date() };
    const [rule] = ruleId
      ? await tx.update(deadlineRules).set(values).where(and(eq(deadlineRules.id, ruleId), eq(deadlineRules.firmId, firmId))).returning()
      : await tx.insert(deadlineRules).values({ firmId, ...values, createdById: ctx.user.id }).returning();
    if (!rule) throw new NotFoundError("Rule");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: ruleId ? "deadline_rule.updated" : "deadline_rule.created", entityType: "deadline_rule", entityId: rule.id, summary: `${ruleId ? "Updated" : "Added"} deadline rule "${rule.name}" (needs validation)`, ip: ctx.ip }, tx);
    return rule;
  });
}

export async function validateDeadlineRule(ctx: AccessContext, firmId: string, ruleId: string, valid: boolean) {
  ctx.require("firm:manage", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [rule] = await tx
      .update(deadlineRules)
      .set(valid ? { validatedById: ctx.user.id, validatedAt: new Date() } : { validatedById: null, validatedAt: null, isActive: false })
      .where(and(eq(deadlineRules.id, ruleId), eq(deadlineRules.firmId, firmId)))
      .returning();
    if (!rule) throw new NotFoundError("Rule");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: valid ? "deadline_rule.validated" : "deadline_rule.withdrawn", entityType: "deadline_rule", entityId: rule.id, summary: `${valid ? "Validated" : "Withdrew"} deadline rule "${rule.name}"`, ip: ctx.ip }, tx);
    return rule;
  });
}

/* ───────── Dates and deadlines ───────── */

const recordedSchema = z.object({
  kind: z.enum(["deadline", "expiry", "submission", "other"]),
  label: z.string().trim().min(2, "Name the date.").max(120),
  dueOn: z.string().refine(isIsoDate, "Enter a valid date."),
  basis: z.string().trim().min(3, "Say where the date comes from, e.g. the passport or the DHA letter.").max(500),
  personId: optionalUuid,
});

/** A date taken directly from a document or record. */
export async function addRecordedDate(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(recordedSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [d] = await tx
      .insert(matterDates)
      .values({ firmId, matterId: m.id, personId: input.personId ?? null, kind: input.kind, label: input.label, dueOn: input.dueOn, basisKind: "recorded", basis: input.basis, createdById: ctx.user.id })
      .returning();
    await logActivity(tx, ctx, m, "date", `${d.label}: ${d.dueOn} (recorded from ${d.basis})`);
    return d;
  });
}

const calculatedSchema = z.object({
  ruleId: z.string().uuid("Choose a rule."),
  fromDate: z.string().refine(isIsoDate, "Enter the date the rule counts from."),
  label: optionalText(120),
  personId: optionalUuid,
});

/** A deadline calculated from a validated rule and a recorded date. */
export async function addCalculatedDeadline(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(calculatedSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [rule] = await tx.select().from(deadlineRules).where(and(eq(deadlineRules.id, input.ruleId), eq(deadlineRules.firmId, firmId)));
    if (!rule || !rule.isActive) throw new ValidationError("Choose an active rule.", { ruleId: "Choose an active rule." });
    if (!rule.validatedAt) throw new ValidationError("This rule hasn't been validated. A practice administrator must review it first.", { ruleId: "Rule not validated." });
    const due = rule.businessDays ? addBusinessDays(input.fromDate, rule.offsetDays) : addCalendarDays(input.fromDate, rule.offsetDays);
    const unit = rule.businessDays ? "business days (Monday to Friday; public holidays are not excluded)" : "calendar days";
    const basis = `${rule.offsetDays} ${unit} from ${rule.fromLabel} (${input.fromDate}), under "${rule.name}". Source: ${rule.source}`;
    const today = new Date().toISOString().slice(0, 10);
    const [d] = await tx
      .insert(matterDates)
      .values({ firmId, matterId: m.id, personId: input.personId ?? null, kind: "deadline", label: input.label ?? rule.name, dueOn: due, basisKind: "calculated", basis, ruleId: rule.id, fromDate: input.fromDate, calculatedOn: today, createdById: ctx.user.id })
      .returning();
    await logActivity(tx, ctx, m, "date", `${d.label}: ${d.dueOn} (calculated)`, { rule: rule.name, from: input.fromDate });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.deadline_calculated", entityType: "matter", entityId: m.id, summary: `${d.label} on matter ${m.ref}: ${d.dueOn}`, ip: ctx.ip }, tx);
    return d;
  });
}

/** Change a date after review. The reason and reviewer are kept; the original basis stays in the activity history. */
export async function adjustDate(ctx: AccessContext, firmId: string, matterId: string, dateId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(z.object({ dueOn: z.string().refine(isIsoDate, "Enter a valid date."), reason: z.string().trim().min(5, "Explain why the date changes.").max(500) }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [d] = await tx.select().from(matterDates).where(and(eq(matterDates.id, dateId), eq(matterDates.matterId, m.id)));
    if (!d) throw new NotFoundError("Date");
    const [updated] = await tx
      .update(matterDates)
      .set({ dueOn: input.dueOn, basisKind: "adjusted", adjustmentReason: input.reason, reviewedById: ctx.user.id, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(matterDates.id, d.id))
      .returning();
    await logActivity(tx, ctx, m, "date", `${d.label}: ${d.dueOn} → ${input.dueOn}. ${input.reason}`, { previousBasis: d.basis, previousKind: d.basisKind });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.date_adjusted", entityType: "matter", entityId: m.id, summary: `${d.label} on matter ${m.ref}: ${d.dueOn} → ${input.dueOn}`, ip: ctx.ip }, tx);
    return updated;
  });
}

export async function completeDate(ctx: AccessContext, firmId: string, matterId: string, dateId: string, done: boolean) {
  requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId);
    const [d] = await tx.update(matterDates).set({ completedAt: done ? new Date() : null, updatedAt: new Date() }).where(and(eq(matterDates.id, dateId), eq(matterDates.matterId, m.id))).returning();
    if (!d) throw new NotFoundError("Date");
    await logActivity(tx, ctx, m, "date", `${d.label}: ${done ? "marked done" : "reopened"}`);
    return d;
  });
}

/* ───────── Lists used by other screens ───────── */

export async function mattersForClient(ctx: AccessContext, firmId: string, clientId: string) {
  if (!canViewMatters(ctx, firmId)) return null;
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select({ id: matters.id, ref: matters.ref, title: matters.title, restricted: matters.restricted, stageName: matterStages.name, stageCategory: matterStages.category, openedAt: matters.openedAt })
      .from(matters)
      .innerJoin(matterStages, eq(matterStages.id, matters.stageId))
      .where(and(eq(matters.clientId, clientId), ...matterVisibility(ctx, firmId)))
      .orderBy(desc(matters.openedAt)),
  );
}

/** Choices for "open a matter": clients, services, team, accepted proposals not yet opened. */
export async function matterFormOptions(ctx: AccessContext, firmId: string, clientId?: string) {
  ctx.require("matters:create", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const clientRows = await tx
      .select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName, sourceLeadId: clients.sourceLeadId })
      .from(clients)
      .where(and(eq(clients.firmId, firmId), isNull(clients.deletedAt), eq(clients.status, "active")))
      .orderBy(asc(clients.firstName))
      .limit(500);
    const svc = await tx.select({ id: services.id, name: services.name, code: services.code }).from(services).where(and(eq(services.firmId, firmId), eq(services.isActive, true))).orderBy(asc(services.name));
    const team = await tx.execute<{ id: string; name: string }>(sql`select u.id, u.name from firm_memberships m join users u on u.id = m.user_id
      where m.firm_id = ${firmId} and m.status = 'active' and u.status = 'active' order by u.name`);
    const leadIds = clientRows.filter((c) => !clientId || c.id === clientId).map((c) => c.sourceLeadId).filter((x): x is string => !!x);
    const accepted = leadIds.length
      ? await tx
          .select({ id: proposals.id, ref: proposals.ref, title: proposals.title, leadId: proposals.leadId })
          .from(proposals)
          .where(and(eq(proposals.firmId, firmId), eq(proposals.status, "accepted"), inArray(proposals.leadId, leadIds), sql`not exists (select 1 from matters m where m.proposal_id = ${proposals.id} and m.deleted_at is null)`))
      : [];
    return { clients: clientRows, services: svc, team: team.rows, proposals: accepted.map((p) => ({ ...p, clientId: clientRows.find((c) => c.sourceLeadId === p.leadId)?.id ?? null })) };
  });
}

/** Open tasks on a matter (for the matter page). */
export async function matterTaskCount(tx: Tx, matterId: string) {
  const [{ n }] = await tx.select({ n: count() }).from(tasks).where(and(eq(tasks.matterId, matterId), eq(tasks.status, "open")));
  return Number(n);
}

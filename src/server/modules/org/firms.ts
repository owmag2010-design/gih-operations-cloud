import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { db, withScope } from "../../db/client";
import { departments, firmMemberships, firmOffices, firms, offices, pipelineStages, roles, services } from "../../db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { optionalEmail, optionalText, parseOrThrow } from "../../validation";
import { DEFAULT_PIPELINE } from "../crm/pipeline-defaults";

const bool = z.union([z.literal("on"), z.literal("true"), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true");

const profileSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name.").max(160),
  tradingName: z.string().trim().min(2, "Enter the trading name.").max(120),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1f3a5f."),
  website: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^https:\/\/[^\s]+\.[^\s]+$/.test(v), "Use a full https:// address."),
  emailDomain: optionalText(120),
  contactEmail: optionalEmail,
  contactPhone: optionalText(40),
  jurisdictions: z.string().optional().default("").transform((s) => [...new Set(s.split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))]),
});

const policySchema = z.object({
  shareAggregateMetrics: bool,
  allowGroupAdminAccess: bool,
  requireMfaForAll: bool,
});

/** Firms visible to the caller: all firms for group users with firms:view, otherwise their own. */
export async function listFirms(ctx: AccessContext) {
  const all = await db().select().from(firms).where(eq(firms.orgId, ctx.orgId)).orderBy(asc(firms.tradingName));
  if (ctx.has("firms:view")) return all;
  return all.filter((f) => ctx.firms.has(f.id));
}

export async function getFirmForSettings(ctx: AccessContext, firmId: string) {
  const canGroup = ctx.has("firms:view");
  const canFirm = ctx.has("firm:view", firmId);
  if (!canGroup && !canFirm) throw new NotFoundError("Firm");
  const [firm] = await db().select().from(firms).where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId))).limit(1);
  if (!firm) throw new NotFoundError("Firm");
  const officeRows = await db()
    .select({ id: offices.id, name: offices.name, kind: offices.kind, city: offices.city, country: offices.country, addressLine1: offices.addressLine1, addressLine2: offices.addressLine2, timezone: offices.timezone })
    .from(firmOffices)
    .innerJoin(offices, eq(offices.id, firmOffices.officeId))
    .where(eq(firmOffices.firmId, firmId));
  const depts = await db().select().from(departments).where(eq(departments.firmId, firmId)).orderBy(asc(departments.name));
  return { firm, offices: officeRows, departments: depts };
}

/** Profile fields: the firm's own administrators, or group users with firms:edit. */
export async function updateFirmProfile(ctx: AccessContext, firmId: string, raw: unknown) {
  if (!ctx.has("firm:manage", firmId) && !ctx.has("firms:edit")) throw new AccessDeniedError("firm:manage");
  const input = parseOrThrow(profileSchema, raw);
  const [firm] = await db()
    .update(firms)
    .set({ ...input, website: input.website ?? null, emailDomain: input.emailDomain ?? null, contactEmail: input.contactEmail ?? null, contactPhone: input.contactPhone ?? null, updatedAt: new Date() })
    .where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId)))
    .returning();
  if (!firm) throw new NotFoundError("Firm");
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "firm.profile_updated", entityType: "firm", entityId: firmId, summary: `Updated ${firm.tradingName} profile`, ip: ctx.ip });
  return firm;
}

/** Data-sharing and security policies belong to the firm itself, not the group. */
export async function updateFirmPolicies(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(policySchema, raw);
  const [firm] = await db().update(firms).set({ ...input, updatedAt: new Date() }).where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId))).returning();
  if (!firm) throw new NotFoundError("Firm");
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "firm.policies_updated", entityType: "firm", entityId: firmId, summary: `Updated ${firm.tradingName} data-sharing and security policies`, data: input, ip: ctx.ip });
  return firm;
}

const createFirmSchema = profileSchema.extend({
  slug: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,30}$/, "Use 2–31 lowercase letters, numbers or hyphens.").refine((v) => !["hub", "hq", "p", "api"].includes(v), "That name is reserved."),
  refPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, "Use 2–4 letters."),
});

/** Create a firm. The creator becomes its first Firm Administrator (audited). */
export async function createFirm(ctx: AccessContext, raw: unknown) {
  ctx.require("firms:create");
  const input = parseOrThrow(createFirmSchema, raw);
  const clash = await db().select({ id: firms.id }).from(firms).where(sql`${firms.slug} = ${input.slug} or ${firms.refPrefix} = ${input.refPrefix}`).limit(1);
  if (clash.length) throw new ConflictError("Another firm already uses that short name or reference prefix.");
  const [adminRole] = await db().select().from(roles).where(and(eq(roles.orgId, ctx.orgId), eq(roles.key, "firm_admin"))).limit(1);
  return db().transaction(async (tx) => {
    const [firm] = await tx
      .insert(firms)
      .values({ ...input, orgId: ctx.orgId, website: input.website ?? null, emailDomain: input.emailDomain ?? null, contactEmail: input.contactEmail ?? null, contactPhone: input.contactPhone ?? null, allowGroupAdminAccess: false })
      .returning();
    await tx.insert(firmMemberships).values({ firmId: firm.id, userId: ctx.user.id, roleId: adminRole.id, createdById: ctx.user.id });
    await tx.execute(sql`select set_config('app.firm_ids', ${firm.id}, true)`);
    for (const [i, st] of DEFAULT_PIPELINE.entries()) await tx.insert(pipelineStages).values({ firmId: firm.id, key: st.key, name: st.name, category: st.category, position: i });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: firm.id, action: "firm.created", entityType: "firm", entityId: firm.id, summary: `Created ${firm.tradingName}; creator is Firm Administrator`, ip: ctx.ip }, tx);
    return firm;
  });
}

/**
 * A Group Super Administrator joins a firm. Only possible when the firm's own
 * policy allows group administrator access. Always audited.
 */
export async function joinFirmAsGroupAdmin(ctx: AccessContext, firmId: string, roleKey = "firm_admin") {
  ctx.require("staff:manage");
  if (ctx.firms.has(firmId)) throw new ConflictError("You are already a member of this firm.");
  const [firm] = await db().select().from(firms).where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId))).limit(1);
  if (!firm) throw new NotFoundError("Firm");
  if (!firm.allowGroupAdminAccess) throw new AccessDeniedError("firm-policy");
  const [role] = await db().select().from(roles).where(and(eq(roles.orgId, ctx.orgId), eq(roles.key, roleKey), eq(roles.scope, "firm"))).limit(1);
  if (!role) throw new ValidationError("Unknown role.");
  await db().transaction(async (tx) => {
    await tx.insert(firmMemberships).values({ firmId, userId: ctx.user.id, roleId: role.id, createdById: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "firm.group_admin_joined", entityType: "firm", entityId: firmId, summary: `${ctx.user.name} joined ${firm.tradingName} as ${role.name} using group access`, ip: ctx.ip }, tx);
  });
}

/* ───────────────────────── Departments ───────────────────────── */

export async function addDepartment(ctx: AccessContext, firmId: string, name: string) {
  ctx.require("firm:manage", firmId);
  const n = name.trim();
  if (n.length < 2 || n.length > 80) throw new ValidationError("Use 2–80 characters.", { name: "Use 2–80 characters." });
  const [d] = await db().insert(departments).values({ firmId, name: n }).onConflictDoNothing().returning();
  if (!d) throw new ConflictError("That department already exists.");
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "firm.department_added", entityType: "department", entityId: d.id, summary: `Added department ${n}`, ip: ctx.ip });
}

/* ───────────────────────── Pipeline configuration ───────────────────────── */

export async function addStage(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(z.object({ name: z.string().trim().min(2).max(60), category: z.enum(["open", "lost", "closed"]) }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const existing = await tx.select().from(pipelineStages).where(eq(pipelineStages.firmId, firmId)).orderBy(asc(pipelineStages.position));
    let key = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "stage";
    while (existing.some((s) => s.key === key)) key = `${key}_2`;
    // New open stages go before the first closing stage.
    const firstClosing = existing.find((s) => s.category !== "open");
    const position = input.category === "open" && firstClosing ? firstClosing.position : (existing.at(-1)?.position ?? -1) + 1;
    for (const s of existing.filter((x) => x.position >= position)) await tx.update(pipelineStages).set({ position: s.position + 1 }).where(eq(pipelineStages.id, s.id));
    await tx.insert(pipelineStages).values({ firmId, key, name: input.name, category: input.category, position });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "pipeline.stage_added", entityType: "pipeline_stage", summary: `Added stage ${input.name}`, ip: ctx.ip }, tx);
  });
}

export async function updateStage(ctx: AccessContext, firmId: string, stageId: string, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(z.object({ name: z.string().trim().min(2).max(60), isActive: bool }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [stage] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.firmId, firmId)));
    if (!stage) throw new NotFoundError("Stage");
    if (!input.isActive && stage.isActive) {
      const used = await tx.execute(sql`select 1 from leads where stage_id = ${stageId} and deleted_at is null limit 1`);
      if (used.rows.length) throw new ValidationError("Move the leads out of this stage before hiding it.");
      const openLeft = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.firmId, firmId), eq(pipelineStages.isActive, true), eq(pipelineStages.category, stage.category)));
      if (openLeft.length <= 1 && (stage.category === "open" || stage.category === "won")) throw new ValidationError("Keep at least one active stage of this kind.");
    }
    await tx.update(pipelineStages).set({ name: input.name, isActive: input.isActive }).where(eq(pipelineStages.id, stageId));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "pipeline.stage_updated", entityType: "pipeline_stage", entityId: stageId, summary: `Stage “${stage.name}” → “${input.name}”${input.isActive ? "" : " (hidden)"}`, ip: ctx.ip }, tx);
  });
}

export async function moveStage(ctx: AccessContext, firmId: string, stageId: string, direction: "up" | "down") {
  ctx.require("firm:manage", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.firmId, firmId)).orderBy(asc(pipelineStages.position));
    const i = stages.findIndex((s) => s.id === stageId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= stages.length) return;
    await tx.update(pipelineStages).set({ position: stages[j].position }).where(eq(pipelineStages.id, stages[i].id));
    await tx.update(pipelineStages).set({ position: stages[i].position }).where(eq(pipelineStages.id, stages[j].id));
  });
}

/* ───────────────────────── Service catalogue (read-only in Release 1) ───────────────────────── */

export async function listServices(ctx: AccessContext, firmId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx.select().from(services).where(eq(services.firmId, firmId)).orderBy(asc(services.category), asc(services.name)),
  );
}

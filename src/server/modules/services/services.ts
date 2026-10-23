import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { servicePriceVersions, services, users, type ServiceLine } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../errors";
import { parseOrThrow } from "../../validation";
import { slugify } from "./fee-schedule";

/** "12,500", "R 12 500.00" or "12500" → 1250000 minor units. */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100);
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[R$A£€\s,]/gi, "").replace(/^ZAR|^AUD|^USD/i, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const money = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const m = parseMoney(v);
    if (m === null) {
      ctx.addIssue({ code: "custom", message: `Enter ${label} as an amount, for example 12500.` });
      return z.NEVER;
    }
    return m;
  });

const lineSchema = z.object({
  label: z.string().trim().min(1, "Name this line.").max(120),
  amount: money("the line amount"),
  kind: z.enum(["professional", "government", "third_party"]).default("third_party"),
});

const serviceSchema = z
  .object({
    name: z.string().trim().min(3, "Enter the service name.").max(160),
    category: z.string().trim().min(1, "Choose a category.").max(80),
    jurisdiction: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country.").default("ZA"),
    currency: z.enum(["ZAR", "AUD", "USD", "GBP", "EUR"]).default("ZAR"),
    lines: z.array(lineSchema).min(1, "Add at least one fee line.").max(12),
    deposit: money("the deposit"),
    isActive: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true"),
    reason: z.string().trim().min(3, "Say briefly why the fee changed.").max(300),
  })
  .superRefine((v, ctx) => {
    const total = v.lines.reduce((a, l) => a + l.amount, 0);
    if (v.deposit > total) ctx.addIssue({ code: "custom", path: ["deposit"], message: "The deposit can't be more than the total." });
  });

export type ServiceInput = z.input<typeof serviceSchema>;

function toRow(input: z.infer<typeof serviceSchema>) {
  const lines: ServiceLine[] = input.lines.map((l) => ({ label: l.label, amountMinor: l.amount, kind: l.kind }));
  return { lines, totalMinor: lines.reduce((a, l) => a + l.amountMinor, 0), depositMinor: input.deposit };
}

async function nextVersion(tx: Tx, serviceId: string) {
  const [r] = await tx.select({ v: sql<number>`coalesce(max(${servicePriceVersions.version}), 0)` }).from(servicePriceVersions).where(eq(servicePriceVersions.serviceId, serviceId));
  return Number(r?.v ?? 0) + 1;
}

/** The firm's catalogue with the current price version of each service. */
export async function listCatalogue(ctx: AccessContext, firmId: string, opts: { activeOnly?: boolean } = {}) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({
        service: services,
        version: sql<number>`(select max(v.version) from service_price_versions v where v.service_id = ${services.id})`,
      })
      .from(services)
      .where(and(eq(services.firmId, firmId), opts.activeOnly ? eq(services.isActive, true) : undefined))
      .orderBy(asc(services.category), asc(services.name));
    return rows.map((r) => ({ ...r.service, version: Number(r.version ?? 1) }));
  });
}

export async function getServiceWithHistory(ctx: AccessContext, firmId: string, serviceId: string) {
  ctx.require("firm:view", firmId);
  if (!z.string().uuid().safeParse(serviceId).success) throw new NotFoundError("Service");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [service] = await tx.select().from(services).where(and(eq(services.id, serviceId), eq(services.firmId, firmId)));
    if (!service) throw new NotFoundError("Service");
    const history = await tx
      .select({ v: servicePriceVersions, changedBy: users.name })
      .from(servicePriceVersions)
      .leftJoin(users, eq(users.id, servicePriceVersions.changedById))
      .where(eq(servicePriceVersions.serviceId, service.id))
      .orderBy(desc(servicePriceVersions.version));
    return { service, history: history.map((h) => ({ ...h.v, changedBy: h.changedBy })) };
  });
}

export async function updateService(ctx: AccessContext, firmId: string, serviceId: string, raw: unknown) {
  ctx.require("services:manage", firmId);
  const input = parseOrThrow(serviceSchema, raw);
  const priced = toRow(input);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [before] = await tx.select().from(services).where(and(eq(services.id, serviceId), eq(services.firmId, firmId))).for("update");
    if (!before) throw new NotFoundError("Service");
    const [service] = await tx
      .update(services)
      .set({ name: input.name, category: input.category, jurisdiction: input.jurisdiction, currency: input.currency, ...priced, isActive: input.isActive, updatedAt: new Date() })
      .where(eq(services.id, before.id))
      .returning();
    const version = await nextVersion(tx, service.id);
    await tx.insert(servicePriceVersions).values({
      firmId, serviceId: service.id, version, name: service.name, currency: service.currency, totalMinor: service.totalMinor, depositMinor: service.depositMinor,
      lines: service.lines, addOns: service.addOns, isActive: service.isActive, reason: input.reason, changedById: ctx.user.id,
    });
    await audit({
      orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "service.updated", entityType: "service", entityId: service.id,
      summary: `Updated ${service.code} to version ${version}`,
      data: { version, totalBefore: before.totalMinor, totalAfter: service.totalMinor, depositBefore: before.depositMinor, depositAfter: service.depositMinor, active: service.isActive },
      ip: ctx.ip,
    }, tx);
    return { service, version };
  });
}

export async function createService(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("services:manage", firmId);
  const input = parseOrThrow(serviceSchema, raw);
  const priced = toRow(input);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const base = slugify(input.name) || "service";
    let code = base;
    for (let i = 2; (await tx.select({ id: services.id }).from(services).where(and(eq(services.firmId, firmId), eq(services.code, code)))).length; i++) {
      if (i > 50) throw new ValidationError("A service with this name already exists.", { name: "A service with this name already exists." });
      code = `${base}-${i}`;
    }
    const [service] = await tx
      .insert(services)
      .values({ firmId, code, name: input.name, category: input.category, jurisdiction: input.jurisdiction, currency: input.currency, ...priced, isActive: input.isActive, sourceNote: "Added in the app" })
      .returning();
    await tx.insert(servicePriceVersions).values({
      firmId, serviceId: service.id, version: 1, name: service.name, currency: service.currency, totalMinor: service.totalMinor, depositMinor: service.depositMinor,
      lines: service.lines, addOns: service.addOns, isActive: service.isActive, reason: input.reason, changedById: ctx.user.id,
    });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "service.created", entityType: "service", entityId: service.id, summary: `Added service ${service.code}`, ip: ctx.ip }, tx);
    return service;
  });
}

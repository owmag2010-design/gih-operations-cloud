import "server-only";
import { and, asc, count, desc, eq, gte, inArray, ne, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { db, withScope, type Tx } from "../../db/client";
import { firms, intakeItems, routingRules, users } from "../../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { normalisePhone, optionalCountry, optionalEmail, optionalText, parseOrThrow } from "../../validation";
import { createLead, LEAD_SOURCES } from "../crm/leads";
import { decideRoute, type RuleLike } from "./routing";

export const intakeSchema = z
  .object({
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
    sourceRef: optionalText(200),
    consentContact: z.union([z.boolean(), z.literal("on"), z.literal("true")]).optional().transform((v) => v === true || v === "on" || v === "true"),
  })
  .refine((v) => v.email || v.phone, { message: "Add an email address or a phone number.", path: ["email"] });

async function loadRules(tx: Tx, orgId: string): Promise<RuleLike[]> {
  return tx.select().from(routingRules).where(eq(routingRules.orgId, orgId)).orderBy(asc(routingRules.position));
}

/** Store an enquiry and attach a routing suggestion. Idempotent on (source, sourceRef). */
export async function storeIntake(tx: Tx, orgId: string, raw: unknown, actorId: string | null) {
  const input = parseOrThrow(intakeSchema, raw);
  if (input.sourceRef) {
    const [existing] = await tx.select().from(intakeItems).where(and(eq(intakeItems.source, input.source), eq(intakeItems.sourceRef, input.sourceRef))).limit(1);
    if (existing) return { item: existing, created: false };
  }
  const decision = decideRoute(await loadRules(tx, orgId), input);
  const phone = normalisePhone(input.phone, input.currentCountry);

  // Possible duplicate: the same contact sent another enquiry in the last 30 days.
  const contact: SQL[] = [];
  if (input.email) contact.push(eq(intakeItems.email, input.email));
  if (phone) contact.push(eq(intakeItems.phone, phone));
  const [{ n }] = await tx.select({ n: count() }).from(intakeItems).where(and(eq(intakeItems.orgId, orgId), or(...contact), gte(intakeItems.receivedAt, new Date(Date.now() - 30 * 864e5))));
  const flags = [...decision.flags, ...(n > 0 ? ["possible_duplicate"] : [])];

  const [item] = await tx
    .insert(intakeItems)
    .values({
      orgId,
      status: decision.action === "route" ? "new" : "held",
      firstName: input.firstName, lastName: input.lastName, email: input.email, phone,
      nationality: input.nationality, currentCountry: input.currentCountry, destinationCountry: input.destinationCountry,
      immigrationCategory: input.immigrationCategory, enquiry: input.enquiry, source: input.source, sourceRef: input.sourceRef,
      consentContact: input.consentContact,
      suggestedFirmId: decision.firmId, suggestedRuleId: decision.ruleId, suggestionReason: decision.reason, flags,
    })
    .onConflictDoNothing({ target: [intakeItems.source, intakeItems.sourceRef] })
    .returning();
  if (!item) {
    const [existing] = await tx.select().from(intakeItems).where(and(eq(intakeItems.source, input.source), eq(intakeItems.sourceRef, input.sourceRef!))).limit(1);
    return { item: existing, created: false };
  }
  await audit({ orgId, actorId, action: "intake.received", entityType: "intake_item", entityId: item.id, summary: `Enquiry received via ${input.source}`, data: { suggestion: decision.reason, flags } }, tx);
  return { item, created: true };
}

/** Machine intake (signed webhook). No user; scoped to intake only. */
export async function receiveIntake(orgId: string, raw: unknown) {
  return withScope({ orgId, userId: null, firmIds: [], intake: true }, (tx) => storeIntake(tx, orgId, raw, null));
}

/** Staff capture an enquiry by hand (phone call, walk-in). */
export async function captureIntake(ctx: AccessContext, raw: unknown) {
  ctx.require("intake:create");
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, (tx) => storeIntake(tx, ctx.orgId, raw, ctx.user.id));
}

export async function listIntake(ctx: AccessContext, status: "open" | "routed" | "rejected" | "all" = "open") {
  ctx.require("intake:view");
  const where =
    status === "open" ? inArray(intakeItems.status, ["new", "held"])
    : status === "routed" ? eq(intakeItems.status, "routed")
    : status === "rejected" ? inArray(intakeItems.status, ["rejected", "duplicate"])
    : undefined;
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, async (tx) => {
    const rows = await tx
      .select()
      .from(intakeItems)
      .where(and(eq(intakeItems.orgId, ctx.orgId), where))
      .orderBy(status === "open" ? asc(intakeItems.receivedAt) : desc(intakeItems.receivedAt))
      .limit(200);
    const counts = await tx
      .select({ status: intakeItems.status, n: count() })
      .from(intakeItems)
      .where(eq(intakeItems.orgId, ctx.orgId))
      .groupBy(intakeItems.status);
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
  });
}

export async function getIntakeItem(ctx: AccessContext, id: string) {
  ctx.require("intake:view");
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Enquiry");
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, async (tx) => {
    const [item] = await tx.select().from(intakeItems).where(eq(intakeItems.id, id)).limit(1);
    if (!item) throw new NotFoundError("Enquiry");
    const routedBy = item.routedById ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, item.routedById)))[0]?.name ?? null : null;
    return { item, routedBy };
  });
}

/**
 * Route an enquiry into a firm: creates the lead there and closes the intake
 * item. The router does not gain access to the firm's records by doing this.
 */
export async function routeIntakeItem(ctx: AccessContext, itemId: string, firmId: string, note?: string) {
  ctx.require("intake:route");
  if (!z.string().uuid().safeParse(itemId).success || !z.string().uuid().safeParse(firmId).success) throw new NotFoundError("Enquiry");
  const [firm] = await db().select().from(firms).where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId), eq(firms.status, "active"))).limit(1);
  if (!firm) throw new ValidationError("Choose an active firm.");

  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [firmId], intake: true }, async (tx) => {
    const [item] = await tx.select().from(intakeItems).where(eq(intakeItems.id, itemId)).for("update").limit(1);
    if (!item) throw new NotFoundError("Enquiry");
    if (item.status === "routed") throw new ConflictError("This enquiry has already been routed.");
    if (item.status === "rejected" || item.status === "duplicate") throw new ConflictError("This enquiry was closed. Reopen it before routing.");

    const { lead } = await createLead(
      ctx,
      firmId,
      {
        firstName: item.firstName, lastName: item.lastName ?? undefined, email: item.email ?? undefined, phone: item.phone ?? undefined,
        nationality: item.nationality ?? undefined, currentCountry: item.currentCountry ?? undefined, destinationCountry: item.destinationCountry ?? undefined,
        immigrationCategory: item.immigrationCategory ?? undefined, enquiry: item.enquiry ?? undefined,
        source: "hub_intake", sourceDetail: `Received by ${item.source.replace(/_/g, " ")}`,
        priority: item.flags.includes("urgent") ? "urgent" : "normal",
        tags: item.flags.filter((f) => f !== "possible_duplicate").join(","),
        consentContact: item.consentContact, consentMethod: "Given on the Hub enquiry",
      },
      { tx, intakeItemId: item.id, skipPermission: true },
    );
    await tx
      .update(intakeItems)
      .set({ status: "routed", routedFirmId: firmId, routedLeadId: lead.id, routedById: ctx.user.id, routedAt: new Date(), note: note?.trim().slice(0, 1000) || item.note })
      .where(eq(intakeItems.id, item.id));
    const followedSuggestion = item.suggestedFirmId === firmId;
    await audit(
      {
        orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "intake.routed", entityType: "intake_item", entityId: item.id,
        summary: `Routed enquiry to ${firm.tradingName} as ${lead.ref}${followedSuggestion ? "" : " (overrode suggestion)"}`,
        data: { leadId: lead.id, suggestedFirmId: item.suggestedFirmId, followedSuggestion }, ip: ctx.ip,
      },
      tx,
    );
    return { leadRef: lead.ref, firmName: firm.tradingName };
  });
}

export async function setIntakeStatus(ctx: AccessContext, itemId: string, status: "held" | "rejected" | "duplicate" | "new", note?: string) {
  ctx.require("intake:route");
  if (!z.string().uuid().safeParse(itemId).success) throw new NotFoundError("Enquiry");
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, async (tx) => {
    const [item] = await tx.select().from(intakeItems).where(and(eq(intakeItems.id, itemId), ne(intakeItems.status, "routed"))).for("update").limit(1);
    if (!item) throw new NotFoundError("Enquiry");
    await tx.update(intakeItems).set({ status, note: note?.trim().slice(0, 1000) || item.note }).where(eq(intakeItems.id, item.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: `intake.${status === "new" ? "reopened" : status}`, entityType: "intake_item", entityId: item.id, data: { withNote: !!note?.trim() }, ip: ctx.ip }, tx);
  });
}

/* ───────────────────────── Routing rules ───────────────────────── */

const ruleSchema = z.object({
  name: z.string().trim().min(3, "Name the rule.").max(160),
  action: z.enum(["route", "hold", "consult"]),
  targetFirmId: z.string().optional().transform((v) => (v ? v : null)),
  flag: optionalText(40),
  keywords: z.string().optional().default(""),
  currentCountries: z.string().optional().default(""),
  destinations: z.string().optional().default(""),
  isActive: z.union([z.literal("on"), z.literal("true"), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

const list = (s: string, upper = false) =>
  [...new Set(s.split(",").map((x) => (upper ? x.trim().toUpperCase() : x.trim().toLowerCase())).filter(Boolean))].slice(0, 60);

export async function listRules(ctx: AccessContext) {
  if (!ctx.has("routing:manage") && !ctx.has("intake:view")) ctx.require("routing:manage");
  return db().select().from(routingRules).where(eq(routingRules.orgId, ctx.orgId)).orderBy(asc(routingRules.position));
}

export async function saveRule(ctx: AccessContext, ruleId: string | null, raw: unknown) {
  ctx.require("routing:manage");
  const input = parseOrThrow(ruleSchema, raw);
  if (input.action === "route" && !input.targetFirmId) throw new ValidationError("Choose the firm to route to.", { targetFirmId: "Required for routing." });
  if (input.targetFirmId) {
    const [f] = await db().select({ id: firms.id }).from(firms).where(and(eq(firms.id, input.targetFirmId), eq(firms.orgId, ctx.orgId)));
    if (!f) throw new ValidationError("Choose a firm.", { targetFirmId: "Unknown firm." });
  }
  const match = {
    ...(list(input.keywords).length ? { keywordsAny: list(input.keywords) } : {}),
    ...(list(input.currentCountries, true).length ? { currentCountryIn: list(input.currentCountries, true) } : {}),
    ...(list(input.destinations, true).length ? { destinationIn: list(input.destinations, true) } : {}),
  };
  const values = { name: input.name, action: input.action, targetFirmId: input.targetFirmId, flag: input.flag ?? null, match, isActive: input.isActive, updatedAt: new Date() };
  if (ruleId) {
    const [r] = await db().update(routingRules).set(values).where(and(eq(routingRules.id, ruleId), eq(routingRules.orgId, ctx.orgId))).returning();
    if (!r) throw new NotFoundError("Rule");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "routing.rule_updated", entityType: "routing_rule", entityId: r.id, summary: `Updated rule “${r.name}”`, ip: ctx.ip });
    return r;
  }
  const existing = await listRules(ctx);
  // New rules go before the catch-all (last rule with an empty match).
  const catchAll = [...existing].reverse().find((r) => Object.keys(r.match ?? {}).length === 0);
  const position = catchAll ? catchAll.position : (existing.at(-1)?.position ?? 0) + 1;
  return db().transaction(async (tx) => {
    if (catchAll) for (const r of existing.filter((x) => x.position >= position)) await tx.update(routingRules).set({ position: r.position + 1 }).where(eq(routingRules.id, r.id));
    const [r] = await tx.insert(routingRules).values({ ...values, orgId: ctx.orgId, position }).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "routing.rule_created", entityType: "routing_rule", entityId: r.id, summary: `Created rule “${r.name}”`, ip: ctx.ip }, tx);
    return r;
  });
}

export async function moveRule(ctx: AccessContext, ruleId: string, direction: "up" | "down") {
  ctx.require("routing:manage");
  const rules = await listRules(ctx);
  const i = rules.findIndex((r) => r.id === ruleId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rules.length) return;
  await db().transaction(async (tx) => {
    await tx.update(routingRules).set({ position: rules[j].position }).where(eq(routingRules.id, rules[i].id));
    await tx.update(routingRules).set({ position: rules[i].position }).where(eq(routingRules.id, rules[j].id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "routing.rule_moved", entityType: "routing_rule", entityId: ruleId, data: { direction }, ip: ctx.ip }, tx);
  });
}

/** Dry-run the rules against sample text (used by the rule editor). */
export async function previewRouting(ctx: AccessContext, sample: { enquiry?: string; currentCountry?: string; destinationCountry?: string }) {
  if (!ctx.has("routing:manage") && !ctx.has("intake:view")) ctx.require("routing:manage");
  return decideRoute(await listRules(ctx), sample);
}

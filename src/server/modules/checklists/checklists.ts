import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, max, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import {
  activities,
  checklistTemplateItems,
  checklistTemplates,
  countryProfiles,
  documentFiles,
  documentRequestEvents,
  documentRequests,
  jurisdictionSources,
  matterChecklists,
  matterPeople,
  services,
  users,
} from "../../db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { isCountryCode } from "@/lib/countries";
import { optionalText, optionalUuid, parseOrThrow } from "../../validation";
import { isIsoDate } from "../matters/dates";
import { loadVisibleMatter } from "../matters/matters";

/*
 * Document checklists (practice templates, per destination country and
 * optionally per service) and document requests on matters.
 *
 * Templates are versioned. Only a draft can change; publishing locks it (also
 * in the database) and retires the family's previous published version. A
 * matter keeps the version it was given, so editing a checklist never changes
 * existing matters. A checklist can only be published for a country whose
 * profile has been reviewed (verified or operational).
 *
 * Requests move: requested → received (a file is attached) → under review →
 * accepted (a reviewer, and an expiry date when the item tracks one) or
 * rejected (a note; the client is asked for a replacement). Any open request
 * can be waived with a reason. Every change is kept in document_request_events.
 */

export type RequestStatus = (typeof documentRequests.$inferSelect)["status"];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  requested: "Requested",
  received: "Received",
  under_review: "Under review",
  accepted: "Accepted",
  rejected: "Replacement requested",
  waived: "Waived",
};
export const APPLIES_TO_LABELS = {
  matter: "Once for the matter",
  main_applicant: "Main applicant",
  each_applicant: "Each applicant",
  partner: "Partner",
  dependants: "Each dependant",
  sponsor: "Sponsor",
} as const;
type AppliesTo = keyof typeof APPLIES_TO_LABELS;

const SETTLED: RequestStatus[] = ["accepted", "waived"];

/* ───────── Templates ───────── */

function requireManage(ctx: AccessContext, firmId: string) {
  ctx.require("firm:manage", firmId);
}

async function loadTemplate(tx: Tx, firmId: string, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Checklist");
  const q = tx.select().from(checklistTemplates).where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.firmId, firmId)));
  const [t] = lock ? await q.for("update") : await q;
  if (!t) throw new NotFoundError("Checklist");
  return t;
}

function assertDraft(t: typeof checklistTemplates.$inferSelect) {
  if (t.status !== "draft") throw new ConflictError(`Version ${t.version} is ${t.status}. Start a new version to make changes.`);
}

/** Every version of every checklist in the practice, newest version first within each. */
export async function listChecklistTemplates(ctx: AccessContext, firmId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({
        t: checklistTemplates,
        serviceName: services.name,
        items: sql<number>`(select count(*)::int from checklist_template_items i where i.template_id = ${checklistTemplates.id})`,
        inUse: sql<number>`(select count(*)::int from matter_checklists mc where mc.template_id = ${checklistTemplates.id})`,
        publishedBy: sql<string | null>`(select name from users u where u.id = ${checklistTemplates.publishedById})`,
      })
      .from(checklistTemplates)
      .leftJoin(services, eq(services.id, checklistTemplates.serviceId))
      .where(eq(checklistTemplates.firmId, firmId))
      .orderBy(asc(checklistTemplates.countryCode), asc(checklistTemplates.name), desc(checklistTemplates.version));
    return rows.map((r) => ({ ...r.t, serviceName: r.serviceName, itemCount: r.items, inUse: r.inUse, publishedBy: r.publishedBy }));
  });
}

export async function getChecklistTemplate(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const t = await loadTemplate(tx, firmId, id);
    const items = await tx.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, t.id)).orderBy(asc(checklistTemplateItems.position));
    const versions = await tx
      .select({ id: checklistTemplates.id, version: checklistTemplates.version, status: checklistTemplates.status, publishedAt: checklistTemplates.publishedAt, changeNote: checklistTemplates.changeNote })
      .from(checklistTemplates)
      .where(eq(checklistTemplates.familyId, t.familyId))
      .orderBy(desc(checklistTemplates.version));
    const [source] = t.sourceId ? await tx.select({ title: jurisdictionSources.title, url: jurisdictionSources.url, status: jurisdictionSources.status }).from(jurisdictionSources).where(eq(jurisdictionSources.id, t.sourceId)) : [];
    const [service] = t.serviceId ? await tx.select({ name: services.name }).from(services).where(eq(services.id, t.serviceId)) : [];
    const [country] = await tx.select({ name: countryProfiles.name, status: countryProfiles.status }).from(countryProfiles).where(and(eq(countryProfiles.orgId, ctx.orgId), eq(countryProfiles.code, t.countryCode)));
    const sources = await tx
      .select({ id: jurisdictionSources.id, title: jurisdictionSources.title, status: jurisdictionSources.status })
      .from(jurisdictionSources)
      .where(and(eq(jurisdictionSources.orgId, ctx.orgId), eq(jurisdictionSources.countryCode, t.countryCode)))
      .orderBy(asc(jurisdictionSources.title));
    return { template: t, items, versions, source: source ?? null, service: service ?? null, country: country ?? null, sources };
  });
}

const templateSchema = z.object({
  name: z.string().trim().min(3, "Name the checklist.").max(120),
  countryCode: z.string().trim().toUpperCase().refine(isCountryCode, "Choose the destination country."),
  serviceId: optionalUuid,
  sourceId: optionalUuid,
  sourceNote: optionalText(500),
});

async function assertTemplateRefs(tx: Tx, ctx: AccessContext, firmId: string, input: { countryCode: string; serviceId?: string; sourceId?: string }) {
  if (input.serviceId) {
    const [svc] = await tx.select({ jurisdiction: services.jurisdiction }).from(services).where(and(eq(services.id, input.serviceId), eq(services.firmId, firmId)));
    if (!svc) throw new ValidationError("Choose a service from this practice.", { serviceId: "Choose a service from this practice." });
    if (svc.jurisdiction !== input.countryCode) throw new ValidationError(`That service is for ${svc.jurisdiction}, not ${input.countryCode}.`, { serviceId: "The service is for another country." });
  }
  if (input.sourceId) {
    const [src] = await tx.select({ country: jurisdictionSources.countryCode }).from(jurisdictionSources).where(and(eq(jurisdictionSources.id, input.sourceId), eq(jurisdictionSources.orgId, ctx.orgId)));
    if (!src || src.country !== input.countryCode) throw new ValidationError("Choose a source for the same country.", { sourceId: "Choose a source for the same country." });
  }
}

export async function createChecklistTemplate(ctx: AccessContext, firmId: string, raw: unknown) {
  requireManage(ctx, firmId);
  const input = parseOrThrow(templateSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    await assertTemplateRefs(tx, ctx, firmId, input);
    const [t] = await tx
      .insert(checklistTemplates)
      .values({ firmId, familyId: randomUUID(), version: 1, name: input.name, countryCode: input.countryCode, serviceId: input.serviceId ?? null, sourceId: input.sourceId ?? null, sourceNote: input.sourceNote ?? null, status: "draft", createdById: ctx.user.id })
      .returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "checklist.created", entityType: "checklist_template", entityId: t.id, summary: `Started checklist "${t.name}" (${t.countryCode}) as a draft`, ip: ctx.ip }, tx);
    return t;
  });
}

export async function updateChecklistDraft(ctx: AccessContext, firmId: string, id: string, raw: unknown) {
  requireManage(ctx, firmId);
  const input = parseOrThrow(templateSchema.omit({ countryCode: true }).extend({ changeNote: optionalText(500) }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const t = await loadTemplate(tx, firmId, id, true);
    assertDraft(t);
    await assertTemplateRefs(tx, ctx, firmId, { ...input, countryCode: t.countryCode });
    const [u] = await tx
      .update(checklistTemplates)
      .set({ name: input.name, serviceId: input.serviceId ?? null, sourceId: input.sourceId ?? null, sourceNote: input.sourceNote ?? null, changeNote: input.changeNote ?? null, updatedAt: new Date() })
      .where(eq(checklistTemplates.id, t.id))
      .returning();
    return u;
  });
}

const itemSchema = z.object({
  label: z.string().trim().min(2, "Name the document.").max(160),
  guidance: optionalText(1000),
  appliesTo: z.enum(Object.keys(APPLIES_TO_LABELS) as [AppliesTo, ...AppliesTo[]]).default("main_applicant"),
  required: z.union([z.boolean(), z.literal("on"), z.literal(""), z.literal("true"), z.literal("false")]).optional().transform((v) => v === true || v === "on" || v === "true"),
  tracksExpiry: z.union([z.boolean(), z.literal("on"), z.literal(""), z.literal("true"), z.literal("false")]).optional().transform((v) => v === true || v === "on" || v === "true"),
  clientVisible: z.union([z.boolean(), z.literal("on"), z.literal(""), z.literal("true"), z.literal("false")]).optional().transform((v) => v === undefined || v === true || v === "on" || v === "true"),
});

export async function addChecklistItem(ctx: AccessContext, firmId: string, templateId: string, raw: unknown) {
  requireManage(ctx, firmId);
  const input = parseOrThrow(itemSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const t = await loadTemplate(tx, firmId, templateId, true);
    assertDraft(t);
    const [{ p }] = await tx.select({ p: max(checklistTemplateItems.position) }).from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, t.id));
    const [item] = await tx.insert(checklistTemplateItems).values({ firmId, templateId: t.id, position: (p ?? -1) + 1, ...input, guidance: input.guidance ?? null }).returning();
    return item;
  });
}

export async function removeChecklistItem(ctx: AccessContext, firmId: string, templateId: string, itemId: string) {
  requireManage(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const t = await loadTemplate(tx, firmId, templateId, true);
    assertDraft(t);
    const [gone] = await tx.delete(checklistTemplateItems).where(and(eq(checklistTemplateItems.id, itemId), eq(checklistTemplateItems.templateId, t.id))).returning();
    if (!gone) throw new NotFoundError("Item");
  });
}

/** Publish a draft: locks it, retires the previous published version. The destination country must have been reviewed. */
export async function publishChecklistTemplate(ctx: AccessContext, firmId: string, id: string) {
  requireManage(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const t = await loadTemplate(tx, firmId, id, true);
    assertDraft(t);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, t.id));
    if (!n) throw new ValidationError("Add at least one document before publishing.");
    const [country] = await tx.select({ status: countryProfiles.status }).from(countryProfiles).where(and(eq(countryProfiles.orgId, ctx.orgId), eq(countryProfiles.code, t.countryCode)));
    if (!country || (country.status !== "verified" && country.status !== "operational")) {
      throw new ValidationError(`${t.countryCode}'s country profile ${country ? `is ${country.status.replace("_", " ")}` : "doesn't exist"}. A checklist for a country can be published once a Hub reviewer has verified that country (Settings › Countries).`);
    }
    if (!t.sourceId && !t.sourceNote) throw new ValidationError("Record where this checklist comes from: choose a source or describe it.", { sourceNote: "Add the source." });
    const retired = await tx
      .update(checklistTemplates)
      .set({ status: "retired", updatedAt: new Date() })
      .where(and(eq(checklistTemplates.familyId, t.familyId), eq(checklistTemplates.status, "published")))
      .returning({ version: checklistTemplates.version });
    const [p] = await tx.update(checklistTemplates).set({ status: "published", publishedById: ctx.user.id, publishedAt: new Date(), updatedAt: new Date() }).where(eq(checklistTemplates.id, t.id)).returning();
    await audit({
      orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "checklist.published", entityType: "checklist_template", entityId: p.id,
      summary: `Published "${p.name}" (${p.countryCode}) version ${p.version}${retired.length ? `; version ${retired.map((r) => r.version).join(", ")} retired` : ""}`, ip: ctx.ip,
    }, tx);
    return p;
  });
}

/** Start the next version as a draft copy. Matters that use earlier versions keep them. */
export async function newChecklistVersion(ctx: AccessContext, firmId: string, id: string) {
  requireManage(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const base = await loadTemplate(tx, firmId, id);
    const [draft] = await tx.select({ version: checklistTemplates.version }).from(checklistTemplates).where(and(eq(checklistTemplates.familyId, base.familyId), eq(checklistTemplates.status, "draft")));
    if (draft) throw new ConflictError(`Version ${draft.version} is already a draft. Edit that one.`);
    const [{ v }] = await tx.select({ v: max(checklistTemplates.version) }).from(checklistTemplates).where(eq(checklistTemplates.familyId, base.familyId));
    const [next] = await tx
      .insert(checklistTemplates)
      .values({ firmId, familyId: base.familyId, version: (v ?? base.version) + 1, name: base.name, countryCode: base.countryCode, serviceId: base.serviceId, sourceId: base.sourceId, sourceNote: base.sourceNote, status: "draft", createdById: ctx.user.id })
      .returning();
    const items = await tx.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, base.id)).orderBy(asc(checklistTemplateItems.position));
    if (items.length) {
      await tx.insert(checklistTemplateItems).values(items.map((i) => ({ firmId, templateId: next.id, position: i.position, label: i.label, guidance: i.guidance, appliesTo: i.appliesTo, required: i.required, tracksExpiry: i.tracksExpiry, clientVisible: i.clientVisible })));
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "checklist.new_version", entityType: "checklist_template", entityId: next.id, summary: `Started version ${next.version} of "${next.name}"`, ip: ctx.ip }, tx);
    return next;
  });
}

export async function retireChecklistTemplate(ctx: AccessContext, firmId: string, id: string) {
  requireManage(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const t = await loadTemplate(tx, firmId, id, true);
    if (t.status !== "published") throw new ValidationError("Only a published version can be retired.");
    const [r] = await tx.update(checklistTemplates).set({ status: "retired", updatedAt: new Date() }).where(eq(checklistTemplates.id, t.id)).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "checklist.retired", entityType: "checklist_template", entityId: t.id, summary: `Retired "${t.name}" version ${t.version}`, ip: ctx.ip }, tx);
    return r;
  });
}

/* ───────── Requests on a matter ───────── */

function requireEdit(ctx: AccessContext, firmId: string) {
  if (!ctx.has("matters:edit", firmId)) throw new AccessDeniedError("matters:edit");
}

async function logEvent(tx: Tx, ctx: AccessContext, r: typeof documentRequests.$inferSelect, from: RequestStatus | null, to: RequestStatus, note: string | null, fileId: string | null) {
  await tx.insert(documentRequestEvents).values({ firmId: r.firmId, matterId: r.matterId, requestId: r.id, fromStatus: from, toStatus: to, fileId, note, actorId: ctx.user.id });
}

async function matterActivity(tx: Tx, ctx: AccessContext, m: { id: string; firmId: string; clientId: string }, body: string, data: Record<string, unknown> = {}) {
  await tx.insert(activities).values({ firmId: m.firmId, clientId: m.clientId, matterId: m.id, type: "matter", body, data, actorId: ctx.user.id });
}

/** Published checklists that fit a matter's destination (and service, when the checklist names one). */
export async function applicableChecklists(tx: Tx, firmId: string, m: { jurisdiction: string | null; serviceId: string | null }) {
  if (!m.jurisdiction) return [];
  return tx
    .select({ id: checklistTemplates.id, name: checklistTemplates.name, version: checklistTemplates.version, countryCode: checklistTemplates.countryCode, serviceId: checklistTemplates.serviceId })
    .from(checklistTemplates)
    .where(and(
      eq(checklistTemplates.firmId, firmId), eq(checklistTemplates.status, "published"), eq(checklistTemplates.countryCode, m.jurisdiction),
      m.serviceId ? or(isNull(checklistTemplates.serviceId), eq(checklistTemplates.serviceId, m.serviceId)) : isNull(checklistTemplates.serviceId),
    ))
    .orderBy(asc(checklistTemplates.name));
}

const PERSON_ROLES: Record<Exclude<AppliesTo, "matter">, string[]> = {
  main_applicant: ["main_applicant"],
  each_applicant: ["main_applicant", "spouse_partner", "dependant_child", "dependant_other"],
  partner: ["spouse_partner"],
  dependants: ["dependant_child", "dependant_other"],
  sponsor: ["sponsor"],
};

/** Apply a published checklist version to a matter: one request per item and person it applies to. */
export async function applyChecklist(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(z.object({
    templateId: z.string().uuid("Choose a checklist."),
    dueOn: z.string().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."),
  }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId, true);
    const t = await loadTemplate(tx, firmId, input.templateId);
    if (t.status !== "published") throw new ValidationError("Only a published checklist can be applied.");
    if (!m.jurisdiction) throw new ValidationError("Set the matter's destination country first.");
    if (t.countryCode !== m.jurisdiction) throw new ValidationError(`This checklist is for ${t.countryCode}; the matter's destination is ${m.jurisdiction}. Checklists aren't reused across countries.`);
    if (t.serviceId && t.serviceId !== m.serviceId) throw new ValidationError("This checklist is for a different service.");
    const [already] = await tx.select({ id: matterChecklists.id }).from(matterChecklists).where(and(eq(matterChecklists.matterId, m.id), eq(matterChecklists.templateId, t.id)));
    if (already) throw new ConflictError("This checklist version is already on the matter.");
    const [mc] = await tx.insert(matterChecklists).values({ firmId, matterId: m.id, templateId: t.id, appliedById: ctx.user.id }).returning();
    const items = await tx.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, t.id)).orderBy(asc(checklistTemplateItems.position));
    const people = await tx.select().from(matterPeople).where(eq(matterPeople.matterId, m.id)).orderBy(asc(matterPeople.position));
    const [{ p }] = await tx.select({ p: max(documentRequests.position) }).from(documentRequests).where(eq(documentRequests.matterId, m.id));
    let position = (p ?? -1) + 1;
    const skipped: string[] = [];
    const rows: (typeof documentRequests.$inferInsert)[] = [];
    for (const item of items) {
      const targets = item.appliesTo === "matter" ? [null] : people.filter((x) => PERSON_ROLES[item.appliesTo as Exclude<AppliesTo, "matter">].includes(x.role));
      if (!targets.length) {
        skipped.push(`${item.label} (${APPLIES_TO_LABELS[item.appliesTo].toLowerCase()}: nobody on the matter)`);
        continue;
      }
      for (const person of targets) {
        rows.push({
          firmId, matterId: m.id, checklistId: mc.id, templateItemId: item.id, personId: person?.id ?? null,
          label: item.label, guidance: item.guidance, required: item.required, tracksExpiry: item.tracksExpiry, clientVisible: item.clientVisible,
          status: "requested", dueOn: input.dueOn ?? null, position: position++, createdById: ctx.user.id,
        });
      }
    }
    const created = rows.length ? await tx.insert(documentRequests).values(rows).returning() : [];
    for (const r of created) await logEvent(tx, ctx, r, null, "requested", `From checklist "${t.name}" v${t.version}`, null);
    await matterActivity(tx, ctx, m, `Applied checklist "${t.name}" v${t.version}: ${created.length} document${created.length === 1 ? "" : "s"} requested`, { templateId: t.id, skipped });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "matter.checklist_applied", entityType: "matter", entityId: m.id, summary: `Applied "${t.name}" v${t.version} to ${m.ref} (${created.length} requests)`, ip: ctx.ip }, tx);
    return { created: created.length, skipped };
  });
}

const adHocSchema = z.object({
  label: z.string().trim().min(2, "Name the document.").max(160),
  guidance: optionalText(1000),
  personId: optionalUuid,
  required: itemSchema.shape.required,
  tracksExpiry: itemSchema.shape.tracksExpiry,
  clientVisible: itemSchema.shape.clientVisible,
  dueOn: z.string().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."),
});

/** A one-off request outside any checklist. */
export async function addDocumentRequest(ctx: AccessContext, firmId: string, matterId: string, raw: unknown) {
  requireEdit(ctx, firmId);
  const input = parseOrThrow(adHocSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const m = await loadVisibleMatter(tx, ctx, firmId, matterId, true);
    if (input.personId) {
      const [person] = await tx.select({ id: matterPeople.id }).from(matterPeople).where(and(eq(matterPeople.id, input.personId), eq(matterPeople.matterId, m.id)));
      if (!person) throw new ValidationError("Choose someone on this matter.", { personId: "Choose someone on this matter." });
    }
    const [{ p }] = await tx.select({ p: max(documentRequests.position) }).from(documentRequests).where(eq(documentRequests.matterId, m.id));
    const [r] = await tx
      .insert(documentRequests)
      .values({ firmId, matterId: m.id, personId: input.personId ?? null, label: input.label, guidance: input.guidance ?? null, required: input.required, tracksExpiry: input.tracksExpiry, clientVisible: input.clientVisible, dueOn: input.dueOn ?? null, status: "requested", position: (p ?? -1) + 1, createdById: ctx.user.id })
      .returning();
    await logEvent(tx, ctx, r, null, "requested", null, null);
    await matterActivity(tx, ctx, m, `Requested ${r.label}`);
    return r;
  });
}

async function loadRequest(tx: Tx, ctx: AccessContext, firmId: string, matterId: string, requestId: string) {
  const m = await loadVisibleMatter(tx, ctx, firmId, matterId, true);
  if (!z.string().uuid().safeParse(requestId).success) throw new NotFoundError("Request");
  const [r] = await tx.select().from(documentRequests).where(and(eq(documentRequests.id, requestId), eq(documentRequests.matterId, m.id))).for("update");
  if (!r) throw new NotFoundError("Request");
  return { m, r };
}

type Step =
  | { kind: "receive"; fileId: string }
  | { kind: "review" }
  | { kind: "accept"; expiresOn?: string; note?: string }
  | { kind: "reject"; note: string }
  | { kind: "waive"; note: string };

const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("receive"), fileId: z.string().uuid("Choose the uploaded file.") }),
  z.object({ kind: z.literal("review") }),
  z.object({ kind: z.literal("accept"), expiresOn: z.string().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."), note: optionalText(1000) }),
  z.object({ kind: z.literal("reject"), note: z.string().trim().min(5, "Say what's wrong so the client knows what to send.").max(1000) }),
  z.object({ kind: z.literal("waive"), note: z.string().trim().min(5, "Say why this document isn't needed.").max(1000) }),
]);

const FROM: Record<Step["kind"], RequestStatus[]> = {
  receive: ["requested", "rejected", "received"],
  review: ["received"],
  accept: ["received", "under_review"],
  reject: ["received", "under_review"],
  waive: ["requested", "rejected", "received", "under_review"],
};
const TO: Record<Step["kind"], RequestStatus> = { receive: "received", review: "under_review", accept: "accepted", reject: "rejected", waive: "waived" };

/** Move a request on. Accepting and rejecting are review decisions (documents:approve); the rest need matters:edit. */
export async function stepDocumentRequest(ctx: AccessContext, firmId: string, matterId: string, requestId: string, raw: unknown) {
  const step = parseOrThrow(stepSchema, raw) as Step;
  if (step.kind === "accept" || step.kind === "reject") {
    if (!ctx.has("documents:approve", firmId)) throw new AccessDeniedError("documents:approve");
  } else requireEdit(ctx, firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const { m, r } = await loadRequest(tx, ctx, firmId, matterId, requestId);
    if (!FROM[step.kind].includes(r.status)) throw new ValidationError(`This request is ${REQUEST_STATUS_LABELS[r.status].toLowerCase()}, so it can't be ${step.kind === "review" ? "put under review" : `${step.kind}ed`}.`);
    const set: Partial<typeof documentRequests.$inferInsert> = { status: TO[step.kind], updatedAt: new Date() };
    let fileId: string | null = null;
    if (step.kind === "receive") {
      const [f] = await tx.select({ id: documentFiles.id, filename: documentFiles.filename }).from(documentFiles).where(and(eq(documentFiles.id, step.fileId), eq(documentFiles.matterId, m.id)));
      if (!f) throw new ValidationError("Choose a file uploaded to this matter.", { fileId: "Choose a file uploaded to this matter." });
      fileId = f.id;
      Object.assign(set, { fileId: f.id, reviewerId: null, reviewedAt: null, note: null, expiresOn: null });
    }
    if (step.kind === "accept") {
      if (r.tracksExpiry && !step.expiresOn) throw new ValidationError("Record the document's expiry date before accepting it.", { expiresOn: "Enter the expiry date." });
      // Staff confirm what the document says; accepting is the confirmation.
      Object.assign(set, { reviewerId: ctx.user.id, reviewedAt: new Date(), expiresOn: step.expiresOn ?? null, note: step.note ?? null });
    }
    if (step.kind === "reject") Object.assign(set, { reviewerId: ctx.user.id, reviewedAt: new Date(), note: step.note });
    if (step.kind === "waive") Object.assign(set, { note: step.note });
    const [u] = await tx.update(documentRequests).set(set).where(eq(documentRequests.id, r.id)).returning();
    await logEvent(tx, ctx, u, r.status, u.status, "note" in step ? (step.note ?? null) : null, fileId);
    await matterActivity(tx, ctx, m, `${r.label}: ${REQUEST_STATUS_LABELS[u.status].toLowerCase()}`, { requestId: r.id, from: r.status, to: u.status });
    return u;
  });
}

/** Requests on a matter with their files, people and history, and what's still outstanding. */
export async function matterRequests(tx: Tx, matterId: string) {
  const rows = await tx
    .select({
      r: documentRequests,
      filename: documentFiles.filename,
      personName: sql<string | null>`(select concat_ws(' ', p.first_name, p.last_name) from matter_people p where p.id = ${documentRequests.personId})`,
      reviewer: users.name,
    })
    .from(documentRequests)
    .leftJoin(documentFiles, eq(documentFiles.id, documentRequests.fileId))
    .leftJoin(users, eq(users.id, documentRequests.reviewerId))
    .where(eq(documentRequests.matterId, matterId))
    .orderBy(asc(documentRequests.position));
  const ids = rows.map((x) => x.r.id);
  const events = ids.length
    ? await tx
        .select({ e: documentRequestEvents, actor: users.name })
        .from(documentRequestEvents)
        .leftJoin(users, eq(users.id, documentRequestEvents.actorId))
        .where(inArray(documentRequestEvents.requestId, ids))
        .orderBy(asc(documentRequestEvents.createdAt))
    : [];
  const checklists = await tx
    .select({ id: matterChecklists.id, name: checklistTemplates.name, version: checklistTemplates.version, status: checklistTemplates.status, appliedAt: matterChecklists.createdAt })
    .from(matterChecklists)
    .innerJoin(checklistTemplates, eq(checklistTemplates.id, matterChecklists.templateId))
    .where(eq(matterChecklists.matterId, matterId))
    .orderBy(asc(matterChecklists.createdAt));
  const requests = rows.map((x) => ({ ...x.r, filename: x.filename, personName: x.personName, reviewer: x.reviewer, history: events.filter((e) => e.e.requestId === x.r.id).map((e) => ({ ...e.e, actor: e.actor })) }));
  const outstanding = requests.filter((x) => x.required && !SETTLED.includes(x.status));
  return { requests, checklists, outstandingRequired: outstanding.length, awaitingReview: requests.filter((x) => x.status === "received" || x.status === "under_review").length };
}

/** Required requests not yet accepted or waived (for the stage gate). */
export async function outstandingRequired(tx: Tx, matterId: string) {
  const rows = await tx
    .select({ label: documentRequests.label })
    .from(documentRequests)
    .where(and(eq(documentRequests.matterId, matterId), eq(documentRequests.required, true), notInArray(documentRequests.status, SETTLED)));
  return rows.map((r) => r.label);
}

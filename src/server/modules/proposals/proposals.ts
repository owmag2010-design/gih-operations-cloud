import "server-only";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { randomToken, sha256 } from "../../auth/crypto";
import { db, withScope, type Tx } from "../../db/client";
import {
  activities,
  firms,
  leads,
  proposalItems,
  proposals,
  proposalVersions,
  servicePriceVersions,
  services,
  users,
  type ProposalSection,
  type ProposalSnapshot,
} from "../../db/schema";
import { env } from "../../env";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { optionalEmail, parseOrThrow } from "../../validation";
import { countryName } from "@/lib/countries";
import { nextRef } from "../refs";
import { parseMoney } from "../services/services";
import { leadVisibility, loadVisibleLead } from "../crm/leads";
import { defaultSections } from "./templates";

export type ProposalStatus = (typeof proposals.$inferSelect)["status"];

/** Which statuses each workflow step may start from. */
const EDITABLE: ProposalStatus[] = ["draft", "changes_requested"];
const OPEN_STATUSES: ProposalStatus[] = ["draft", "in_review", "changes_requested", "approved", "released"];

const uuid = z.string().uuid();
const assertUuid = (id: string, what: string) => {
  if (!uuid.safeParse(id).success) throw new NotFoundError(what);
};

/** Load a proposal whose lead the caller can see (assigned-only roles see only their leads' proposals). */
async function load(tx: Tx, ctx: AccessContext, firmId: string, id: string, lock = false) {
  assertUuid(id, "Proposal");
  const q = tx
    .select({ p: proposals })
    .from(proposals)
    .innerJoin(leads, eq(leads.id, proposals.leadId))
    .where(and(eq(proposals.id, id), eq(proposals.firmId, firmId), ...leadVisibility(ctx, firmId)))
    .limit(1);
  const [row] = lock ? await q.for("update", { of: proposals }) : await q;
  if (!row) throw new NotFoundError("Proposal");
  return row.p;
}

function assertStatus(p: { status: ProposalStatus }, allowed: ProposalStatus[], action: string) {
  if (!allowed.includes(p.status)) throw new ConflictError(`This proposal can't be ${action} while it is ${statusLabel(p.status).toLowerCase()}.`);
}

export function statusLabel(s: ProposalStatus): string {
  return {
    draft: "Draft",
    in_review: "In review",
    changes_requested: "Changes requested",
    approved: "Approved",
    released: "Sent",
    accepted: "Accepted",
    declined: "Declined",
    withdrawn: "Withdrawn",
  }[s];
}

async function recompute(tx: Tx, proposalId: string) {
  const [t] = await tx
    .select({
      total: sql<number>`coalesce(sum(${proposalItems.unitMinor} * ${proposalItems.quantity}), 0)`,
      deposit: sql<number>`coalesce(sum(${proposalItems.depositMinor} * ${proposalItems.quantity}), 0)`,
    })
    .from(proposalItems)
    .where(eq(proposalItems.proposalId, proposalId));
  await tx.update(proposals).set({ totalMinor: Number(t.total), depositMinor: Math.min(Number(t.deposit), Number(t.total)), updatedAt: new Date() }).where(eq(proposals.id, proposalId));
}

async function logActivity(tx: Tx, ctx: AccessContext, p: { firmId: string; leadId: string; id: string; ref: string }, event: string, body: string) {
  await tx.insert(activities).values({ firmId: p.firmId, leadId: p.leadId, type: "proposal", body, actorId: ctx.user.id, data: { proposalId: p.id, ref: p.ref, event } });
}

async function addServiceItem(tx: Tx, firmId: string, proposalId: string, serviceId: string, position: number) {
  assertUuid(serviceId, "Service");
  const [svc] = await tx.select().from(services).where(and(eq(services.id, serviceId), eq(services.firmId, firmId), eq(services.isActive, true)));
  if (!svc) throw new NotFoundError("Service");
  const [v] = await tx.select({ version: sql<number>`max(${servicePriceVersions.version})` }).from(servicePriceVersions).where(eq(servicePriceVersions.serviceId, svc.id));
  await tx.insert(proposalItems).values({
    firmId, proposalId, position, serviceId: svc.id, servicePriceVersion: v?.version ? Number(v.version) : null,
    label: svc.name, description: null, quantity: 1, unitMinor: svc.totalMinor, depositMinor: svc.depositMinor, lines: svc.lines,
  });
  return svc;
}

/* ───────────────────────── Reading ───────────────────────── */

export async function listProposals(ctx: AccessContext, firmId: string, f: { status?: string; leadId?: string } = {}) {
  ctx.require("proposals:view", firmId);
  const conds = [eq(proposals.firmId, firmId), ...leadVisibility(ctx, firmId)];
  if (f.status === "open") conds.push(inArray(proposals.status, OPEN_STATUSES));
  else if (f.status && f.status in { draft: 1, in_review: 1, changes_requested: 1, approved: 1, released: 1, accepted: 1, declined: 1, withdrawn: 1 }) conds.push(eq(proposals.status, f.status as ProposalStatus));
  if (f.leadId && uuid.safeParse(f.leadId).success) conds.push(eq(proposals.leadId, f.leadId));
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({
        id: proposals.id, ref: proposals.ref, title: proposals.title, status: proposals.status, version: proposals.version,
        recipientName: proposals.recipientName, currency: proposals.currency, totalMinor: proposals.totalMinor, updatedAt: proposals.updatedAt,
        leadId: proposals.leadId, leadRef: leads.ref, ownerName: users.name,
      })
      .from(proposals)
      .innerJoin(leads, eq(leads.id, proposals.leadId))
      .leftJoin(users, eq(users.id, proposals.createdById))
      .where(and(...conds))
      .orderBy(desc(proposals.updatedAt))
      .limit(200);
    const counts = await tx
      .select({ status: proposals.status, n: count() })
      .from(proposals)
      .innerJoin(leads, eq(leads.id, proposals.leadId))
      .where(and(eq(proposals.firmId, firmId), ...leadVisibility(ctx, firmId)))
      .groupBy(proposals.status);
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<ProposalStatus, number>> };
  });
}

export async function getProposal(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("proposals:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const proposal = await load(tx, ctx, firmId, id);
    const items = await tx.select().from(proposalItems).where(eq(proposalItems.proposalId, proposal.id)).orderBy(asc(proposalItems.position));
    const [lead] = await tx
      .select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, enquiry: leads.enquiry, convertedClientId: leads.convertedClientId })
      .from(leads)
      .where(eq(leads.id, proposal.leadId));
    const versions = await tx
      .select({ version: proposalVersions.version, createdAt: proposalVersions.createdAt, by: users.name })
      .from(proposalVersions)
      .leftJoin(users, eq(users.id, proposalVersions.createdById))
      .where(eq(proposalVersions.proposalId, proposal.id))
      .orderBy(desc(proposalVersions.version));
    const ids = [proposal.createdById, proposal.updatedById, proposal.approvedById, proposal.releasedById].filter((x): x is string => !!x);
    const people = ids.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
    return {
      proposal, items, lead, versions,
      createdBy: name(proposal.createdById), approvedBy: name(proposal.approvedById), releasedBy: name(proposal.releasedById),
      linkExpired: proposal.status === "released" && !!proposal.linkExpiresAt && proposal.linkExpiresAt <= new Date(),
    };
  });
}

/** The released snapshot for one version, for the staff PDF of what the client saw. */
export async function getProposalSnapshot(ctx: AccessContext, firmId: string, id: string, version?: number) {
  ctx.require("proposals:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id);
    const [v] = await tx
      .select({ snapshot: proposalVersions.snapshot })
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, p.id), eq(proposalVersions.version, version ?? p.version)));
    return v?.snapshot ?? null;
  });
}

/** A preview snapshot of the current draft (not stored). */
export async function previewSnapshot(ctx: AccessContext, firmId: string, id: string): Promise<ProposalSnapshot> {
  ctx.require("proposals:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => buildSnapshot(tx, await load(tx, ctx, firmId, id), new Date()));
}

async function buildSnapshot(tx: Tx, p: typeof proposals.$inferSelect, releasedAt: Date): Promise<ProposalSnapshot> {
  const [firm] = await tx.select().from(firms).where(eq(firms.id, p.firmId));
  const items = await tx.select().from(proposalItems).where(eq(proposalItems.proposalId, p.id)).orderBy(asc(proposalItems.position));
  const [owner] = p.createdById ? await tx.select({ name: users.name }).from(users).where(eq(users.id, p.createdById)) : [];
  return {
    ref: p.ref,
    title: p.title,
    version: p.version,
    firm: { tradingName: firm.tradingName, legalName: firm.legalName, brandColor: firm.brandColor, slug: firm.slug, contactEmail: firm.contactEmail, contactPhone: firm.contactPhone, website: firm.website },
    recipientName: p.recipientName,
    recipientEmail: p.recipientEmail,
    currency: p.currency,
    totalMinor: p.totalMinor,
    depositMinor: p.depositMinor,
    sections: p.sections,
    items: items.map((i) => ({ label: i.label, description: i.description, quantity: i.quantity, unitMinor: i.unitMinor, depositMinor: i.depositMinor, lines: i.lines })),
    preparedBy: owner?.name ?? null,
    releasedAt: releasedAt.toISOString(),
    validUntil: new Date(releasedAt.getTime() + p.validDays * 86_400_000).toISOString(),
  };
}

/* ───────────────────────── Creating and editing ───────────────────────── */

export async function createProposalFromLead(ctx: AccessContext, firmId: string, leadId: string, opts: { serviceIds?: string[] } = {}) {
  ctx.require("proposals:create", firmId);
  assertUuid(leadId, "Lead");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, firmId, leadId);
    const firm = ctx.firm(firmId);
    const [firmRow] = await tx.select({ slug: firms.slug, tradingName: firms.tradingName }).from(firms).where(eq(firms.id, firmId));
    const ref = await nextRef(tx, firmId, firm.refPrefix, "proposal");
    const [proposal] = await tx
      .insert(proposals)
      .values({
        firmId, ref, leadId: lead.id,
        title: lead.immigrationCategory ? `${lead.immigrationCategory} proposal` : "Proposal",
        recipientName: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
        recipientEmail: lead.email,
        currency: "ZAR",
        sections: [],
        createdById: ctx.user.id, updatedById: ctx.user.id,
      })
      .returning();
    const chosen: string[] = [];
    let pos = 1;
    for (const sid of (opts.serviceIds ?? []).slice(0, 10)) {
      const svc = await addServiceItem(tx, firmId, proposal.id, sid, pos++);
      chosen.push(svc.name);
      if (pos === 2) await tx.update(proposals).set({ currency: svc.currency, title: `${svc.name} proposal` }).where(eq(proposals.id, proposal.id));
    }
    await recompute(tx, proposal.id);
    const [totals] = await tx.select({ total: proposals.totalMinor, deposit: proposals.depositMinor }).from(proposals).where(eq(proposals.id, proposal.id));
    const sections = defaultSections({
      firmSlug: firmRow.slug, firmName: firmRow.tradingName, firstName: lead.firstName, enquiry: lead.enquiry, category: lead.immigrationCategory,
      destination: lead.destinationCountry ? countryName(lead.destinationCountry) : null, serviceNames: chosen,
      depositPercent: totals.total ? Math.round((totals.deposit / totals.total) * 100) : null,
    });
    const [created] = await tx.update(proposals).set({ sections }).where(eq(proposals.id, proposal.id)).returning();
    await logActivity(tx, ctx, created, "created", `Started proposal ${created.ref}`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.created", entityType: "proposal", entityId: created.id, summary: `Started ${created.ref} for ${lead.ref}`, ip: ctx.ip }, tx);
    return created;
  });
}

const sectionSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/),
  title: z.string().trim().min(1, "Give each section a title.").max(120),
  body: z.string().trim().max(8000, "Keep each section under 8,000 characters."),
});

const detailsSchema = z.object({
  title: z.string().trim().min(3, "Enter a title.").max(160),
  recipientName: z.string().trim().min(2, "Enter the client's name.").max(160),
  recipientEmail: optionalEmail,
  validDays: z.coerce.number().int().min(1, "Between 1 and 90 days.").max(90, "Between 1 and 90 days.").default(14),
  currency: z.enum(["ZAR", "AUD", "USD", "GBP", "EUR"]).default("ZAR"),
  sections: z.array(sectionSchema).max(20),
});

export async function updateProposal(ctx: AccessContext, firmId: string, id: string, raw: unknown) {
  ctx.require("proposals:edit", firmId);
  const input = parseOrThrow(detailsSchema, raw);
  const keys = new Set<string>();
  for (const s of input.sections) {
    if (keys.has(s.key)) throw new ValidationError("Each section needs a different key.");
    keys.add(s.key);
  }
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, EDITABLE, "edited");
    const [updated] = await tx
      .update(proposals)
      .set({ title: input.title, recipientName: input.recipientName, recipientEmail: input.recipientEmail ?? null, validDays: input.validDays, currency: input.currency, sections: input.sections as ProposalSection[], updatedById: ctx.user.id, updatedAt: new Date() })
      .where(eq(proposals.id, p.id))
      .returning();
    return updated;
  });
}

const itemSchema = z.object({
  label: z.string().trim().min(2, "Name the item.").max(160),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
  unit: z.union([z.string(), z.number()]),
  deposit: z.union([z.string(), z.number()]).optional(),
});

export async function addProposalItem(ctx: AccessContext, firmId: string, id: string, raw: { serviceId?: string } | Record<string, unknown>) {
  ctx.require("proposals:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, EDITABLE, "edited");
    const [{ n }] = await tx.select({ n: count() }).from(proposalItems).where(eq(proposalItems.proposalId, p.id));
    if (n >= 20) throw new ValidationError("A proposal can have up to 20 items.");
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${proposalItems.position}), 0)` }).from(proposalItems).where(eq(proposalItems.proposalId, p.id));
    const position = Number(maxPos) + 1;
    if (typeof raw.serviceId === "string" && raw.serviceId) {
      const svc = await addServiceItem(tx, firmId, p.id, raw.serviceId, position);
      if (svc.currency !== p.currency && n > 0) throw new ValidationError(`This service is priced in ${svc.currency}; the proposal is in ${p.currency}.`);
      if (n === 0) await tx.update(proposals).set({ currency: svc.currency }).where(eq(proposals.id, p.id));
    } else {
      const input = parseOrThrow(itemSchema, raw);
      const unit = parseMoney(input.unit);
      const deposit = input.deposit === undefined || input.deposit === "" ? 0 : parseMoney(input.deposit);
      if (unit === null) throw new ValidationError("Check the amount.", { unit: "Enter an amount, for example 2500." });
      if (deposit === null || deposit > unit) throw new ValidationError("Check the deposit.", { deposit: "The deposit must be an amount no more than the price." });
      await tx.insert(proposalItems).values({ firmId, proposalId: p.id, position, label: input.label, description: input.description, quantity: input.quantity, unitMinor: unit, depositMinor: deposit });
    }
    await tx.update(proposals).set({ updatedById: ctx.user.id }).where(eq(proposals.id, p.id));
    await recompute(tx, p.id);
  });
}

export async function updateProposalItem(ctx: AccessContext, firmId: string, id: string, itemId: string, raw: unknown) {
  ctx.require("proposals:edit", firmId);
  assertUuid(itemId, "Item");
  const input = parseOrThrow(itemSchema, raw);
  const unit = parseMoney(input.unit);
  const deposit = input.deposit === undefined || input.deposit === "" ? 0 : parseMoney(input.deposit);
  if (unit === null) throw new ValidationError("Check the amount.", { unit: "Enter an amount, for example 2500." });
  if (deposit === null || deposit > unit) throw new ValidationError("Check the deposit.", { deposit: "The deposit must be an amount no more than the price." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, EDITABLE, "edited");
    const [item] = await tx.select().from(proposalItems).where(and(eq(proposalItems.id, itemId), eq(proposalItems.proposalId, p.id)));
    if (!item) throw new NotFoundError("Item");
    // A changed price no longer matches the catalogue version it came from.
    const priceChanged = item.unitMinor !== unit || item.depositMinor !== deposit;
    await tx
      .update(proposalItems)
      .set({ label: input.label, description: input.description, quantity: input.quantity, unitMinor: unit, depositMinor: deposit, ...(priceChanged ? { lines: [] } : {}) })
      .where(eq(proposalItems.id, item.id));
    await tx.update(proposals).set({ updatedById: ctx.user.id }).where(eq(proposals.id, p.id));
    await recompute(tx, p.id);
  });
}

export async function removeProposalItem(ctx: AccessContext, firmId: string, id: string, itemId: string) {
  ctx.require("proposals:edit", firmId);
  assertUuid(itemId, "Item");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, EDITABLE, "edited");
    await tx.delete(proposalItems).where(and(eq(proposalItems.id, itemId), eq(proposalItems.proposalId, p.id)));
    await recompute(tx, p.id);
  });
}

/* ───────────────────────── Workflow ───────────────────────── */

export async function submitForReview(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("proposals:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, EDITABLE, "sent for review");
    const [{ n }] = await tx.select({ n: count() }).from(proposalItems).where(eq(proposalItems.proposalId, p.id));
    if (n === 0) throw new ValidationError("Add at least one fee item before sending for review.");
    if (!p.sections.some((s) => s.body.trim())) throw new ValidationError("Write at least one section before sending for review.");
    await tx.update(proposals).set({ status: "in_review", submittedAt: new Date(), reviewNote: null, updatedAt: new Date() }).where(eq(proposals.id, p.id));
    await logActivity(tx, ctx, p, "submitted", `Sent ${p.ref} for review`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.submitted", entityType: "proposal", entityId: p.id, summary: `Sent ${p.ref} v${p.version} for review`, ip: ctx.ip }, tx);
  });
}

export async function requestChanges(ctx: AccessContext, firmId: string, id: string, note: string) {
  ctx.require("proposals:approve", firmId);
  const clean = note.trim().slice(0, 1000);
  if (clean.length < 3) throw new ValidationError("Say what needs to change.", { note: "Say what needs to change." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, ["in_review", "approved"], "sent back");
    await tx.update(proposals).set({ status: "changes_requested", reviewNote: clean, approvedAt: null, approvedById: null, updatedAt: new Date() }).where(eq(proposals.id, p.id));
    await logActivity(tx, ctx, p, "changes_requested", `Changes requested on ${p.ref}`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.changes_requested", entityType: "proposal", entityId: p.id, summary: `Changes requested on ${p.ref}`, ip: ctx.ip }, tx);
  });
}

export async function approveProposal(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("proposals:approve", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, ["in_review"], "approved");
    await tx.update(proposals).set({ status: "approved", approvedById: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(proposals.id, p.id));
    await logActivity(tx, ctx, p, "approved", `Approved ${p.ref}`);
    await audit({
      orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.approved", entityType: "proposal", entityId: p.id,
      summary: `Approved ${p.ref} v${p.version}`, data: { selfApproved: p.updatedById === ctx.user.id }, ip: ctx.ip,
    }, tx);
  });
}

function newLink() {
  const token = randomToken();
  return { token, hash: sha256(token), url: `${env().APP_URL}/p/${token}` };
}

/** Freeze the approved proposal, create the client link and return it (shown once). */
export async function releaseProposal(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("proposals:release", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, ["approved"], "sent");
    const now = new Date();
    const [already] = await tx.select({ v: proposalVersions.version }).from(proposalVersions).where(and(eq(proposalVersions.proposalId, p.id), eq(proposalVersions.version, p.version)));
    if (already) throw new ConflictError("This version was already sent. Start a new version first.");
    const snapshot = await buildSnapshot(tx, p, now);
    const link = newLink();
    await tx.insert(proposalVersions).values({ firmId, proposalId: p.id, version: p.version, snapshot, createdById: ctx.user.id });
    await tx
      .update(proposals)
      .set({ status: "released", releasedAt: now, releasedById: ctx.user.id, linkTokenHash: link.hash, linkExpiresAt: new Date(snapshot.validUntil), firstViewedAt: null, updatedAt: now })
      .where(eq(proposals.id, p.id));
    await logActivity(tx, ctx, p, "released", `Sent ${p.ref} to the client`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.released", entityType: "proposal", entityId: p.id, summary: `Sent ${p.ref} v${p.version}`, data: { totalMinor: p.totalMinor, validUntil: snapshot.validUntil }, ip: ctx.ip }, tx);
    return { url: link.url, validUntil: snapshot.validUntil };
  });
}

/** Replace the client link (the old one stops working). Keeps the same expiry. */
export async function renewLink(ctx: AccessContext, firmId: string, id: string, extendDays?: number) {
  ctx.require("proposals:release", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, ["released"], "given a new link");
    const link = newLink();
    const days = extendDays && extendDays > 0 ? Math.min(extendDays, 90) : 0;
    const expires = days ? new Date(Date.now() + days * 86_400_000) : p.linkExpiresAt!;
    await tx.update(proposals).set({ linkTokenHash: link.hash, linkExpiresAt: expires, updatedAt: new Date() }).where(eq(proposals.id, p.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.link_renewed", entityType: "proposal", entityId: p.id, summary: `New client link for ${p.ref}`, data: { expires: expires.toISOString() }, ip: ctx.ip }, tx);
    return { url: link.url, validUntil: expires.toISOString() };
  });
}

export async function withdrawProposal(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("proposals:release", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, ["draft", "in_review", "changes_requested", "approved", "released"], "withdrawn");
    await tx.update(proposals).set({ status: "withdrawn", linkTokenHash: null, updatedAt: new Date() }).where(eq(proposals.id, p.id));
    await logActivity(tx, ctx, p, "withdrawn", `Withdrew ${p.ref}`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.withdrawn", entityType: "proposal", entityId: p.id, summary: `Withdrew ${p.ref}`, ip: ctx.ip }, tx);
  });
}

/** Start a new version from a sent, declined or withdrawn proposal. The old version stays on record. */
export async function reviseProposal(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("proposals:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const p = await load(tx, ctx, firmId, id, true);
    assertStatus(p, ["released", "declined", "withdrawn", "approved", "in_review"], "revised");
    const [sent] = await tx.select({ v: proposalVersions.version }).from(proposalVersions).where(and(eq(proposalVersions.proposalId, p.id), eq(proposalVersions.version, p.version)));
    const bump = sent ? 1 : 0; // a version the client has seen is never edited in place
    await tx
      .update(proposals)
      .set({
        status: "draft", version: p.version + bump, linkTokenHash: null, linkExpiresAt: null, firstViewedAt: null,
        approvedAt: null, approvedById: null, submittedAt: null, respondedAt: null, responseName: null, responseNote: null, responseIp: null,
        updatedById: ctx.user.id, updatedAt: new Date(),
      })
      .where(eq(proposals.id, p.id));
    await logActivity(tx, ctx, p, "revised", bump ? `Started version ${p.version + 1} of ${p.ref}` : `Reopened ${p.ref} for editing`);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "proposal.revised", entityType: "proposal", entityId: p.id, summary: `Reopened ${p.ref} as v${p.version + bump}`, ip: ctx.ip }, tx);
  });
}

/* ───────────────────────── Client link (no staff session) ───────────────────────── */

export type PublicProposal = {
  snapshot: ProposalSnapshot;
  status: "released" | "accepted" | "declined";
  expired: boolean;
  expiresAt: string;
  respondedAt: string | null;
  responseName: string | null;
};

const tokenShape = /^[A-Za-z0-9_-]{40,64}$/;

export async function getPublicProposal(token: string): Promise<PublicProposal | null> {
  if (!tokenShape.test(token)) return null;
  const res = await db().execute<{ v: PublicProposal | null }>(sql`select proposal_public_view(${sha256(token)}) as v`);
  return res.rows[0]?.v ?? null;
}

export type PublicResponse = "accepted" | "declined" | "already_accepted" | "already_declined" | "expired" | "not_found" | "name_required";

export async function respondToProposal(token: string, input: { accept: boolean; name: string; note?: string; ip: string | null }): Promise<PublicResponse> {
  if (!tokenShape.test(token)) return "not_found";
  const res = await db().execute<{ r: PublicResponse }>(
    sql`select proposal_public_respond(${sha256(token)}, ${input.accept}, ${input.name}, ${input.note ?? null}, ${input.ip ?? null}) as r`,
  );
  return res.rows[0]?.r ?? "not_found";
}

import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { activities, clients, creditNotes, firmBilling, firms, invoiceLines, invoices, matters, payments, proposalItems, proposals, users } from "../../db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { optionalText, optionalUuid, parseOrThrow } from "../../validation";
import { addCalendarDays, isIsoDate } from "../matters/dates";

/**
 * Operational finance for each practice: invoices, credit notes, payments and
 * reconciliation. Each practice invoices as its own legal entity with its own
 * numbering. This is not an accounting or trust-accounting system: the
 * practice's books stay in its accounting package.
 *
 * Invoice status: draft → issued → partially paid → paid; or credited / void.
 * "Overdue" is shown for issued or partly paid invoices past their due date.
 * Only verified payments count towards an invoice.
 */

const today = () => new Date().toISOString().slice(0, 10);

export function canViewFinance(ctx: AccessContext, firmId: string) {
  return ctx.has("invoices:view", firmId);
}

/* ───────── Billing settings ───────── */

export async function getBilling(ctx: AccessContext, firmId: string) {
  ctx.require("invoices:view", firmId);
  return withScope(ctx.scopeFor(firmId), (tx) => billingTx(tx, firmId, ctx.firm(firmId).refPrefix));
}

async function billingTx(tx: Tx, firmId: string, refPrefix: string) {
  const [b] = await tx.select().from(firmBilling).where(eq(firmBilling.firmId, firmId));
  return (
    b ?? {
      firmId, invoicePrefix: `${refPrefix}-INV`, creditNotePrefix: `${refPrefix}-CN`, defaultCurrency: "ZAR", paymentTermsDays: 7, taxRateBp: null, taxLabel: null,
      taxNumber: null, registrationNumber: null, address: null, bankDetails: null, invoiceTerms: null, invoiceFooter: null, updatedById: null, updatedAt: new Date(0),
    }
  );
}

const billingSchema = z.object({
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, "Letters, numbers and hyphens, 2 to 16 characters."),
  creditNotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, "Letters, numbers and hyphens, 2 to 16 characters."),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  paymentTermsDays: z.coerce.number().int().min(0).max(120),
  taxRate: z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{1,2}(\.\d{1,2})?$/.test(v), "Enter a percentage, e.g. 15."),
  taxLabel: optionalText(20),
  taxNumber: optionalText(40),
  registrationNumber: optionalText(60),
  address: optionalText(500),
  bankDetails: optionalText(800),
  invoiceTerms: optionalText(2000),
  invoiceFooter: optionalText(300),
});

export async function saveBilling(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("invoices:issue", firmId);
  const input = parseOrThrow(billingSchema, raw);
  const taxRateBp = input.taxRate ? Math.round(Number(input.taxRate) * 100) : null;
  if (taxRateBp && !input.taxNumber) throw new ValidationError("Add the tax registration number before charging tax.", { taxNumber: "Required when a tax rate is set." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const values = {
      invoicePrefix: input.invoicePrefix, creditNotePrefix: input.creditNotePrefix, defaultCurrency: input.defaultCurrency, paymentTermsDays: input.paymentTermsDays, taxRateBp,
      taxLabel: taxRateBp ? (input.taxLabel ?? "VAT") : null, taxNumber: input.taxNumber ?? null, registrationNumber: input.registrationNumber ?? null, address: input.address ?? null,
      bankDetails: input.bankDetails ?? null, invoiceTerms: input.invoiceTerms ?? null, invoiceFooter: input.invoiceFooter ?? null, updatedById: ctx.user.id, updatedAt: new Date(),
    };
    await tx.insert(firmBilling).values({ firmId, ...values }).onConflictDoUpdate({ target: firmBilling.firmId, set: values });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "billing.updated", entityType: "firm", entityId: firmId, summary: "Updated billing settings", ip: ctx.ip }, tx);
  });
}

/* ───────── Totals ───────── */

export type LineInput = { kind: "professional" | "government" | "third_party" | "disbursement" | "discount"; description: string; quantity: number; unitMinor: number; taxable: boolean; serviceId?: string | null };

export function computeTotals(lines: LineInput[], taxRateBp: number | null) {
  let subtotal = 0;
  let discount = 0;
  let taxBase = 0;
  for (const l of lines) {
    const total = l.quantity * l.unitMinor;
    if (l.kind === "discount") discount += Math.abs(total);
    else {
      subtotal += total;
      if (l.taxable) taxBase += total;
    }
  }
  // Discounts reduce the taxable base proportionally.
  const taxableAfterDiscount = subtotal > 0 ? Math.max(0, taxBase - Math.round((discount * taxBase) / subtotal)) : 0;
  const tax = taxRateBp ? Math.round((taxableAfterDiscount * taxRateBp) / 10_000) : 0;
  if (discount > subtotal) throw new ValidationError("The discount is larger than the invoice.");
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

const money = z.union([z.number(), z.string()]).transform((v, c) => {
  const s = String(v).replace(/[\s,]/g, "").replace(/^R/i, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    c.addIssue({ code: "custom", message: "Enter an amount, e.g. 12500 or 12500.50." });
    return z.NEVER;
  }
  return Math.round(Number(s) * 100);
});

const lineSchema = z.object({
  kind: z.enum(["professional", "government", "third_party", "disbursement", "discount"]).default("professional"),
  description: z.string().trim().min(2, "Describe the line.").max(300),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  unit: money,
  taxable: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal(""), z.literal("false")]).optional().transform((v) => v === true || v === "on" || v === "true"),
  serviceId: optionalUuid,
});

function toLines(raw: unknown): LineInput[] {
  const parsed = parseOrThrow(z.array(lineSchema).min(1, "Add at least one line.").max(60), raw);
  return parsed.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitMinor: l.kind === "discount" ? -Math.abs(l.unit) : l.unit, taxable: l.kind === "discount" ? false : l.taxable, serviceId: l.serviceId ?? null }));
}

/* ───────── Status ───────── */

export function displayStatus(inv: { status: string; dueDate: string | null }): string {
  if ((inv.status === "issued" || inv.status === "partially_paid") && inv.dueDate && inv.dueDate < today()) return "overdue";
  return inv.status;
}

/** Recalculate paid and credited amounts from verified payments and credit notes, and set the status. */
export async function recompute(tx: Tx, invoiceId: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!inv) return null;
  const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int` }).from(payments).where(and(eq(payments.invoiceId, inv.id), eq(payments.status, "verified")));
  const [{ credited }] = await tx.select({ credited: sql<number>`coalesce(sum(${creditNotes.amountMinor}), 0)::int` }).from(creditNotes).where(eq(creditNotes.invoiceId, inv.id));
  let status = inv.status;
  if (inv.status !== "draft" && inv.status !== "void") {
    if (credited >= inv.totalMinor) status = "credited";
    else if (paid + credited >= inv.totalMinor) status = "paid";
    else if (paid > 0) status = "partially_paid";
    else status = "issued";
  }
  const [updated] = await tx.update(invoices).set({ paidMinor: Number(paid), creditedMinor: Number(credited), status, updatedAt: new Date() }).where(eq(invoices.id, inv.id)).returning();
  return updated;
}

/* ───────── Invoices ───────── */

export type InvoiceFilters = { status?: string; clientId?: string; matterId?: string; q?: string; page?: number };

export async function listInvoices(ctx: AccessContext, firmId: string, f: InvoiceFilters = {}) {
  ctx.require("invoices:view", firmId);
  const conds: SQL[] = [eq(invoices.firmId, firmId)];
  const t = today();
  if (f.status === "overdue") conds.push(inArray(invoices.status, ["issued", "partially_paid"]), lt(invoices.dueDate, t));
  else if (f.status === "open") conds.push(inArray(invoices.status, ["issued", "partially_paid"]));
  else if (f.status && ["draft", "issued", "partially_paid", "paid", "credited", "void"].includes(f.status)) conds.push(eq(invoices.status, f.status as "draft"));
  if (f.clientId && z.string().uuid().safeParse(f.clientId).success) conds.push(eq(invoices.clientId, f.clientId));
  if (f.matterId && z.string().uuid().safeParse(f.matterId).success) conds.push(eq(invoices.matterId, f.matterId));
  if (f.q?.trim()) {
    const term = `%${f.q.trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(invoices.number, term), ilike(invoices.billToName, term), ilike(invoices.reference, term))!);
  }
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({ i: invoices, clientRef: clients.ref, matterRef: matters.ref })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .leftJoin(matters, eq(matters.id, invoices.matterId))
      .where(and(...conds))
      .orderBy(sql`${invoices.status} = 'draft' desc`, desc(invoices.issueDate), desc(invoices.createdAt))
      .limit(50)
      .offset((page - 1) * 50);
    const [{ total }] = await tx.select({ total: count() }).from(invoices).where(and(...conds));
    return { rows: rows.map((r) => ({ ...r.i, clientRef: r.clientRef, matterRef: r.matterRef, display: displayStatus(r.i) })), total: Number(total), page, pageSize: 50 };
  });
}

async function loadInvoice(tx: Tx, firmId: string, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Invoice");
  const q = tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firmId))).limit(1);
  const [inv] = lock ? await q.for("update") : await q;
  if (!inv) throw new NotFoundError("Invoice");
  return inv;
}

export async function getInvoice(ctx: AccessContext, firmId: string, id: string) {
  ctx.require("invoices:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const inv = await loadInvoice(tx, firmId, id);
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position));
    const pays = await tx
      .select({ p: payments, recordedBy: sql<string | null>`(select name from users u where u.id = ${payments.recordedById})`, verifiedByName: sql<string | null>`(select name from users u where u.id = ${payments.verifiedById})` })
      .from(payments)
      .where(eq(payments.invoiceId, inv.id))
      .orderBy(desc(payments.createdAt));
    const credits = await tx.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv.id)).orderBy(asc(creditNotes.issuedAt));
    const [client] = await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName, email: clients.email }).from(clients).where(eq(clients.id, inv.clientId));
    const matter = inv.matterId ? ((await tx.select({ id: matters.id, ref: matters.ref, title: matters.title }).from(matters).where(eq(matters.id, inv.matterId)))[0] ?? null) : null;
    const proposal = inv.proposalId ? ((await tx.select({ id: proposals.id, ref: proposals.ref }).from(proposals).where(eq(proposals.id, inv.proposalId)))[0] ?? null) : null;
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    return {
      invoice: { ...inv, display: displayStatus(inv), balanceMinor: Math.max(0, inv.totalMinor - inv.paidMinor - inv.creditedMinor) },
      lines,
      payments: pays.map((r) => ({ ...r.p, recordedBy: r.recordedBy, verifiedByName: r.verifiedByName })),
      credits, client, matter, proposal, billing,
    };
  });
}

const createSchema = z.object({
  clientId: z.string().uuid("Choose a client."),
  matterId: optionalUuid,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  reference: optionalText(120),
});

export async function createInvoice(ctx: AccessContext, firmId: string, raw: unknown, linesRaw?: unknown) {
  ctx.require("invoices:edit", firmId);
  const input = parseOrThrow(createSchema, raw);
  const lines = linesRaw ? toLines(linesRaw) : [];
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.firmId, firmId), isNull(clients.deletedAt)));
    if (!client) throw new ValidationError("Choose a client from this practice.", { clientId: "Choose a client from this practice." });
    if (input.matterId) {
      const { loadVisibleMatter } = await import("../matters/matters");
      const m = await loadVisibleMatter(tx, ctx, firmId, input.matterId);
      if (m.clientId !== client.id) throw new ValidationError("That matter belongs to another client.", { matterId: "Choose one of this client's matters." });
    }
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    return insertDraft(tx, ctx, firmId, { clientId: client.id, matterId: input.matterId ?? null, proposalId: null, currency: input.currency ?? billing.defaultCurrency, billToName: [client.firstName, client.lastName].filter(Boolean).join(" "), billToEmail: client.email, reference: input.reference ?? null, terms: billing.invoiceTerms, taxRateBp: billing.taxRateBp }, lines);
  });
}

async function insertDraft(tx: Tx, ctx: AccessContext, firmId: string, v: { clientId: string; matterId: string | null; proposalId: string | null; currency: string; billToName: string; billToEmail: string | null; reference: string | null; terms: string | null; taxRateBp: number | null }, lines: LineInput[]) {
  const t = computeTotals(lines, v.taxRateBp);
  const [inv] = await tx
    .insert(invoices)
    .values({ firmId, ...v, subtotalMinor: t.subtotal, discountMinor: t.discount, taxMinor: t.tax, totalMinor: t.total, createdById: ctx.user.id })
    .returning();
  if (lines.length) await tx.insert(invoiceLines).values(lines.map((l, i) => ({ firmId, invoiceId: inv.id, position: i, kind: l.kind, description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, taxable: l.taxable, totalMinor: l.quantity * l.unitMinor, serviceId: l.serviceId })));
  await tx.insert(activities).values({ firmId, clientId: v.clientId, matterId: v.matterId, type: "updated", body: "Draft invoice prepared", data: { invoiceId: inv.id }, actorId: ctx.user.id });
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "invoice.drafted", entityType: "invoice", entityId: inv.id, summary: `Drafted an invoice for ${v.billToName}`, ip: ctx.ip }, tx);
  return inv;
}

/** Deposit, balance or full invoice from an accepted proposal, at the proposal's agreed amounts. */
export async function invoiceFromProposal(ctx: AccessContext, firmId: string, proposalId: string, part: "deposit" | "balance" | "full") {
  ctx.require("invoices:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [p] = await tx.select().from(proposals).where(and(eq(proposals.id, proposalId), eq(proposals.firmId, firmId)));
    if (!p) throw new NotFoundError("Proposal");
    if (p.status !== "accepted") throw new ValidationError("Only an accepted proposal can be invoiced.");
    const [client] = await tx.select().from(clients).where(and(eq(clients.firmId, firmId), eq(clients.sourceLeadId, p.leadId), isNull(clients.deletedAt)));
    if (!client) throw new ValidationError("Convert the lead to a client before invoicing.");
    const existing = await tx.select({ id: invoices.id, reference: invoices.reference, status: invoices.status }).from(invoices).where(and(eq(invoices.proposalId, p.id), ne(invoices.status, "void")));
    const tag = `${p.ref} ${part}`;
    if (existing.some((e) => e.reference === tag)) throw new ConflictError(`A ${part} invoice for ${p.ref} already exists.`);
    if (part === "full" && existing.length) throw new ConflictError(`${p.ref} already has invoices; create the remaining balance instead.`);
    const items = await tx.select().from(proposalItems).where(eq(proposalItems.proposalId, p.id)).orderBy(asc(proposalItems.position));
    const [matter] = await tx.select({ id: matters.id }).from(matters).where(and(eq(matters.proposalId, p.id), isNull(matters.deletedAt)));
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    let lines: LineInput[];
    if (part === "deposit") {
      if (p.depositMinor <= 0) throw new ValidationError("This proposal has no deposit.");
      lines = [{ kind: "professional", description: `Deposit for ${p.title} (${p.ref})`, quantity: 1, unitMinor: p.depositMinor, taxable: true }];
    } else if (part === "balance") {
      const deposit = existing.find((e) => e.reference === `${p.ref} deposit`);
      if (!deposit) throw new ValidationError("Invoice the deposit first, or invoice the full amount.");
      lines = [{ kind: "professional", description: `Balance for ${p.title} (${p.ref})`, quantity: 1, unitMinor: p.totalMinor - p.depositMinor, taxable: true }];
    } else {
      lines = items.flatMap((it) =>
        it.lines.length
          ? it.lines.map((l) => ({ kind: l.kind as LineInput["kind"], description: `${it.label}: ${l.label}`, quantity: it.quantity, unitMinor: l.amountMinor, taxable: l.kind === "professional", serviceId: it.serviceId }))
          : [{ kind: "professional" as const, description: it.label, quantity: it.quantity, unitMinor: it.unitMinor, taxable: true, serviceId: it.serviceId }],
      );
    }
    return insertDraft(tx, ctx, firmId, { clientId: client.id, matterId: matter?.id ?? null, proposalId: p.id, currency: p.currency, billToName: p.recipientName, billToEmail: p.recipientEmail ?? client.email, reference: tag, terms: billing.invoiceTerms, taxRateBp: billing.taxRateBp }, lines);
  });
}

const draftSchema = z.object({
  billToName: z.string().trim().min(2, "Who is the invoice addressed to?").max(160),
  billToEmail: z.string().trim().toLowerCase().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || z.string().email().safeParse(v).success, "Enter a valid email address."),
  billToAddress: optionalText(500),
  reference: optionalText(120),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  terms: optionalText(2000),
  notes: optionalText(2000),
});

export async function updateDraft(ctx: AccessContext, firmId: string, id: string, raw: unknown, linesRaw: unknown) {
  ctx.require("invoices:edit", firmId);
  const input = parseOrThrow(draftSchema, raw);
  const lines = toLines(linesRaw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const inv = await loadInvoice(tx, firmId, id, true);
    if (inv.status !== "draft") throw new ConflictError("Only draft invoices can be edited. Issue a credit note to correct an issued invoice.");
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    const t = computeTotals(lines, billing.taxRateBp);
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    await tx.insert(invoiceLines).values(lines.map((l, i) => ({ firmId, invoiceId: inv.id, position: i, kind: l.kind, description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, taxable: l.taxable, totalMinor: l.quantity * l.unitMinor, serviceId: l.serviceId })));
    const [updated] = await tx
      .update(invoices)
      .set({ billToName: input.billToName, billToEmail: input.billToEmail ?? null, billToAddress: input.billToAddress ?? null, reference: input.reference ?? null, currency: input.currency, terms: input.terms ?? null, notes: input.notes ?? null, taxRateBp: billing.taxRateBp, subtotalMinor: t.subtotal, discountMinor: t.discount, taxMinor: t.tax, totalMinor: t.total, updatedAt: new Date() })
      .where(eq(invoices.id, inv.id))
      .returning();
    return updated;
  });
}

async function nextNumber(tx: Tx, firmId: string, key: "invoice" | "credit_note", prefix: string) {
  const res = await tx.execute<{ value: number }>(sql`
    insert into firm_sequences (firm_id, key, value) values (${firmId}, ${key}, 1)
    on conflict (firm_id, key) do update set value = firm_sequences.value + 1
    returning value`);
  return `${prefix}-${String(Number(res.rows[0].value)).padStart(6, "0")}`;
}

/** Issue a draft: assigns the next number, fixes the date, due date and printed practice details. */
export async function issueInvoice(ctx: AccessContext, firmId: string, id: string, opts: { issueDate?: string; dueDays?: number } = {}) {
  ctx.require("invoices:issue", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const inv = await loadInvoice(tx, firmId, id, true);
    if (inv.status !== "draft") throw new ConflictError("This invoice has already been issued.");
    const [{ n }] = await tx.select({ n: count() }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    if (!Number(n) || inv.totalMinor <= 0) throw new ValidationError("Add at least one line with an amount before issuing.");
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    if (inv.taxMinor > 0 && !billing.taxNumber) throw new ValidationError("Add the practice's tax number in billing settings before issuing a taxed invoice.");
    const issueDate = opts.issueDate && isIsoDate(opts.issueDate) ? opts.issueDate : today();
    const dueDate = addCalendarDays(issueDate, opts.dueDays ?? billing.paymentTermsDays);
    const number = await nextNumber(tx, firmId, "invoice", billing.invoicePrefix);
    const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId));
    const snapshot = {
      tradingName: firm.tradingName, legalName: firm.legalName, slug: firm.slug, brandColor: firm.brandColor, website: firm.website, contactEmail: firm.contactEmail, contactPhone: firm.contactPhone,
      address: billing.address, registrationNumber: billing.registrationNumber, taxNumber: billing.taxNumber, taxLabel: billing.taxLabel, bankDetails: billing.bankDetails, footer: billing.invoiceFooter,
    };
    const [issued] = await tx
      .update(invoices)
      .set({ status: "issued", number, issueDate, dueDate, issuedAt: new Date(), issuedById: ctx.user.id, issuedSnapshot: snapshot, updatedAt: new Date() })
      .where(eq(invoices.id, inv.id))
      .returning();
    await tx.insert(activities).values({ firmId, clientId: inv.clientId, matterId: inv.matterId, type: "updated", body: `Invoice ${number} issued`, data: { invoiceId: inv.id }, actorId: ctx.user.id });
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "invoice.issued", entityType: "invoice", entityId: inv.id, summary: `Issued invoice ${number} (${inv.currency} ${(inv.totalMinor / 100).toFixed(2)})`, ip: ctx.ip }, tx);
    // Payments already verified against the draft (rare) are applied now.
    return (await recompute(tx, issued.id)) ?? issued;
  });
}

export async function voidInvoice(ctx: AccessContext, firmId: string, id: string, reason: string) {
  ctx.require("invoices:issue", firmId);
  const why = reason.trim();
  if (why.length < 5) throw new ValidationError("Give the reason for voiding.", { reason: "Required." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const inv = await loadInvoice(tx, firmId, id, true);
    if (inv.status === "void") return inv;
    const [{ n }] = await tx.select({ n: count() }).from(payments).where(and(eq(payments.invoiceId, inv.id), inArray(payments.status, ["verified", "pending"])));
    if (Number(n)) throw new ConflictError("This invoice has payments. Credit it instead, or move the payments first.");
    const [updated] = await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: why.slice(0, 500), updatedAt: new Date() }).where(eq(invoices.id, inv.id)).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "invoice.voided", entityType: "invoice", entityId: inv.id, summary: `Voided ${inv.number ?? "a draft invoice"}: ${why.slice(0, 120)}`, ip: ctx.ip }, tx);
    return updated;
  });
}

export async function creditInvoice(ctx: AccessContext, firmId: string, id: string, raw: unknown) {
  ctx.require("invoices:issue", firmId);
  const input = parseOrThrow(z.object({ amount: money, reason: z.string().trim().min(5, "Give the reason for the credit.").max(500) }), raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const inv = await loadInvoice(tx, firmId, id, true);
    if (inv.status === "draft" || inv.status === "void") throw new ConflictError("Only issued invoices can be credited.");
    const open = inv.totalMinor - inv.paidMinor - inv.creditedMinor;
    if (input.amount <= 0 || input.amount > open) throw new ValidationError(`Credit between 0.01 and the unpaid balance (${(open / 100).toFixed(2)}).`, { amount: "Too large." });
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    const number = await nextNumber(tx, firmId, "credit_note", billing.creditNotePrefix);
    const [cn] = await tx.insert(creditNotes).values({ firmId, invoiceId: inv.id, number, amountMinor: input.amount, reason: input.reason, issuedById: ctx.user.id }).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "invoice.credited", entityType: "invoice", entityId: inv.id, summary: `Credit note ${number} against ${inv.number}`, ip: ctx.ip }, tx);
    await recompute(tx, inv.id);
    return cn;
  });
}

/* ───────── Payments ───────── */

const paymentSchema = z.object({
  invoiceId: optionalUuid,
  clientId: optionalUuid,
  amount: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  method: z.enum(["eft", "cash", "card_machine", "other"]),
  receivedOn: z.string().refine(isIsoDate, "Enter the date the money arrived."),
  reference: z.string().trim().min(2, "Enter the bank or receipt reference.").max(120),
  note: optionalText(500),
});

/** Record money received outside Stripe. It counts only once someone verifies it against the bank statement. */
export async function recordPayment(ctx: AccessContext, firmId: string, raw: unknown) {
  ctx.require("payments:verify", firmId);
  const input = parseOrThrow(paymentSchema, raw);
  if (input.amount <= 0) throw new ValidationError("Enter an amount above zero.", { amount: "Must be positive." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    let clientId = input.clientId ?? null;
    if (input.invoiceId) {
      const inv = await loadInvoice(tx, firmId, input.invoiceId);
      if (inv.status === "draft" || inv.status === "void") throw new ValidationError("Payments go against issued invoices.");
      if (inv.currency !== input.currency) throw new ValidationError(`This invoice is in ${inv.currency}.`, { currency: "Currency differs from the invoice." });
      clientId = inv.clientId;
    }
    const [p] = await tx.insert(payments).values({ firmId, invoiceId: input.invoiceId ?? null, clientId, amountMinor: input.amount, currency: input.currency, method: input.method, status: "pending", receivedOn: input.receivedOn, reference: input.reference, note: input.note ?? null, recordedById: ctx.user.id, provider: "manual", providerRef: null }).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "payment.recorded", entityType: "payment", entityId: p.id, summary: `Recorded ${input.currency} ${(input.amount / 100).toFixed(2)} (${input.method}, ref ${input.reference}); awaiting verification`, ip: ctx.ip }, tx);
    return p;
  });
}

/**
 * Verify a recorded payment against the bank statement. Someone other than
 * the person who recorded it verifies, unless they administer the practice.
 */
export async function verifyPayment(ctx: AccessContext, firmId: string, paymentId: string, statementRef: string) {
  ctx.require("payments:verify", firmId);
  const ref = statementRef.trim();
  if (ref.length < 3) throw new ValidationError("Enter the bank statement line or reference you checked.", { statementRef: "Required." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.firmId, firmId))).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "pending") throw new ConflictError("This payment has already been handled.");
    if (p.recordedById === ctx.user.id && !ctx.has("firm:manage", firmId)) throw new AccessDeniedError("payments:verify (second person)");
    const [v] = await tx.update(payments).set({ status: "verified", verifiedAt: new Date(), verifiedById: ctx.user.id, note: [p.note, `Verified against: ${ref.slice(0, 200)}`].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(payments.id, p.id)).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "payment.verified", entityType: "payment", entityId: p.id, summary: `Verified ${p.currency} ${(p.amountMinor / 100).toFixed(2)} against ${ref.slice(0, 80)}`, ip: ctx.ip }, tx);
    if (p.invoiceId) await recompute(tx, p.invoiceId);
    return v;
  });
}

export async function rejectPayment(ctx: AccessContext, firmId: string, paymentId: string, reason: string) {
  ctx.require("payments:verify", firmId);
  if (reason.trim().length < 5) throw new ValidationError("Say why the payment is rejected.", { reason: "Required." });
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.firmId, firmId))).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.status !== "pending") throw new ConflictError("Only pending payments can be rejected.");
    await tx.update(payments).set({ status: "rejected", rejectedReason: reason.trim().slice(0, 500), updatedAt: new Date() }).where(eq(payments.id, p.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "payment.rejected", entityType: "payment", entityId: p.id, summary: `Rejected a recorded payment: ${reason.trim().slice(0, 120)}`, ip: ctx.ip }, tx);
  });
}

/** Allocate an unallocated verified or pending payment to an issued invoice of the same client and currency. */
export async function allocatePayment(ctx: AccessContext, firmId: string, paymentId: string, invoiceId: string) {
  ctx.require("payments:verify", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.firmId, firmId))).for("update");
    if (!p) throw new NotFoundError("Payment");
    if (p.invoiceId) throw new ConflictError("This payment is already allocated.");
    const inv = await loadInvoice(tx, firmId, invoiceId, true);
    if (inv.status === "draft" || inv.status === "void") throw new ValidationError("Allocate to an issued invoice.");
    if (inv.currency !== p.currency) throw new ValidationError("The currencies differ.");
    if (p.clientId && p.clientId !== inv.clientId) throw new ValidationError("That invoice belongs to another client.");
    await tx.update(payments).set({ invoiceId: inv.id, clientId: inv.clientId, updatedAt: new Date() }).where(eq(payments.id, p.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "payment.allocated", entityType: "payment", entityId: p.id, summary: `Allocated a payment to ${inv.number}`, ip: ctx.ip }, tx);
    return recompute(tx, inv.id);
  });
}

/** Payments needing attention: pending verification, and verified money not allocated to an invoice. */
export async function reconciliationQueue(ctx: AccessContext, firmId: string) {
  ctx.require("invoices:view", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const rows = await tx
      .select({ p: payments, invoiceNumber: invoices.number, clientName: sql<string | null>`(select c.first_name || coalesce(' ' || c.last_name, '') from clients c where c.id = ${payments.clientId})`, recordedBy: users.name })
      .from(payments)
      .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
      .leftJoin(users, eq(users.id, payments.recordedById))
      .where(and(eq(payments.firmId, firmId), or(eq(payments.status, "pending"), and(eq(payments.status, "verified"), isNull(payments.invoiceId)))))
      .orderBy(asc(payments.receivedOn));
    return rows.map((r) => ({ ...r.p, invoiceNumber: r.invoiceNumber, clientName: r.clientName, recordedBy: r.recordedBy }));
  });
}

/* ───────── Reports ───────── */

/** Operational summary per currency: billed, received, outstanding, overdue and ageing. Not accounting reports. */
export async function financeSummary(ctx: AccessContext, firmId: string, range: { from: string; to: string }) {
  ctx.require("invoices:view", firmId);
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.to < range.from) throw new ValidationError("Choose a valid date range.");
  const t = today();
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const billed = await tx
      .select({ currency: invoices.currency, amount: sum(invoices.totalMinor), n: count() })
      .from(invoices)
      .where(and(eq(invoices.firmId, firmId), inArray(invoices.status, ["issued", "partially_paid", "paid", "credited"]), sql`${invoices.issueDate} between ${range.from} and ${range.to}`))
      .groupBy(invoices.currency);
    const received = await tx
      .select({ currency: payments.currency, amount: sum(payments.amountMinor), n: count() })
      .from(payments)
      .where(and(eq(payments.firmId, firmId), eq(payments.status, "verified"), sql`${payments.receivedOn} between ${range.from} and ${range.to}`))
      .groupBy(payments.currency);
    const outstanding = await tx
      .select({
        currency: invoices.currency,
        amount: sql<number>`sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.creditedMinor})::bigint`,
        overdue: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.creditedMinor}) filter (where ${invoices.dueDate} < ${t}), 0)::bigint`,
        current: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.creditedMinor}) filter (where ${invoices.dueDate} >= ${t}), 0)::bigint`,
        d30: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.creditedMinor}) filter (where ${invoices.dueDate} < ${t} and ${invoices.dueDate} >= (${t}::date - 30)), 0)::bigint`,
        d60: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.creditedMinor}) filter (where ${invoices.dueDate} < (${t}::date - 30) and ${invoices.dueDate} >= (${t}::date - 60)), 0)::bigint`,
        d90: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor} - ${invoices.creditedMinor}) filter (where ${invoices.dueDate} < (${t}::date - 60)), 0)::bigint`,
        n: count(),
      })
      .from(invoices)
      .where(and(eq(invoices.firmId, firmId), inArray(invoices.status, ["issued", "partially_paid"])))
      .groupBy(invoices.currency);
    const [pending] = await tx.select({ n: count() }).from(payments).where(and(eq(payments.firmId, firmId), eq(payments.status, "pending")));
    const currencies = [...new Set([...billed, ...received, ...outstanding].map((r) => r.currency))].sort();
    return {
      range,
      byCurrency: currencies.map((c) => {
        const b = billed.find((r) => r.currency === c);
        const r = received.find((x) => x.currency === c);
        const o = outstanding.find((x) => x.currency === c);
        return {
          currency: c,
          billed: Number(b?.amount ?? 0), billedCount: Number(b?.n ?? 0),
          received: Number(r?.amount ?? 0), receivedCount: Number(r?.n ?? 0),
          outstanding: Number(o?.amount ?? 0), openCount: Number(o?.n ?? 0), overdue: Number(o?.overdue ?? 0),
          ageing: { current: Number(o?.current ?? 0), d30: Number(o?.d30 ?? 0), d60: Number(o?.d60 ?? 0), d90: Number(o?.d90 ?? 0) },
        };
      }),
      pendingPayments: Number(pending?.n ?? 0),
    };
  });
}

/** Draft options: clients and their matters, accepted proposals not fully invoiced. */
export async function invoiceFormOptions(ctx: AccessContext, firmId: string) {
  ctx.require("invoices:edit", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const cl = await tx.select({ id: clients.id, ref: clients.ref, firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(and(eq(clients.firmId, firmId), isNull(clients.deletedAt))).orderBy(asc(clients.firstName)).limit(1000);
    const { matterVisibility } = await import("../matters/matters");
    const ms = ctx.has("matters:view_all", firmId) || ctx.has("matters:view_assigned", firmId)
      ? await tx.select({ id: matters.id, ref: matters.ref, title: matters.title, clientId: matters.clientId }).from(matters).where(and(...matterVisibility(ctx, firmId))).orderBy(desc(matters.openedAt)).limit(1000)
      : [];
    const billing = await billingTx(tx, firmId, ctx.firm(firmId).refPrefix);
    return { clients: cl, matters: ms, billing };
  });
}

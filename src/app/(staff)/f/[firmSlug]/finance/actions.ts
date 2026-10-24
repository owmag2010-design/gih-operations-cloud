"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/server/errors";
import {
  allocatePayment, createInvoice, creditInvoice, invoiceFromProposal, issueInvoice, recordPayment, rejectPayment, saveBilling, updateDraft, verifyPayment, voidInvoice,
} from "@/server/modules/finance/finance";
import { createPaymentLink } from "@/server/modules/finance/stripe-payments";
import { requireFirm } from "@/server/next/session";

type Ctx = Awaited<ReturnType<typeof requireFirm>>["ctx"];
const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, String(f.get(k))]));

async function run(slug: string, fn: (firmId: string, ctx: Ctx) => Promise<unknown>, message: string): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  try {
    await fn(firm.firmId, ctx);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/finance`, "layout");
  return { ok: true, message };
}

export async function createInvoiceAction(slug: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    id = (await createInvoice(ctx, firm.firmId, data(form))).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/finance`, "layout");
  redirect(`/f/${slug}/finance/invoices/${id}`);
}

export async function invoiceFromProposalAction(slug: string, proposalId: string, part: "deposit" | "balance" | "full"): Promise<ActionResult> {
  const { ctx, firm } = await requireFirm(slug);
  let id: string;
  try {
    id = (await invoiceFromProposal(ctx, firm.firmId, proposalId, part)).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/f/${slug}/finance`, "layout");
  redirect(`/f/${slug}/finance/invoices/${id}`);
}

export type DraftLine = { kind: string; description: string; quantity: string; unit: string; taxable: boolean };

export async function saveDraftAction(slug: string, id: string, fields: Record<string, string>, lines: DraftLine[]): Promise<ActionResult> {
  return run(slug, (f, ctx) => updateDraft(ctx, f, id, fields, lines), "Draft saved.");
}

export async function issueInvoiceAction(slug: string, id: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const issueDate = String(form.get("issueDate") ?? "") || undefined;
  const dueDaysRaw = String(form.get("dueDays") ?? "");
  const dueDays = dueDaysRaw === "" ? undefined : Number(dueDaysRaw);
  if (dueDays !== undefined && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 120)) return { ok: false, error: "Payment terms are 0 to 120 days.", fieldErrors: { dueDays: "0 to 120 days." } };
  return run(slug, (f, ctx) => issueInvoice(ctx, f, id, { issueDate, dueDays }), "Invoice issued.");
}

export async function voidInvoiceAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => voidInvoice(ctx, f, id, String(form.get("reason") ?? "")), "Invoice voided.");
}

export async function creditInvoiceAction(slug: string, id: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => creditInvoice(ctx, f, id, data(form)), "Credit note issued.");
}

export async function recordPaymentAction(slug: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => recordPayment(ctx, f, data(form)), "Payment recorded. Someone else verifies it against the bank statement.");
}

export async function verifyPaymentAction(slug: string, paymentId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => verifyPayment(ctx, f, paymentId, String(form.get("statementRef") ?? "")), "Payment verified.");
}

export async function rejectPaymentAction(slug: string, paymentId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => rejectPayment(ctx, f, paymentId, String(form.get("reason") ?? "")), "Payment rejected.");
}

export async function allocatePaymentAction(slug: string, paymentId: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => allocatePayment(ctx, f, paymentId, String(form.get("invoiceId") ?? "")), "Payment allocated.");
}

export async function paymentLinkAction(slug: string, id: string): Promise<ActionResult> {
  return run(slug, (f, ctx) => createPaymentLink(ctx, f, id), "Payment link created.");
}

export async function saveBillingAction(slug: string, _: ActionResult | null, form: FormData) {
  return run(slug, (f, ctx) => saveBilling(ctx, f, data(form)), "Billing settings saved.");
}

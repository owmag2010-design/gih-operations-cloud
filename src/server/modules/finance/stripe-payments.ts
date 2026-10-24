import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { db, withScope } from "../../db/client";
import { invoices, paymentEvents, payments } from "../../db/schema";
import { env } from "../../env";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { stripe, stripeConfigured, verifyStripeSignature } from "../../integrations/stripe";
import { recompute } from "./finance";

/** Create a Stripe Checkout link for an invoice's unpaid balance. */
export async function createPaymentLink(ctx: AccessContext, firmId: string, invoiceId: string) {
  ctx.require("invoices:issue", firmId);
  if (!stripeConfigured()) throw new ValidationError("Stripe isn't connected: add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in the hosting settings.");
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.firmId, firmId))).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status !== "issued" && inv.status !== "partially_paid") throw new ConflictError("Payment links are for issued invoices with a balance.");
    const balance = inv.totalMinor - inv.paidMinor - inv.creditedMinor;
    if (balance <= 0) throw new ConflictError("Nothing is owing on this invoice.");
    const base = env().APP_URL.replace(/\/$/, "");
    const session = await stripe().createCheckout({
      amountMinor: balance,
      currency: inv.currency,
      description: `${ctx.firm(firmId).tradingName} invoice ${inv.number}`,
      customerEmail: inv.billToEmail,
      successUrl: `${base}/pay/thanks`,
      cancelUrl: `${base}/pay/cancelled`,
      metadata: { gih_firm_id: firmId, gih_invoice_id: inv.id, gih_invoice_number: inv.number ?? "" },
    });
    await tx.update(invoices).set({ checkoutSessionId: session.id, checkoutUrl: session.url, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: "invoice.payment_link", entityType: "invoice", entityId: inv.id, summary: `Created a Stripe payment link for ${inv.number} (${inv.currency} ${(balance / 100).toFixed(2)})`, ip: ctx.ip }, tx);
    return session;
  });
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/**
 * Handle a Stripe webhook. Only signed events are accepted; each event is
 * processed once. A completed, paid Checkout Session creates a verified
 * payment for the invoice it was created for. Refunds mark the payment refunded.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<{ status: number; outcome: string }> {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return { status: 503, outcome: "not configured" };
  if (!verifyStripeSignature(rawBody, signature, secret)) return { status: 400, outcome: "bad signature" };
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return { status: 400, outcome: "bad payload" };
  }
  const obj = event.data?.object ?? {};
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const firmId = /^[0-9a-f-]{36}$/i.test(meta.gih_firm_id ?? "") ? meta.gih_firm_id : null;
  const orgRow = firmId ? (await db().execute<{ org_id: string }>(sql`select org_id from firms where id = ${firmId}`)).rows[0] : undefined;
  const scope = { orgId: orgRow?.org_id ?? "00000000-0000-0000-0000-000000000000", userId: null, firmIds: firmId && orgRow ? [firmId] : [], paymentsSystem: true };

  return withScope(scope, async (tx) => {
    const inserted = await tx.insert(paymentEvents).values({ provider: "stripe", eventId: event.id, type: event.type, firmId: orgRow ? firmId : null, payload: event as unknown as Record<string, unknown> }).onConflictDoNothing().returning({ id: paymentEvents.id });
    if (!inserted.length) return { status: 200, outcome: "duplicate" };
    const done = async (outcome: string) => {
      await tx.update(paymentEvents).set({ outcome, processedAt: new Date() }).where(eq(paymentEvents.id, inserted[0].id));
      return { status: 200, outcome };
    };
    if (!firmId || !orgRow) return done("ignored: not one of our invoices");

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (obj.payment_status !== "paid") return done("ignored: not paid yet");
      const invoiceId = meta.gih_invoice_id;
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.firmId, firmId)));
      const amount = Number(obj.amount_total);
      const currency = String(obj.currency ?? "").toUpperCase();
      const intent = String(obj.payment_intent ?? obj.id);
      if (!Number.isInteger(amount) || amount <= 0) return done("ignored: no amount");
      // Money arrived: record it as verified by Stripe. Allocate only when it matches the invoice it was created for.
      const matches = !!inv && inv.checkoutSessionId === obj.id && inv.currency === currency && inv.status !== "void" && inv.status !== "draft";
      const [p] = await tx
        .insert(payments)
        .values({
          firmId, invoiceId: matches ? inv!.id : null, clientId: inv?.clientId ?? null, amountMinor: amount, currency, method: "stripe", status: "verified", provider: "stripe", providerRef: intent,
          receivedOn: new Date(((obj.created as number) ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10), reference: String(obj.id), verifiedAt: new Date(), verifiedBy: "Stripe (signed webhook)",
          note: matches ? null : "Received through Stripe but didn't match the invoice's current payment link; allocate it manually.",
        })
        .onConflictDoNothing()
        .returning();
      if (!p) return done("duplicate payment");
      if (matches) await recompute(tx, inv!.id);
      return done(matches ? `paid ${inv!.number}` : "payment held for manual allocation");
    }

    if (event.type === "charge.refunded") {
      const intent = String(obj.payment_intent ?? "");
      const [p] = await tx.select().from(payments).where(and(eq(payments.provider, "stripe"), eq(payments.providerRef, intent), eq(payments.firmId, firmId)));
      if (!p) return done("ignored: unknown payment");
      if (obj.amount_refunded !== obj.amount) return done("partial refund: review manually");
      await tx.update(payments).set({ status: "refunded", updatedAt: new Date() }).where(eq(payments.id, p.id));
      if (p.invoiceId) await recompute(tx, p.invoiceId);
      return done("refunded");
    }
    return done("ignored: event type");
  });
}

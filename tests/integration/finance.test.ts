import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { AccessDeniedError, ConflictError, ValidationError } from "../../src/server/errors";
import { __setStripeTestDouble } from "../../src/server/integrations/stripe";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import {
  allocatePayment, computeTotals, createInvoice, creditInvoice, financeSummary, getInvoice, issueInvoice, listInvoices, recordPayment, reconciliationQueue,
  saveBilling, updateDraft, verifyPayment, voidInvoice,
} from "../../src/server/modules/finance/finance";
import { createPaymentLink, handleStripeWebhook } from "../../src/server/modules/finance/stripe-payments";
import { firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

const SECRET = "whsec_test_secret_for_automated_checks";

function signed(body: object) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
  return { raw, header: `t=${t},v1=${sig}` };
}

async function setup() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ firms: { veritas: "firm_admin" } });
  const finance = await makeUser({ firms: { veritas: "finance_officer" } });
  const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
  const { lead: l } = await createLead(consultant, veritas, lead());
  const { client } = await convertLead(consultant, veritas, l.id);
  return { veritas, admin, finance, consultant, client };
}

const lines = [
  { kind: "professional", description: "Professional fee", quantity: "1", unit: "10000", taxable: "on" },
  { kind: "government", description: "VFS fee", quantity: "1", unit: "2550", taxable: "" },
];

describe("finance", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => __setStripeTestDouble(null));

  it("computes totals with discounts and tax on taxable lines only", () => {
    expect(computeTotals([{ kind: "professional", description: "x", quantity: 2, unitMinor: 50000, taxable: true }, { kind: "government", description: "y", quantity: 1, unitMinor: 10000, taxable: false }], 1500))
      .toEqual({ subtotal: 110000, discount: 0, tax: 15000, total: 125000 });
    expect(computeTotals([{ kind: "professional", description: "x", quantity: 1, unitMinor: 100000, taxable: true }, { kind: "discount", description: "d", quantity: 1, unitMinor: -10000, taxable: false }], 1500))
      .toEqual({ subtotal: 100000, discount: 10000, tax: 13500, total: 103500 });
  });

  it("drafts, issues with gap-free numbering, and locks issued invoices", async () => {
    const { veritas, finance, consultant, client } = await setup();
    const draft = await createInvoice(consultant, veritas, { clientId: client.id }, lines);
    expect(draft).toMatchObject({ status: "draft", number: null, totalMinor: 1255000 });
    await expect(issueInvoice(consultant, veritas, draft.id)).rejects.toBeInstanceOf(AccessDeniedError);
    const issued = await issueInvoice(finance, veritas, draft.id);
    expect(issued.number).toBe("VE-INV-000001");
    expect(issued.status).toBe("issued");
    await expect(updateDraft(consultant, veritas, draft.id, { billToName: "X Y", currency: "ZAR" }, lines)).rejects.toBeInstanceOf(ConflictError);
    // The database refuses changes to an issued invoice's amounts and lines, whatever the code does.
    const dbError = (p: Promise<unknown>) => p.then(() => "no error", (e: { cause?: { message?: string }; message?: string }) => e.cause?.message ?? e.message ?? "");
    expect(await dbError(owner.execute(sql`update invoices set total_minor = 1, subtotal_minor = 1 where id = ${draft.id}`))).toMatch(/issued invoice/);
    expect(await dbError(owner.execute(sql`delete from invoice_lines where invoice_id = ${draft.id}`))).toMatch(/issued invoice/);
    const second = await createInvoice(consultant, veritas, { clientId: client.id }, lines);
    await voidInvoice(finance, veritas, second.id, "Created by mistake");
    const third = await createInvoice(consultant, veritas, { clientId: client.id }, lines);
    expect((await issueInvoice(finance, veritas, third.id)).number).toBe("VE-INV-000002");
    // Other practices have their own numbering and never see these.
    const mimshac = await makeUser({ firms: { mimshac: "firm_admin" } });
    await expect(listInvoices(mimshac, veritas)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("counts only verified payments, needs a second person to verify, and supports credit notes", async () => {
    const { veritas, admin, finance, client } = await setup();
    const inv = await issueInvoice(admin, veritas, (await createInvoice(admin, veritas, { clientId: client.id }, lines)).id);
    const p = await recordPayment(finance, veritas, { invoiceId: inv.id, amount: "5000", currency: "ZAR", method: "eft", receivedOn: "2026-10-23", reference: "FNB 123" });
    expect((await getInvoice(finance, veritas, inv.id)).invoice).toMatchObject({ status: "issued", paidMinor: 0 });
    await expect(verifyPayment(finance, veritas, p.id, "Statement 23 Oct line 4")).rejects.toBeInstanceOf(AccessDeniedError);
    await verifyPayment(admin, veritas, p.id, "Statement 23 Oct line 4");
    let view = await getInvoice(finance, veritas, inv.id);
    expect(view.invoice).toMatchObject({ status: "partially_paid", paidMinor: 500000, balanceMinor: 755000 });
    await expect(voidInvoice(admin, veritas, inv.id, "Wrong client entirely")).rejects.toBeInstanceOf(ConflictError);
    await expect(creditInvoice(admin, veritas, inv.id, { amount: "999999", reason: "Too much credit" })).rejects.toBeInstanceOf(ValidationError);
    const cn = await creditInvoice(admin, veritas, inv.id, { amount: "7550", reason: "Fee waived after review" });
    expect(cn.number).toBe("VE-CN-000001");
    view = await getInvoice(finance, veritas, inv.id);
    expect(view.invoice).toMatchObject({ status: "paid", creditedMinor: 755000, balanceMinor: 0 });

    const summary = await financeSummary(finance, veritas, { from: "2026-01-01", to: "2026-12-31" });
    expect(summary.byCurrency[0]).toMatchObject({ currency: "ZAR", billed: 1255000, received: 500000, outstanding: 0 });
  });

  it("marks invoices paid only from signed Stripe webhooks, once", async () => {
    const { veritas, admin, client } = await setup();
    await saveBilling(admin, veritas, { invoicePrefix: "VE-INV", creditNotePrefix: "VE-CN", defaultCurrency: "ZAR", paymentTermsDays: "14" });
    const inv = await issueInvoice(admin, veritas, (await createInvoice(admin, veritas, { clientId: client.id }, lines)).id);
    __setStripeTestDouble({ async createCheckout(i) { expect(i.amountMinor).toBe(1255000); return { id: "cs_test_123", url: "https://checkout.stripe.test/cs_test_123" }; } });
    await createPaymentLink(admin, veritas, inv.id);

    const evt = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_123", payment_status: "paid", amount_total: 1255000, currency: "zar", payment_intent: "pi_1", created: 1792800000, metadata: { gih_firm_id: veritas, gih_invoice_id: inv.id } } } };
    const forged = { raw: JSON.stringify(evt), header: "t=1,v1=deadbeef" };
    expect((await handleStripeWebhook(forged.raw, forged.header)).status).toBe(400);
    expect((await getInvoice(admin, veritas, inv.id)).invoice.status).toBe("issued");

    const ok = signed(evt);
    expect(await handleStripeWebhook(ok.raw, ok.header)).toMatchObject({ status: 200, outcome: "paid VE-INV-000001" });
    expect((await handleStripeWebhook(ok.raw, ok.header)).outcome).toBe("duplicate");
    const view = await getInvoice(admin, veritas, inv.id);
    expect(view.invoice).toMatchObject({ status: "paid", paidMinor: 1255000 });
    expect(view.payments[0]).toMatchObject({ method: "stripe", status: "verified", verifiedBy: "Stripe (signed webhook)" });

    // A payment for a session that isn't the invoice's current link is held for manual allocation.
    const inv2 = await issueInvoice(admin, veritas, (await createInvoice(admin, veritas, { clientId: client.id }, lines)).id);
    const stray = signed({ ...evt, id: "evt_2", data: { object: { ...evt.data.object, id: "cs_old", payment_intent: "pi_2", metadata: { gih_firm_id: veritas, gih_invoice_id: inv2.id } } } });
    expect((await handleStripeWebhook(stray.raw, stray.header)).outcome).toBe("payment held for manual allocation");
    const queue = await reconciliationQueue(admin, veritas);
    expect(queue.map((q) => q.providerRef)).toEqual(["pi_2"]);
    await allocatePayment(admin, veritas, queue[0].id, inv2.id);
    expect((await getInvoice(admin, veritas, inv2.id)).invoice.status).toBe("paid");

    // Refund reverses it.
    const refund = signed({ id: "evt_3", type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount: 1255000, amount_refunded: 1255000, metadata: { gih_firm_id: veritas } } } });
    expect((await handleStripeWebhook(refund.raw, refund.header)).outcome).toBe("refunded");
    expect((await getInvoice(admin, veritas, inv.id)).invoice.status).toBe("issued");
    const events = await owner.select().from(s.paymentEvents).where(eq(s.paymentEvents.provider, "stripe"));
    expect(events).toHaveLength(3);
  });
});

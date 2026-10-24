import { handleStripeWebhook } from "@/server/modules/finance/stripe-payments";

export const runtime = "nodejs";

/** Stripe webhook: checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 512_000) return Response.json({ error: "too large" }, { status: 413 });
  const r = await handleStripeWebhook(raw, request.headers.get("stripe-signature"));
  return Response.json({ outcome: r.outcome }, { status: r.status });
}

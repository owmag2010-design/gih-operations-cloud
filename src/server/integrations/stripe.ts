import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

/**
 * Minimal Stripe client (REST, no SDK): Checkout Sessions for invoice
 * payments, and webhook signature verification. Use test keys until the
 * practice has confirmed live payments.
 */

export type CheckoutInput = { amountMinor: number; currency: string; description: string; customerEmail: string | null; successUrl: string; cancelUrl: string; metadata: Record<string, string> };
export interface StripeApi {
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
}

let double: StripeApi | null = null;
export function __setStripeTestDouble(api: StripeApi | null) {
  double = api;
}

export function stripeConfigured() {
  return !!double || !!env().STRIPE_SECRET_KEY;
}
export function stripeMode(): "test" | "live" | null {
  const k = env().STRIPE_SECRET_KEY;
  return k ? (k.startsWith("sk_live_") || k.startsWith("rk_live_") ? "live" : "test") : double ? "test" : null;
}

const live: StripeApi = {
  async createCheckout(i) {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": i.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(i.amountMinor),
      "line_items[0][price_data][product_data][name]": i.description.slice(0, 250),
      "payment_intent_data[description]": i.description.slice(0, 250),
    });
    if (i.customerEmail) body.set("customer_email", i.customerEmail);
    for (const [k, v] of Object.entries(i.metadata)) {
      body.set(`metadata[${k}]`, v);
      body.set(`payment_intent_data[metadata][${k}]`, v);
    }
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env().STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !json.id || !json.url) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return { id: json.id, url: json.url };
  },
};

export function stripe(): StripeApi {
  return double ?? live;
}

/**
 * Verify a Stripe-Signature header (v1 scheme) against the raw body. Rejects
 * signatures older than five minutes to prevent replay.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-gih-signature";
export const TIMESTAMP_HEADER = "x-gih-timestamp";
const MAX_SKEW_SECONDS = 300;

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, hex-encoded. Senders compute the same. */
export function signPayload(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

/** Verify signature and freshness (stops replay of captured requests). */
export function verifySignature(secret: string, headers: { signature: string | null; timestamp: string | null }, rawBody: string, now = Date.now()): SignatureCheck {
  const { signature, timestamp } = headers;
  if (!signature || !timestamp || !/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: "missing" };
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

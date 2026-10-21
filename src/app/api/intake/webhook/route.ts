import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { organisations } from "@/server/db/schema";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { receiveIntake } from "@/server/modules/intake/intake";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/server/modules/intake/webhook";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Signed intake webhook for the Hub enquiry form, Tally, the WhatsApp intake
 * bot and other approved senders. See docs/09-api.md for the contract.
 * Responses never echo personal information back.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });

  const check = verifySignature(env().INTAKE_WEBHOOK_SECRET, { signature: request.headers.get(SIGNATURE_HEADER), timestamp: request.headers.get(TIMESTAMP_HEADER) }, raw);
  if (!check.ok) return Response.json({ error: "invalid_signature", reason: check.reason }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const [org] = await db().select({ id: organisations.id }).from(organisations).where(eq(organisations.slug, "gih")).limit(1);
  if (!org) return Response.json({ error: "not_configured" }, { status: 503 });

  try {
    const { item, created } = await receiveIntake(org.id, body);
    return Response.json({ id: item.id, created, status: item.status, routingSuggested: !!item.suggestedFirmId, flags: item.flags }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof ValidationError) return Response.json({ error: "validation_failed", fields: err.fieldErrors }, { status: 422 });
    console.error("[intake webhook]", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

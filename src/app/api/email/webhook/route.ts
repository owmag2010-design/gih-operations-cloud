import { env } from "@/server/env";
import { verifyWebhook } from "@/server/integrations/resend";
import { ingestReceived, recordDelivery } from "@/server/modules/email/mail";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 256 * 1024;

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const DELIVERY: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

/**
 * Resend webhook: received email (stored in the right inbox) and delivery
 * events for email we sent. Signed with Svix; nothing personal is echoed back.
 */
export async function POST(request: Request) {
  const raw = await readCapped(request);
  if (raw === null) return Response.json({ error: "payload_too_large" }, { status: 413 });
  const ok = verifyWebhook(raw, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, env().RESEND_WEBHOOK_SECRET);
  if (!ok) return Response.json({ error: "invalid_signature" }, { status: 401 });

  let event: { type?: string; data?: { email_id?: string; bounce?: { message?: string }; failed?: { reason?: string } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = event.data?.email_id;
  if (!id) return Response.json({ ok: true, ignored: true });

  if (event.type === "email.received") {
    try {
      const out = await ingestReceived(id);
      return Response.json({ ok: true, status: out.status });
    } catch (err) {
      console.error("[email webhook] could not store received email", err instanceof Error ? err.message : err);
      return Response.json({ error: "retry" }, { status: 500 }); // Resend retries
    }
  }
  const status = event.type ? DELIVERY[event.type] : undefined;
  if (status) {
    await recordDelivery(id, status, event.data?.bounce?.message ?? event.data?.failed?.reason);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: true, ignored: true });
}

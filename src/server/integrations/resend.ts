import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

export type ResendSend = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

export type ResendResult = { status: "sent"; id: string | null } | { status: "not_configured" } | { status: "failed"; error: string };

export function resendConfigured() {
  return Boolean(env().RESEND_API_KEY);
}

/** Send one email. Never throws: failures come back as a status the caller records. */
export async function resendSend(msg: ResendSend): Promise<ResendResult> {
  const key = env().RESEND_API_KEY;
  if (!key) return { status: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: msg.from,
        to: msg.to,
        cc: msg.cc?.length ? msg.cc : undefined,
        bcc: msg.bcc?.length ? msg.bcc : undefined,
        attachments: msg.attachments?.length ? msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })) : undefined,
        reply_to: msg.replyTo,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { status: "failed", error: `Resend ${res.status}: ${body.message ?? "request refused"}`.slice(0, 300) };
    return { status: "sent", id: body.id ?? null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "Network error" };
  }
}

export type ReceivedEmail = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  html: string | null;
  text: string | null;
  headers: Record<string, string> | null;
  cc: string[] | null;
  reply_to: string[] | null;
  received_for?: string[] | null;
  message_id: string | null;
  created_at: string;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: { id: string; filename: string; content_type: string; size?: number | null }[];
};

export async function resendGetReceived(id: string): Promise<ReceivedEmail | null> {
  const key = env().RESEND_API_KEY;
  if (!key || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const res = await fetch(`https://api.resend.com/emails/receiving/${id}?html_format=cid`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} fetching received email`);
  return (await res.json()) as ReceivedEmail;
}

/**
 * Verify a Svix-signed webhook (Resend uses Svix). Signed content is
 * `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256 with the base64
 * secret after the `whsec_` prefix. Rejects anything older than 5 minutes.
 */
export function verifyWebhook(raw: string, h: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${raw}`).digest();
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Download one attachment of a received email (for storing it in the dashboard). */
export async function resendGetReceivedAttachment(emailId: string, attachmentId: string): Promise<{ data: Buffer; contentType: string; filename: string } | null> {
  const key = env().RESEND_API_KEY;
  if (!key || !/^[0-9a-f-]{36}$/i.test(emailId) || !/^[0-9a-zA-Z_-]{1,80}$/.test(attachmentId)) return null;
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const meta = (await res.json()) as { download_url?: string; filename?: string; content_type?: string };
  if (!meta.download_url) return null;
  const file = await fetch(meta.download_url, { signal: AbortSignal.timeout(30_000) });
  if (!file.ok) return null;
  return { data: Buffer.from(await file.arrayBuffer()), contentType: meta.content_type ?? "application/octet-stream", filename: meta.filename ?? "attachment" };
}

import "server-only";
import { db } from "../db/client";
import { emailOutbox } from "../db/schema";
import { env } from "../env";

export type OutgoingEmail = {
  orgId: string;
  firmId?: string | null;
  to: string;
  subject: string;
  template: string;
  html: string;
  text: string;
};

export type EmailResult = { status: "sent" | "not_configured" | "failed"; error?: string };

/**
 * Send through Resend when RESEND_API_KEY is set. Without it, nothing is sent:
 * the attempt is recorded as `not_configured` so the screen can say so plainly.
 * The email body is never stored (it may hold single-use links).
 */
export async function sendEmail(email: OutgoingEmail): Promise<EmailResult> {
  const { RESEND_API_KEY, EMAIL_FROM } = env();
  let result: EmailResult;
  let providerMessageId: string | null = null;

  if (!RESEND_API_KEY) {
    result = { status: "not_configured" };
  } else {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        providerMessageId = body.id ?? null;
        result = { status: "sent" };
      } else {
        result = { status: "failed", error: `Resend responded ${res.status}` };
      }
    } catch (err) {
      result = { status: "failed", error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  await db().insert(emailOutbox).values({
    orgId: email.orgId,
    firmId: email.firmId ?? null,
    toAddress: email.to,
    subject: email.subject,
    template: email.template,
    status: result.status,
    providerMessageId,
    error: result.error ?? null,
  });
  return result;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, client-safe layout. Firm branding arrives with the communication centre (Release 6). */
export function simpleEmail(opts: { heading: string; body: string[]; actionLabel: string; actionUrl: string; footer: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f7f5f2;font-family:Arial,Helvetica,sans-serif;color:#2b2926">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e3dd;border-radius:10px">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a847b">Global Immigration Hub</p>
<h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${esc(opts.heading)}</h1>
${opts.body.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${esc(p)}</p>`).join("")}
<p style="margin:20px 0"><a href="${esc(opts.actionUrl)}" style="display:inline-block;background:#2b2926;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:7px;font-size:14px">${esc(opts.actionLabel)}</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#8a847b">${esc(opts.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${opts.heading}\n\n${opts.body.join("\n\n")}\n\n${opts.actionLabel}: ${opts.actionUrl}\n\n${opts.footer}`;
  return { html, text };
}

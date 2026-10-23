import { randomBytes } from "node:crypto";

/**
 * Minimal RFC 5322 / MIME builder for sending through the Gmail API.
 * multipart/mixed( multipart/alternative(text, html), attachments… ).
 */

const CRLF = "\r\n";

/** Encode a header value if it isn't plain ASCII (RFC 2047). */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export function formatAddress(email: string, name?: string | null) {
  if (!name) return email;
  const n = name.replace(/["\\\r\n<>]/g, "");
  return /^[\x20-\x7e]*$/.test(n) ? `"${n}" <${email}>` : `${encodeHeader(n)} <${email}>`;
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, (m) => m + CRLF).trimEnd();

export type MimeInput = {
  from: { email: string; name: string | null };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string | null;
  references?: string | null;
  messageId?: string | null;
  attachments?: { filename: string; contentType: string; data: Buffer }[];
  date?: Date;
};

const safeHeaderId = (v: string | null | undefined) => (v && /^<[^\r\n<>\s]{3,250}>$/.test(v) ? v : null);

export function buildMime(m: MimeInput): string {
  const mixed = `mixed_${randomBytes(12).toString("hex")}`;
  const alt = `alt_${randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${formatAddress(m.from.email, m.from.name)}`,
    m.to.length ? `To: ${m.to.join(", ")}` : null,
    m.cc.length ? `Cc: ${m.cc.join(", ")}` : null,
    m.bcc.length ? `Bcc: ${m.bcc.join(", ")}` : null,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString()}`,
    safeHeaderId(m.messageId) ? `Message-ID: ${m.messageId}` : null,
    safeHeaderId(m.inReplyTo) ? `In-Reply-To: ${m.inReplyTo}` : null,
    safeHeaderId(m.inReplyTo) ? `References: ${[m.references, m.inReplyTo].filter(Boolean).join(" ")}` : null,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ].filter(Boolean);

  const parts: string[] = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(m.text, "utf8").toString("base64")),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(m.html, "utf8").toString("base64")),
    `--${alt}--`,
  ];
  for (const a of m.attachments ?? []) {
    const name = a.filename.replace(/["\r\n\\]/g, "_");
    parts.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType.replace(/[\r\n;"]/g, "")}; name="${encodeHeader(name)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(name)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap(a.data.toString("base64")),
    );
  }
  parts.push(`--${mixed}--`, "");
  return [...headers, "", ...parts].join(CRLF);
}

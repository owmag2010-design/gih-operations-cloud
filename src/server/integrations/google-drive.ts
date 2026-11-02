import "server-only";
import { createSign } from "node:crypto";
import { env } from "../env";

/**
 * Google Drive through a service account. The account acts as itself: each
 * client folder must be shared with its address (Editor), or sit in a shared
 * drive it belongs to. No user OAuth, no refresh tokens to expire.
 */

export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export type DriveUploadResult =
  | { status: "uploaded"; fileId: string; webViewLink: string | null }
  | { status: "not_configured" }
  | { status: "failed"; error: string };

/** Parse the key file pasted into GOOGLE_SERVICE_ACCOUNT_JSON; null if absent or unusable. */
export function serviceAccount(raw = env().GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n"), token_uri: parsed.token_uri };
  } catch {
    return null;
  }
}

/** Accept a folder link (…/folders/<id>?…) or a bare id. */
export function parseDriveFolderId(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const m = v.match(/\/folders\/([A-Za-z0-9_-]{10,100})/) ?? v.match(/[?&]id=([A-Za-z0-9_-]{10,100})/) ?? v.match(/^([A-Za-z0-9_-]{10,100})$/);
  return m ? m[1] : null;
}

const SCOPE = "https://www.googleapis.com/auth/drive";

/** RS256 JWT for the OAuth 2.0 JWT bearer grant. */
export function signedAssertion(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: nowSeconds, exp: nowSeconds + 3600 });
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${claims}`);
  return `${head}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;
}

let cachedToken: { token: string; expires: number; email: string } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(sa) }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
  cachedToken = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000, email: sa.client_email };
  return body.access_token;
}

/** Name files so a folder reads in date order: "2026-11-02 Police clearance - scan.pdf". */
export function driveFileName(original: string, label: string | null, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const clean = original.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "document";
  const prefix = label ? `${label.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80)} - ` : "";
  return `${day} ${prefix}${clean}`;
}

/** Upload one file into a folder (works for My Drive and shared drives). */
export async function uploadToDrive(
  input: { folderId: string; name: string; contentType: string; data: Buffer },
  sa: ServiceAccount | null = serviceAccount(),
): Promise<DriveUploadResult> {
  if (!sa) return { status: "not_configured" };
  try {
    const token = await accessToken(sa);
    const boundary = `gih${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name: input.name, parents: [input.folderId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${input.contentType || "application/octet-stream"}\r\n\r\n`),
      input.data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const out = (await res.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
    if (!res.ok || !out.id) {
      const hint = res.status === 404 ? " (is the folder shared with the service account?)" : "";
      return { status: "failed", error: `Drive responded ${res.status}: ${out.error?.message ?? "no detail"}${hint}` };
    }
    return { status: "uploaded", fileId: out.id, webViewLink: out.webViewLink ?? null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Test hook: forget the cached access token. */
export function resetDriveTokenCache() {
  cachedToken = null;
}

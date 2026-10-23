import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decodeKey, env } from "../../env";
import { ProviderAuthError, ProviderError, type Provider, type Tokens } from "./types";

/**
 * OAuth for provider mailboxes. Authorisation-code flow with a server-side
 * secret; tokens never reach the browser. The `state` parameter is signed and
 * bound to a browser cookie, so a callback can't be replayed or forged.
 */

const MS_SCOPES = ["openid", "email", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Mail.ReadWrite.Shared", "Mail.Send.Shared"];
const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];

export function providerConfigured(p: Provider): boolean {
  const e = env();
  return p === "microsoft" ? Boolean(e.MS_CLIENT_ID && e.MS_CLIENT_SECRET) : Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

/** What's missing before a provider can be connected (shown in settings, never hidden). */
export function providerSetupGap(p: Provider): string | null {
  if (providerConfigured(p)) return null;
  return p === "microsoft"
    ? "Microsoft 365 connections need an Azure app registration: set MS_CLIENT_ID and MS_CLIENT_SECRET in Vercel."
    : "Gmail connections need a Google Cloud OAuth client: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.";
}

export function redirectUri(p: Provider) {
  return `${env().APP_URL.replace(/\/$/, "")}/api/mail/oauth/${p}/callback`;
}

/* ───────────── signed state ───────────── */

export type OAuthState = { mailboxId: string | null; userId: string; provider: Provider; firmId: string | null; kind: "shared" | "personal"; nonce: string; exp: number };

function stateKey() {
  return createHmac("sha256", decodeKey(env().DATA_ENCRYPTION_KEY)!).update("mail-oauth-state").digest();
}

export function signState(s: Omit<OAuthState, "nonce" | "exp">, ttlSeconds = 600): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...s, nonce, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return { state: `${body}.${sig}`, nonce };
}

export function verifyState(state: string, cookieNonce: string | undefined): OAuthState | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
  if (!parsed.exp || parsed.exp < Date.now() / 1000) return null;
  if (!cookieNonce || cookieNonce.length !== parsed.nonce.length || !timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(parsed.nonce))) return null;
  return parsed;
}

/* ───────────── authorise, exchange, refresh ───────────── */

export function authorizeUrl(p: Provider, state: string, loginHint?: string | null) {
  const e = env();
  if (p === "microsoft") {
    const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(e.MS_TENANT || "common")}/oauth2/v2.0/authorize`);
    u.search = new URLSearchParams({ client_id: e.MS_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(p), response_mode: "query", scope: MS_SCOPES.join(" "), state, prompt: "select_account", ...(loginHint ? { login_hint: loginHint } : {}) }).toString();
    return u.toString();
  }
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({ client_id: e.GOOGLE_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(p), scope: GOOGLE_SCOPES.join(" "), state, access_type: "offline", prompt: "consent", include_granted_scopes: "true", ...(loginHint ? { login_hint: loginHint } : {}) }).toString();
  return u.toString();
}

function tokenEndpoint(p: Provider) {
  return p === "microsoft" ? `https://login.microsoftonline.com/${encodeURIComponent(env().MS_TENANT || "common")}/oauth2/v2.0/token` : "https://oauth2.googleapis.com/token";
}

function clientCreds(p: Provider) {
  const e = env();
  return p === "microsoft" ? { client_id: e.MS_CLIENT_ID, client_secret: e.MS_CLIENT_SECRET } : { client_id: e.GOOGLE_CLIENT_ID, client_secret: e.GOOGLE_CLIENT_SECRET };
}

async function tokenRequest(p: Provider, params: Record<string, string>, fetcher: typeof fetch = fetch): Promise<Tokens> {
  const res = await fetcher(tokenEndpoint(p), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...clientCreds(p), ...params }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const reason = `${body.error ?? res.status}: ${(body.error_description ?? "token request refused").split("\n")[0]}`.slice(0, 300);
    if (body.error === "invalid_grant" || res.status === 400 || res.status === 401) throw new ProviderAuthError(reason);
    throw new ProviderError(reason, res.status);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000), scopes: body.scope ?? null };
}

export function exchangeCode(p: Provider, code: string, fetcher?: typeof fetch) {
  return tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p), ...(p === "microsoft" ? { scope: MS_SCOPES.join(" ") } : {}) }, fetcher);
}

export function refreshTokens(p: Provider, refreshToken: string, fetcher?: typeof fetch) {
  return tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken, ...(p === "microsoft" ? { scope: MS_SCOPES.join(" ") } : {}) }, fetcher);
}

/** The signed-in account's address. */
export async function accountProfile(p: Provider, accessToken: string, fetcher: typeof fetch = fetch): Promise<{ email: string; name: string | null }> {
  if (p === "microsoft") {
    const res = await fetcher("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new ProviderError(`Microsoft profile ${res.status}`, res.status);
    const me = (await res.json()) as { mail?: string | null; userPrincipalName?: string; displayName?: string };
    return { email: (me.mail ?? me.userPrincipalName ?? "").toLowerCase(), name: me.displayName ?? null };
  }
  const res = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ProviderError(`Gmail profile ${res.status}`, res.status);
  const me = (await res.json()) as { emailAddress: string };
  return { email: me.emailAddress.toLowerCase(), name: null };
}

import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { loadAccessContext, type AccessContext, type FirmAccess } from "../access/context";
import { isMfaMandatory } from "../auth/service";
import { validateSessionToken, type ValidSession } from "../auth/sessions";
import { env } from "../env";

const secure = () => env().NODE_ENV === "production";
export const SESSION_COOKIE = () => (secure() ? "__Host-gih_session" : "gih_session");

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE(), token, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", expires: new Date(Math.max(expiresAt.getTime(), Date.now() + 7 * 864e5)) });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE());
}

/** Client IP and user agent for auditing and throttling. Trusts the platform's forwarded header. */
export async function requestMeta() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: fwd || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

/** The raw session for this request (memoised per render). */
export const currentSession = cache(async (): Promise<ValidSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

type StaffGuard = { ctx: AccessContext; session: ValidSession };

/**
 * Every staff page and action starts here. Redirects to sign-in, to the MFA
 * challenge, or to MFA set-up when policy requires it. Access is rebuilt from
 * the database on every request; nothing is cached between requests.
 */
export const requireStaff = cache(async (opts: { allowMfaSetup?: boolean } = {}): Promise<StaffGuard> => {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.user.mfaEnabled && !session.mfaVerified) redirect("/login/mfa");
  const { ip } = await requestMeta();
  const ctx = await loadAccessContext(session.userId, { sessionId: session.id, ip });
  if (!ctx) redirect("/login?reason=inactive");
  if (!session.user.mfaEnabled && !opts.allowMfaSetup && (await isMfaMandatory(ctx))) redirect("/account?setup=required");
  return { ctx, session };
});

/** Resolve a firm workspace from its URL slug; 404s look the same as no access. */
export async function requireFirm(slug: string): Promise<StaffGuard & { firm: FirmAccess }> {
  const guard = await requireStaff();
  const firm = guard.ctx.firmBySlug(slug);
  if (!firm || !guard.ctx.has("firm:view", firm.firmId)) notFound();
  return { ...guard, firm };
}

/** Where to land after sign-in. */
export function homeFor(ctx: AccessContext, activeFirmId: string | null): string {
  if (activeFirmId) {
    const f = ctx.firms.get(activeFirmId);
    if (f) return `/f/${f.slug}`;
  }
  if (ctx.has("metrics:group") || ctx.has("intake:view")) return "/hq";
  const first = [...ctx.firms.values()].find((f) => f.permissions.has("firm:view"));
  return first ? `/f/${first.slug}` : "/account";
}

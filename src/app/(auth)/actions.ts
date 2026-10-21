"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { loadAccessContext } from "@/server/access/context";
import { audit } from "@/server/audit";
import { beginMfaEnrolment, confirmMfaEnrolment, disableMfa, verifyMfa } from "@/server/auth/mfa";
import { verifyPassword } from "@/server/auth/password";
import { acceptInvitation, changePassword, requestPasswordReset, resetPassword, signIn } from "@/server/auth/service";
import { deleteSession, markSessionMfaVerified } from "@/server/auth/sessions";
import { assertNotThrottled, recordAttempt } from "@/server/auth/throttle";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { toActionError, type ActionResult } from "@/server/errors";
import { clearSessionCookie, currentSession, homeFor, requestMeta, requireStaff, setSessionCookie } from "@/server/next/session";
import { eq } from "drizzle-orm";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function signInAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const meta = await requestMeta();
  let destination = "/";
  try {
    const result = await signIn({ email: str(form, "email"), password: str(form, "password"), ...meta });
    await setSessionCookie(result.token, result.expiresAt);
    destination = result.mfaPending ? "/login/mfa" : "/";
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}

export async function mfaChallengeAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) redirect("/login");
  const { ip } = await requestMeta();
  try {
    await assertNotThrottled("mfa", session.user.email, ip);
    const { ok, usedRecoveryCode } = await verifyMfa(session.userId, str(form, "code"));
    await recordAttempt("mfa", session.user.email, ip, ok);
    if (!ok) return { ok: false, error: "That code didn't work. Check your authenticator app and try again." };
    await markSessionMfaVerified(session.id);
    await audit({ orgId: session.user.orgId, actorId: session.userId, action: usedRecoveryCode ? "auth.mfa_recovery_code_used" : "auth.mfa_verified", entityType: "user", entityId: session.userId, ip });
  } catch (err) {
    return toActionError(err);
  }
  redirect("/");
}

export async function signOutAction() {
  const session = await currentSession();
  if (session) {
    await deleteSession(session.id);
    await audit({ orgId: session.user.orgId, actorId: session.userId, action: "auth.signed_out", entityType: "user", entityId: session.userId });
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function acceptInvitationAction(token: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const meta = await requestMeta();
  const session = await currentSession();
  try {
    const result = await acceptInvitation({ token, name: str(form, "name"), password: str(form, "password"), signedInUserId: session?.userId ?? null, ...meta });
    if (result.session) await setSessionCookie(result.session.token, result.session.expiresAt);
  } catch (err) {
    return toActionError(err);
  }
  redirect("/");
}

export async function requestResetAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ip } = await requestMeta();
  try {
    await requestPasswordReset(str(form, "email"), ip);
  } catch (err) {
    return toActionError(err);
  }
  return { ok: true, message: "If that address belongs to an account, a reset link is on its way. It expires in one hour." };
}

export async function resetPasswordAction(token: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ip } = await requestMeta();
  if (str(form, "password") !== str(form, "confirm")) return { ok: false, error: "The passwords don't match.", fieldErrors: { confirm: "Doesn't match." } };
  try {
    await resetPassword(token, str(form, "password"), ip);
  } catch (err) {
    return toActionError(err);
  }
  await clearSessionCookie();
  redirect("/login?reason=reset");
}

/* ───────── Account security ───────── */

export async function startMfaAction(): Promise<ActionResult<{ qr: string; secret: string }>> {
  const { ctx } = await requireStaff({ allowMfaSetup: true });
  try {
    const { secret, uri } = await beginMfaEnrolment(ctx.user.id, ctx.user.email);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 200, color: { dark: "#24221f", light: "#ffffff" } });
    return { ok: true, data: { qr, secret } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function confirmMfaAction(_: ActionResult<{ codes: string[] }> | null, form: FormData): Promise<ActionResult<{ codes: string[] }>> {
  const { ctx, session } = await requireStaff({ allowMfaSetup: true });
  const codes = await confirmMfaEnrolment(ctx.user.id, str(form, "code").replace(/\s+/g, ""));
  if (!codes) return { ok: false, error: "That code didn't match. Wait for the next code and try again." };
  await markSessionMfaVerified(session.id);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "auth.mfa_enabled", entityType: "user", entityId: ctx.user.id, ip: ctx.ip });
  return { ok: true, data: { codes }, message: "Two-step sign-in is on." };
}

export async function disableMfaAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  const [u] = await db().select({ hash: users.passwordHash }).from(users).where(eq(users.id, ctx.user.id));
  if (!(await verifyPassword(u?.hash ?? null, str(form, "password")))) return { ok: false, error: "Your password is incorrect." };
  const { isMfaMandatory } = await import("@/server/auth/service");
  if (await isMfaMandatory(ctx)) return { ok: false, error: "Your role requires two-step sign-in, so it can't be turned off." };
  await disableMfa(ctx.user.id);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "auth.mfa_disabled", entityType: "user", entityId: ctx.user.id, ip: ctx.ip });
  return { ok: true, message: "Two-step sign-in is off." };
}

export async function changePasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff({ allowMfaSetup: true });
  if (str(form, "password") !== str(form, "confirm")) return { ok: false, error: "The new passwords don't match.", fieldErrors: { confirm: "Doesn't match." } };
  try {
    await changePassword(ctx, str(form, "current"), str(form, "password"));
    return { ok: true, message: "Password changed. Your other sessions were signed out." };
  } catch (err) {
    return toActionError(err);
  }
}

/** Landing: send each person to the right home. */
export async function landingPath() {
  const session = await currentSession();
  if (!session) return "/login";
  const ctx = await loadAccessContext(session.userId);
  if (!ctx) return "/login";
  return homeFor(ctx, session.activeFirmId);
}

import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { loadAccessContext, type AccessContext } from "../access/context";
import { assertCanGrantRole, firmTeamAuthority } from "../access/grants";
import { MFA_MANDATORY_ROLE_KEYS } from "../access/permissions";
import { audit } from "../audit";
import { db } from "../db/client";
import { firmMemberships, firms, groupMemberships, invitations, passwordResets, roles, users } from "../db/schema";
import { env } from "../env";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { sendEmail, simpleEmail, type EmailResult } from "../integrations/email";
import { randomToken, sha256 } from "./crypto";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { createSession, deleteUserSessions } from "./sessions";
import { beginAttempt, finishAttempt } from "./throttle";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export const normaliseEmail = (e: string) => e.trim().toLowerCase();

/* ───────────────────────── Sign-in ───────────────────────── */

export async function signIn(input: { email: string; password: string; ip: string | null; userAgent: string | null }) {
  const email = normaliseEmail(input.email);
  const attempt = await beginAttempt("password", email, input.ip);

  const [user] = await db()
    .select({ id: users.id, orgId: users.orgId, hash: users.passwordHash, status: users.status, kind: users.kind, mfaEnabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const passwordOk = await verifyPassword(user?.hash ?? null, input.password);
  if (!user || !passwordOk || user.status !== "active" || user.kind !== "staff") {
    if (user) await audit({ orgId: user.orgId, actorId: user.id, action: "auth.sign_in_failed", entityType: "user", entityId: user.id, ip: input.ip });
    throw new ValidationError("Email or password is incorrect.");
  }

  await finishAttempt(attempt, true);
  const mfaEnabled = !!user.mfaEnabledAt;
  const session = await createSession(user.id, { mfaVerified: !mfaEnabled, ip: input.ip, userAgent: input.userAgent });
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ orgId: user.orgId, actorId: user.id, action: "auth.signed_in", entityType: "user", entityId: user.id, ip: input.ip });
  return { ...session, mfaPending: mfaEnabled };
}

/** True when policy requires this user to have MFA (admin roles, or a firm that requires it for everyone). */
export async function isMfaMandatory(ctx: AccessContext): Promise<boolean> {
  if (ctx.group && MFA_MANDATORY_ROLE_KEYS.has(ctx.group.roleKey)) return true;
  for (const f of ctx.firms.values()) if (MFA_MANDATORY_ROLE_KEYS.has(f.roleKey)) return true;
  const ids = [...ctx.firms.keys()];
  if (ids.length === 0) return false;
  const strict = await db().select({ id: firms.id }).from(firms).where(and(inArray(firms.id, ids), eq(firms.requireMfaForAll, true))).limit(1);
  return strict.length > 0;
}

/* ───────────────────────── Invitations ───────────────────────── */

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z.string().trim().min(2, "Enter the person's name.").max(120),
  roleId: z.string().uuid("Choose a role."),
  firmId: z.string().uuid().nullable(),
  title: z.string().trim().max(120).optional(),
});
export type InviteInput = z.input<typeof inviteSchema>;

/**
 * Invite someone to the organisation (group role) or to a firm (firm role).
 * Enforces the subset rule so nobody can grant more than they hold.
 */
export async function createInvitation(
  ctx: AccessContext,
  raw: InviteInput,
): Promise<{ invitationId: string; link: string; email: EmailResult }> {
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the highlighted fields.", fieldErrors(parsed.error));
  const input = parsed.data;

  const [role] = await db().select().from(roles).where(and(eq(roles.id, input.roleId), eq(roles.orgId, ctx.orgId))).limit(1);
  if (!role) throw new ValidationError("Choose a role.", { roleId: "Unknown role." });

  let firmName: string | null = null;
  if (role.scope === "group") {
    if (input.firmId) throw new ValidationError("Group roles are not tied to a firm.");
  } else if (role.scope === "firm") {
    if (!input.firmId) throw new ValidationError("Choose the firm.", { firmId: "Choose the firm." });
    const [firm] = await db().select({ id: firms.id, name: firms.tradingName }).from(firms).where(and(eq(firms.id, input.firmId), eq(firms.orgId, ctx.orgId))).limit(1);
    if (!firm) throw new NotFoundError("Firm");
    firmName = firm.name;
  } else {
    throw new ValidationError("Client portal invitations arrive with the client portal (Release 4).");
  }
  await assertCanGrantRole(ctx, role, input.firmId);

  const [existing] = await db().select({ id: users.id, status: users.status, kind: users.kind }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) {
    if (existing.kind !== "staff" || existing.status === "deactivated") throw new ConflictError("That email belongs to an account that cannot be invited. Contact a group administrator.");
    if (existing.id === ctx.user.id) throw new AccessDeniedError("self-invite");
    if (role.scope === "firm") {
      const [m] = await db().select({ id: firmMemberships.id }).from(firmMemberships).where(and(eq(firmMemberships.userId, existing.id), eq(firmMemberships.firmId, input.firmId!))).limit(1);
      if (m) throw new ConflictError("This person is already a member of the firm.");
    } else {
      const [g] = await db().select({ id: groupMemberships.id }).from(groupMemberships).where(eq(groupMemberships.userId, existing.id)).limit(1);
      if (g) throw new ConflictError("This person already has a group role. Change it from their profile.");
    }
  }

  const token = randomToken();
  const now = new Date();
  const invitationId = await db().transaction(async (tx) => {
    // Supersede any earlier pending invitation for the same person and destination.
    await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invitations.email, input.email),
          input.firmId ? eq(invitations.firmId, input.firmId) : isNull(invitations.firmId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const [inv] = await tx
      .insert(invitations)
      .values({
        orgId: ctx.orgId,
        email: input.email,
        name: input.name,
        tokenHash: sha256(token),
        firmId: input.firmId,
        roleId: role.id,
        invitedById: ctx.user.id,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      })
      .returning({ id: invitations.id });
    await audit(
      {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        firmId: input.firmId,
        action: "staff.invited",
        entityType: "invitation",
        entityId: inv.id,
        summary: `Invited ${input.email} as ${role.name}${firmName ? ` at ${firmName}` : ""}`,
        data: { roleKey: role.key },
        ip: ctx.ip,
      },
      tx,
    );
    return inv.id;
  });

  const link = `${env().APP_URL}/invite/${token}`;
  const mail = simpleEmail({
    heading: "You're invited to GIH Operations Cloud",
    body: [
      `${ctx.user.name} has invited you to join ${firmName ?? "Global Immigration Hub"} as ${role.name}.`,
      "Use the button below to set your password. The link works once and expires in 7 days.",
    ],
    actionLabel: "Accept invitation",
    actionUrl: link,
    footer: "If you weren't expecting this, you can ignore this email.",
  });
  const email = await sendEmail({ orgId: ctx.orgId, firmId: input.firmId, to: input.email, subject: "Your invitation to GIH Operations Cloud", template: "staff_invitation", ...mail });
  return { invitationId, link, email };
}

export async function revokeInvitation(ctx: AccessContext, invitationId: string) {
  const [inv] = await db().select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.orgId, ctx.orgId))).limit(1);
  if (!inv || inv.acceptedAt || inv.revokedAt) throw new NotFoundError("Invitation");
  const allowed = inv.firmId ? !!(await firmTeamAuthority(ctx, inv.firmId, "team:invite")) : ctx.has("staff:invite");
  if (!allowed) throw new AccessDeniedError("team:invite");
  await db().update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, inv.id));
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: inv.firmId, action: "staff.invitation_revoked", entityType: "invitation", entityId: inv.id, summary: `Revoked invitation for ${inv.email}`, ip: ctx.ip });
}

/** Public lookup for the acceptance page. Returns nothing sensitive. */
export async function getInvitationForToken(token: string) {
  if (!token || token.length > 100) return null;
  const [row] = await db()
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      firmName: firms.tradingName,
      roleName: roles.name,
    })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .leftJoin(firms, eq(firms.id, invitations.firmId))
    .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.email, row.email)).limit(1);
  return { ...row, existingAccount: !!existing };
}

/**
 * Accept an invitation. New people set a password; people who already have an
 * account must be signed in as that account.
 */
export async function acceptInvitation(input: {
  token: string;
  name?: string;
  password?: string;
  signedInUserId?: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ userId: string; session: Awaited<ReturnType<typeof createSession>> | null }> {
  const invalid = new ValidationError("This invitation link is invalid or has expired. Ask for a new one.");
  if (!input.token || input.token.length > 100) throw invalid;

  return db().transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, sha256(input.token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .for("update")
      .limit(1);
    if (!inv) throw invalid;
    const [role] = await tx.select().from(roles).where(eq(roles.id, inv.roleId)).limit(1);
    if (!role) throw invalid;
    // The person who invited must still be allowed to grant this role today.
    const inviter = await loadAccessContext(inv.invitedById);
    if (!inviter) throw invalid;
    try {
      await assertCanGrantRole(inviter, role, inv.firmId);
    } catch {
      throw invalid;
    }

    const [existing] = await tx.select().from(users).where(eq(users.email, inv.email)).limit(1);
    let userId: string;
    let isNew = false;
    if (existing) {
      if (existing.status !== "active" || existing.kind !== "staff") throw new ValidationError("This account can't accept invitations. Contact a group administrator.");
      if (input.signedInUserId !== existing.id) throw new ValidationError(`Sign in as ${inv.email} to accept this invitation.`);
      userId = existing.id;
    } else {
      const name = (input.name ?? inv.name).trim();
      if (name.length < 2) throw new ValidationError("Enter your name.", { name: "Enter your name." });
      const problem = passwordProblem(input.password ?? "", inv.email);
      if (problem) throw new ValidationError(problem, { password: problem });
      const [created] = await tx
        .insert(users)
        .values({ orgId: inv.orgId, email: inv.email, name, passwordHash: await hashPassword(input.password!), status: "active", kind: "staff", passwordChangedAt: new Date() })
        .returning({ id: users.id });
      userId = created.id;
      isNew = true;
    }

    if (role.scope === "group") {
      await tx
        .insert(groupMemberships)
        .values({ userId, roleId: role.id, createdById: inv.invitedById })
        .onConflictDoUpdate({ target: groupMemberships.userId, set: { roleId: role.id } });
    } else if (role.scope === "firm" && inv.firmId) {
      await tx.insert(firmMemberships).values({ firmId: inv.firmId, userId, roleId: role.id, createdById: inv.invitedById }).onConflictDoNothing();
    }

    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await audit({ orgId: inv.orgId, actorId: userId, firmId: inv.firmId, action: "staff.invitation_accepted", entityType: "invitation", entityId: inv.id, summary: `${inv.email} joined as ${role.name}`, ip: input.ip }, tx);
    return { userId, isNew };
  }).then(async ({ userId, isNew }) => ({
    userId,
    session: isNew ? await createSession(userId, { mfaVerified: true, ip: input.ip, userAgent: input.userAgent }) : null,
  }));
}

/* ───────────────────────── Passwords ───────────────────────── */

/** Always resolves the same way whether or not the email exists. */
export async function requestPasswordReset(rawEmail: string, ip: string | null) {
  const email = normaliseEmail(rawEmail);
  // Counts per address and per IP, so nobody can flood an inbox with reset emails.
  await beginAttempt("reset", email, ip);
  const [user] = await db().select({ id: users.id, orgId: users.orgId, status: users.status, kind: users.kind }).from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== "active" || user.kind !== "staff") return;

  const token = randomToken();
  await db().insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  const link = `${env().APP_URL}/reset-password/${token}`;
  const mail = simpleEmail({
    heading: "Reset your password",
    body: ["Someone asked to reset the password for your GIH Operations Cloud account.", "The link below works once and expires in one hour."],
    actionLabel: "Choose a new password",
    actionUrl: link,
    footer: "If you didn't ask for this, ignore this email; your password stays the same.",
  });
  const result = await sendEmail({ orgId: user.orgId, to: email, subject: "Reset your GIH Operations Cloud password", template: "password_reset", ...mail });
  if (result.status === "not_configured" && env().NODE_ENV === "development") {
    console.info(`[dev] Email is not configured. Password reset link for ${email}: ${link}`);
  }
  await audit({ orgId: user.orgId, actorId: null, action: "auth.password_reset_requested", entityType: "user", entityId: user.id, ip });
}

export async function resetPassword(token: string, password: string, ip: string | null) {
  const invalid = new ValidationError("This reset link is invalid or has expired. Request a new one.");
  if (!token || token.length > 100) throw invalid;
  const [row] = await db()
    .select({ id: passwordResets.id, userId: passwordResets.userId, email: users.email, orgId: users.orgId, status: users.status })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .limit(1);
  if (!row || row.status !== "active") throw invalid;
  const problem = passwordProblem(password, row.email);
  if (problem) throw new ValidationError(problem, { password: problem });

  const claimed = await db().update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.id, row.id), isNull(passwordResets.usedAt))).returning({ id: passwordResets.id });
  if (claimed.length === 0) throw invalid;
  await db().update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, row.userId));
  await deleteUserSessions(row.userId);
  await audit({ orgId: row.orgId, actorId: row.userId, action: "auth.password_reset", entityType: "user", entityId: row.userId, summary: "Password reset; all sessions signed out", ip });
}

export async function changePassword(ctx: AccessContext, current: string, next: string) {
  const attempt = await beginAttempt("password", ctx.user.email, ctx.ip);
  const [u] = await db().select({ hash: users.passwordHash }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
  if (!(await verifyPassword(u?.hash ?? null, current))) throw new ValidationError("Your current password is incorrect.", { current: "Incorrect password." });
  await finishAttempt(attempt, true);
  const problem = passwordProblem(next, ctx.user.email);
  if (problem) throw new ValidationError(problem, { password: problem });
  await db().update(users).set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, ctx.user.id));
  await deleteUserSessions(ctx.user.id, ctx.sessionId ?? undefined);
  await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "auth.password_changed", entityType: "user", entityId: ctx.user.id, summary: "Password changed; other sessions signed out", ip: ctx.ip });
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

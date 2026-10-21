import { eq, sql } from "drizzle-orm";
import { generate } from "otplib";
import { beforeEach, describe, expect, it } from "vitest";
import { loadAccessContext } from "../../src/server/access/context";
import { decrypt } from "../../src/server/auth/crypto";
import { beginMfaEnrolment, confirmMfaEnrolment, verifyMfa } from "../../src/server/auth/mfa";
import { acceptInvitation, createInvitation, getInvitationForToken, requestPasswordReset, resetPassword, signIn } from "../../src/server/auth/service";
import { createSession, validateSessionToken } from "../../src/server/auth/sessions";
import { db } from "../../src/server/db/client";
import { passwordResets, users } from "../../src/server/db/schema";
import { RateLimitedError, ValidationError } from "../../src/server/errors";
import { firmId, makeUser, owner, resetDatabase, roleId } from "../support/fixtures";

const PASSWORD = "correct horse battery staple";

async function invitedUser() {
  const veritas = await firmId("veritas");
  const admin = await makeUser({ firms: { veritas: "firm_admin" } });
  const email = `new${Date.now()}@test.example`;
  const { link } = await createInvitation(admin, { email, name: "New Person", roleId: await roleId("immigration_consultant"), firmId: veritas });
  const token = link.split("/invite/")[1];
  return { token, email, veritas };
}

describe("authentication", () => {
  beforeEach(resetDatabase);

  it("accepts an invitation once and signs in with the new password", async () => {
    const { token, email, veritas } = await invitedUser();
    expect((await getInvitationForToken(token))?.email).toBe(email);
    await expect(acceptInvitation({ token, password: "short", ip: null, userAgent: null })).rejects.toBeInstanceOf(ValidationError);
    const { userId, session } = await acceptInvitation({ token, password: PASSWORD, ip: null, userAgent: null });
    expect(session).not.toBeNull();
    const ctx = await loadAccessContext(userId);
    expect(ctx?.has("leads:create", veritas)).toBe(true);
    await expect(acceptInvitation({ token, password: PASSWORD, ip: null, userAgent: null })).rejects.toBeInstanceOf(ValidationError);
    const signedIn = await signIn({ email: email.toUpperCase(), password: PASSWORD, ip: "203.0.113.1", userAgent: "test" });
    expect(await validateSessionToken(signedIn.token)).not.toBeNull();
  });

  it("rejects wrong passwords and throttles repeated failures", async () => {
    const { token, email } = await invitedUser();
    await acceptInvitation({ token, password: PASSWORD, ip: null, userAgent: null });
    for (let i = 0; i < 5; i++) await expect(signIn({ email, password: "wrong password!!", ip: "203.0.113.9", userAgent: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(signIn({ email, password: PASSWORD, ip: "203.0.113.9", userAgent: null })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("does not reveal whether an account exists", async () => {
    await expect(signIn({ email: "nobody@test.example", password: PASSWORD, ip: null, userAgent: null })).rejects.toThrow("Email or password is incorrect.");
    await expect(requestPasswordReset("nobody@test.example", null)).resolves.toBeUndefined();
  });

  it("resets a password with a single-use link and ends every session", async () => {
    const { token, email } = await invitedUser();
    const { userId, session } = await acceptInvitation({ token, password: PASSWORD, ip: null, userAgent: null });
    await requestPasswordReset(email, null);
    // The link is emailed; tests take a fresh token by inserting one the same way the service does.
    const { randomToken, sha256 } = await import("../../src/server/auth/crypto");
    const raw = randomToken();
    await owner.insert(passwordResets).values({ userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60_000) });
    await resetPassword(raw, "a brand new long passphrase", null);
    expect(await validateSessionToken(session!.token)).toBeNull();
    await expect(resetPassword(raw, "another long passphrase!", null)).rejects.toBeInstanceOf(ValidationError);
    await expect(signIn({ email, password: PASSWORD, ip: null, userAgent: null })).rejects.toBeInstanceOf(ValidationError);
    expect((await signIn({ email, password: "a brand new long passphrase", ip: null, userAgent: null })).mfaPending).toBe(false);
  });

  it("enrols TOTP, refuses replayed codes, and accepts each recovery code once", async () => {
    const u = await makeUser({ firms: { veritas: "firm_admin" } });
    const { secret } = await beginMfaEnrolment(u.user.id, u.user.email);
    const [row] = await owner.select().from(users).where(eq(users.id, u.user.id));
    expect(row.mfaSecretEnc).not.toContain(secret); // stored encrypted
    expect(decrypt(row.mfaSecretEnc!)).toBe(secret);

    const code = await generate({ secret });
    const recovery = await confirmMfaEnrolment(u.user.id, code);
    expect(recovery).toHaveLength(10);
    expect((await verifyMfa(u.user.id, code)).ok).toBe(false); // same code again = replay
    expect((await verifyMfa(u.user.id, recovery![0])).ok).toBe(true);
    expect((await verifyMfa(u.user.id, recovery![0])).ok).toBe(false);
    await expect(beginMfaEnrolment(u.user.id, u.user.email)).rejects.toThrow(/already enabled/);
  });

  it("expires sessions after the absolute lifetime", async () => {
    const u = await makeUser({ firms: { veritas: "reviewer" } });
    const { token, id } = await createSession(u.user.id, { mfaVerified: true });
    await owner.execute(sql`update sessions set created_at = now() - interval '8 days' where id = ${id}`);
    expect(await validateSessionToken(token)).toBeNull();
    void db;
  });
});

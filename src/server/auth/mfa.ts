import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { generateSecret, generateURI, verify } from "otplib";
import { db } from "../db/client";
import { mfaRecoveryCodes, users } from "../db/schema";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, sha256 } from "./crypto";

const ISSUER = "GIH Operations Cloud";

/** Start enrolment: store a new pending secret and return what the authenticator app needs. */
export async function beginMfaEnrolment(userId: string, email: string) {
  const [u] = await db().select({ enabled: users.mfaEnabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.enabled) throw new Error("MFA is already enabled; disable it first.");
  const secret = generateSecret();
  await db().update(users).set({ mfaSecretEnc: encrypt(secret), mfaEnabledAt: null, mfaLastTimeStep: null }).where(eq(users.id, userId));
  return { secret, uri: generateURI({ issuer: ISSUER, label: email, secret }) };
}

async function checkCode(userId: string, code: string): Promise<boolean> {
  const [u] = await db()
    .select({ secret: users.mfaSecretEnc, lastStep: users.mfaLastTimeStep })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.secret || !/^\d{6}$/.test(code)) return false;
  const result = await verify({ secret: decrypt(u.secret), token: code, epochTolerance: 30 });
  if (!result.valid) return false;
  const step = "timeStep" in result && typeof result.timeStep === "number" ? result.timeStep : null;
  if (step === null) return false;
  // Accept each time step once. The conditional update is atomic, so two
  // simultaneous submissions of the same code can't both succeed.
  const claimed = await db()
    .update(users)
    .set({ mfaLastTimeStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.mfaLastTimeStep), lt(users.mfaLastTimeStep, step))))
    .returning({ id: users.id });
  return claimed.length > 0;
}

/** Confirm enrolment with a first code. Returns one-time recovery codes to show once. */
export async function confirmMfaEnrolment(userId: string, code: string): Promise<string[] | null> {
  if (!(await checkCode(userId, code))) return null;
  // 10 codes of 10 hex characters (40 bits each), shown once and stored hashed.
  const codes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex"));
  await db().transaction(async (tx) => {
    await tx.update(users).set({ mfaEnabledAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await tx.insert(mfaRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(c) })));
  });
  return codes;
}

/** Verify a sign-in code: a 6-digit TOTP or an unused recovery code. */
export async function verifyMfa(userId: string, input: string): Promise<{ ok: boolean; usedRecoveryCode: boolean }> {
  const code = input.replace(/\s+/g, "").toLowerCase();
  if (/^\d{6}$/.test(code)) return { ok: await checkCode(userId, code), usedRecoveryCode: false };
  if (code.length < 8 || code.length > 20) return { ok: false, usedRecoveryCode: false };
  const updated = await db()
    .update(mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(mfaRecoveryCodes.userId, userId), eq(mfaRecoveryCodes.codeHash, sha256(code)), isNull(mfaRecoveryCodes.usedAt)))
    .returning({ id: mfaRecoveryCodes.id });
  return { ok: updated.length > 0, usedRecoveryCode: updated.length > 0 };
}

export async function disableMfa(userId: string) {
  await db().transaction(async (tx) => {
    await tx.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastTimeStep: null }).where(eq(users.id, userId));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  });
}

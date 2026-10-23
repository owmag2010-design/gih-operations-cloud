import "server-only";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { randomToken, sha256 } from "./crypto";

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000; // 12 hours without activity
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days at most
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type UiTheme = "dark" | "light" | "system";

export type ValidSession = {
  id: string;
  userId: string;
  mfaVerified: boolean;
  activeFirmId: string | null;
  user: { id: string; orgId: string; email: string; name: string; mfaEnabled: boolean; uiTheme: UiTheme };
};

export async function createSession(
  userId: string,
  opts: { mfaVerified: boolean; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date; id: string }> {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_IDLE_MS);
  const [row] = await db()
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      mfaVerified: opts.mfaVerified,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });
  return { token, expiresAt, id: row.id };
}

/** Look up a session by its raw token. Expired sessions and inactive users return null. */
export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const now = new Date();
  const [row] = await db()
    .select({
      id: sessions.id,
      userId: sessions.userId,
      mfaVerified: sessions.mfaVerified,
      activeFirmId: sessions.activeFirmId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      orgId: users.orgId,
      email: users.email,
      name: users.name,
      status: users.status,
      mfaEnabledAt: users.mfaEnabledAt,
      uiTheme: users.uiTheme,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (row.status !== "active") {
    await db().delete(sessions).where(eq(sessions.id, row.id));
    return null;
  }
  const absoluteEnd = row.createdAt.getTime() + SESSION_ABSOLUTE_MS;
  if (now.getTime() >= absoluteEnd) {
    await db().delete(sessions).where(eq(sessions.id, row.id));
    return null;
  }
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    const next = Math.min(now.getTime() + SESSION_IDLE_MS, absoluteEnd);
    await db().update(sessions).set({ lastSeenAt: now, expiresAt: new Date(next) }).where(eq(sessions.id, row.id));
  }
  return {
    id: row.id,
    userId: row.userId,
    mfaVerified: row.mfaVerified,
    activeFirmId: row.activeFirmId,
    user: { id: row.userId, orgId: row.orgId, email: row.email, name: row.name, mfaEnabled: !!row.mfaEnabledAt, uiTheme: (row.uiTheme === "dark" || row.uiTheme === "system" ? row.uiTheme : "light") as UiTheme },
  };
}

export async function markSessionMfaVerified(sessionId: string) {
  await db().update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
}

export async function setActiveFirm(sessionId: string, firmId: string | null) {
  await db().update(sessions).set({ activeFirmId: firmId }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(sessionId: string) {
  await db().delete(sessions).where(eq(sessions.id, sessionId));
}

/** Sign the user out everywhere, optionally keeping the current session. */
export async function deleteUserSessions(userId: string, exceptSessionId?: string) {
  await db()
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

/** The person's own interface theme. */
export async function setUiTheme(userId: string, theme: UiTheme) {
  await db().update(users).set({ uiTheme: theme, updatedAt: new Date() }).where(eq(users.id, userId));
}

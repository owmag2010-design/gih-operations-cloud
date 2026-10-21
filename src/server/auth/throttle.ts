import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { authAttempts } from "../db/schema";
import { RateLimitedError } from "../errors";

const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = {
  password: { perAccount: 5, perIp: 30 },
  mfa: { perAccount: 5, perIp: 30 },
  reset: { perAccount: 3, perIp: 10 },
} as const;

type Kind = keyof typeof LIMITS;

/**
 * Reserve an attempt before doing the expensive check. The attempt is written
 * as a failure under a per-account lock, so parallel requests each count
 * against the limit instead of all reading the same old total.
 * Call finishAttempt(id, true) when the check succeeds.
 */
export async function beginAttempt(kind: Kind, email: string | null, ip: string | null): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS);
  const limit = LIMITS[kind];
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`auth:${kind}:${email ?? ip ?? "-"}`}))`);
    if (email) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(authAttempts)
        .where(and(eq(authAttempts.kind, kind), eq(authAttempts.email, email), eq(authAttempts.succeeded, false), gte(authAttempts.createdAt, since)));
      if (n >= limit.perAccount) throw new RateLimitedError();
    }
    if (ip) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(authAttempts)
        .where(and(eq(authAttempts.kind, kind), eq(authAttempts.ip, ip), eq(authAttempts.succeeded, false), gte(authAttempts.createdAt, since)));
      if (n >= limit.perIp) throw new RateLimitedError();
    }
    const [row] = await tx.insert(authAttempts).values({ kind, email, ip, succeeded: false }).returning({ id: authAttempts.id });
    return row.id;
  });
}

export async function finishAttempt(id: number, succeeded: boolean) {
  if (succeeded) await db().update(authAttempts).set({ succeeded: true }).where(eq(authAttempts.id, id));
}

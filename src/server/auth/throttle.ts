import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { authAttempts } from "../db/schema";
import { RateLimitedError } from "../errors";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 5;
const MAX_FAILURES_PER_IP = 30;

type Kind = "password" | "mfa" | "reset";

/** Throw RateLimitedError when recent failures for this account or IP exceed the limits. */
export async function assertNotThrottled(kind: Kind, email: string | null, ip: string | null) {
  const since = new Date(Date.now() - WINDOW_MS);
  if (email) {
    const [{ n }] = await db()
      .select({ n: count() })
      .from(authAttempts)
      .where(and(eq(authAttempts.kind, kind), eq(authAttempts.email, email), eq(authAttempts.succeeded, false), gte(authAttempts.createdAt, since)));
    if (n >= MAX_FAILURES_PER_ACCOUNT) throw new RateLimitedError();
  }
  if (ip) {
    const [{ n }] = await db()
      .select({ n: count() })
      .from(authAttempts)
      .where(and(eq(authAttempts.ip, ip), eq(authAttempts.succeeded, false), gte(authAttempts.createdAt, since)));
    if (n >= MAX_FAILURES_PER_IP) throw new RateLimitedError();
  }
}

export async function recordAttempt(kind: Kind, email: string | null, ip: string | null, succeeded: boolean) {
  await db().insert(authAttempts).values({ kind, email, ip, succeeded });
}

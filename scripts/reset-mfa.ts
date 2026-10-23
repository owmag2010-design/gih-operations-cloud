/**
 * Turn off two-step sign-in for one person who has lost their authenticator,
 * and sign them out everywhere. They set it up again at their next sign-in.
 *
 *   npx tsx scripts/reset-mfa.ts --email owen@example.com
 *
 * Run from the Database workflow (task: reset-mfa) so the owner connection
 * stays in GitHub secrets. Written to the audit log.
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { migrationUrl } from "./connection-url";
import * as s from "../src/server/db/schema";

config({ path: process.env.DOTENV_PATH ?? ".env.local" });

async function main() {
  const i = process.argv.indexOf("--email");
  const email = (i > -1 ? process.argv[i + 1] : "")?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Usage: npx tsx scripts/reset-mfa.ts --email you@example.com");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: migrationUrl(), max: 1 });
  const db = drizzle(pool, { schema: s });
  const done = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(s.users).where(eq(s.users.email, email)).limit(1);
    if (!user) return false;
    await tx.update(s.users).set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastTimeStep: null }).where(eq(s.users.id, user.id));
    await tx.delete(s.mfaRecoveryCodes).where(eq(s.mfaRecoveryCodes.userId, user.id));
    await tx.delete(s.sessions).where(eq(s.sessions.userId, user.id));
    await tx.insert(s.auditEvents).values({ orgId: user.orgId, actorId: null, action: "auth.mfa_reset", entityType: "user", entityId: user.id, summary: `Two-step sign-in reset for ${email} from the Database workflow` });
    return true;
  });
  await pool.end();
  console.log(done ? `Two-step sign-in reset for ${email}. Sign in with the password, then set up the authenticator again.` : `No account with that email.`);
  if (!done) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

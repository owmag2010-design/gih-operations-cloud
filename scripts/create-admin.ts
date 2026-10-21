/**
 * Bootstrap the first Group Super Administrator.
 *
 *   npm run admin:create -- --email owen@thegih.com --name "Owen Magocha" [--firm-admin-all]
 *
 * Creates (or reuses) the account, grants the group role and, with
 * --firm-admin-all, makes the person Firm Administrator of every firm (the
 * founder runs all three). Prints a one-time link, valid for 24 hours, to set
 * the password. Every grant is written to the audit log.
 */
import { config } from "dotenv";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "../src/server/db/schema";

config({ path: process.env.DOTENV_PATH ?? ".env.local" });

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const allFirms = process.argv.includes("--firm-admin-all");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
    console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name" [--firm-admin-all]');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema: s });

  const link = await db.transaction(async (tx) => {
    const [org] = await tx.select().from(s.organisations).where(eq(s.organisations.slug, "gih")).limit(1);
    if (!org) throw new Error("Run `npm run db:seed` first.");
    const [superRole] = await tx.select().from(s.roles).where(and(eq(s.roles.orgId, org.id), eq(s.roles.key, "group_super_admin"))).limit(1);
    const [firmAdmin] = await tx.select().from(s.roles).where(and(eq(s.roles.orgId, org.id), eq(s.roles.key, "firm_admin"))).limit(1);

    let [user] = await tx.select().from(s.users).where(eq(s.users.email, email)).limit(1);
    if (!user) [user] = await tx.insert(s.users).values({ orgId: org.id, email, name, status: "active", kind: "staff" }).returning();

    await tx.insert(s.groupMemberships).values({ userId: user.id, roleId: superRole.id }).onConflictDoUpdate({ target: s.groupMemberships.userId, set: { roleId: superRole.id } });
    await tx.insert(s.auditEvents).values({ orgId: org.id, actorId: null, action: "staff.bootstrap_group_admin", entityType: "user", entityId: user.id, summary: `${email} made Group Super Administrator from the command line` });

    if (allFirms) {
      const firms = await tx.select().from(s.firms).where(eq(s.firms.orgId, org.id));
      for (const f of firms) {
        await tx.insert(s.firmMemberships).values({ firmId: f.id, userId: user.id, roleId: firmAdmin.id }).onConflictDoNothing();
        await tx.insert(s.auditEvents).values({ orgId: org.id, firmId: f.id, actorId: null, action: "staff.bootstrap_firm_admin", entityType: "user", entityId: user.id, summary: `${email} made Firm Administrator of ${f.tradingName} from the command line` });
      }
    }

    const token = randomBytes(32).toString("base64url");
    await tx.insert(s.passwordResets).values({ userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 24 * 3600 * 1000) });
    return `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password/${token}`;
  });

  await pool.end();
  console.log(`\nAdministrator ready. Set the password within 24 hours:\n\n  ${link}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Reset the e2e database, seed configuration and create two firm consultants and a finance officer with known passwords. */
import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { runSeed } from "../../scripts/seed-lib";
import * as s from "../../src/server/db/schema";

export const PASSWORD = "e2e passphrase for testing";

export default async function setup() {
  const pool = new Pool({ connectionString: process.env.E2E__MIGRATION_DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema: s });
  await migrate(db, { migrationsFolder: "drizzle" });
  const tables = (await pool.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => `"${r.tablename}"`).join(", ");
  await pool.query(`truncate ${tables} restart identity cascade`);
  await runSeed(db, () => {});

  const [org] = await db.select().from(s.organisations).limit(1);
  const [consultant] = await db.select().from(s.roles).where(eq(s.roles.key, "immigration_consultant"));
  const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  for (const [slug, email, name] of [["veritas", "veritas.e2e@example.test", "Vera Consultant"], ["mimshac", "mimshac.e2e@example.test", "Mike Consultant"]]) {
    const [firm] = await db.select().from(s.firms).where(eq(s.firms.slug, slug));
    const [u] = await db.insert(s.users).values({ orgId: org.id, email, name, passwordHash, status: "active", kind: "staff" }).returning();
    await db.insert(s.firmMemberships).values({ firmId: firm.id, userId: u.id, roleId: consultant.id });
  }
  const [financeRole] = await db.select().from(s.roles).where(eq(s.roles.key, "finance_officer"));
  const [veritas] = await db.select().from(s.firms).where(eq(s.firms.slug, "veritas"));
  const [fo] = await db.insert(s.users).values({ orgId: org.id, email: "finance.e2e@example.test", name: "Fin Officer", passwordHash, status: "active", kind: "staff" }).returning();
  await db.insert(s.firmMemberships).values({ firmId: veritas.id, userId: fo.id, roleId: financeRole.id });
  const [reviewerRole] = await db.select().from(s.roles).where(eq(s.roles.key, "reviewer"));
  const [rv] = await db.insert(s.users).values({ orgId: org.id, email: "reviewer.e2e@example.test", name: "Rita Reviewer", passwordHash, status: "active", kind: "staff" }).returning();
  await db.insert(s.firmMemberships).values({ firmId: veritas.id, userId: rv.id, roleId: reviewerRole.id });
  await pool.end();
  writeFileSync("tests/e2e/.state.json", JSON.stringify({ password: PASSWORD }));
}

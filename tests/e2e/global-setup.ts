/** Reset the e2e database, seed configuration and create two firm consultants and a finance officer with known passwords. */
import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { runSeed } from "../../scripts/seed-lib";
import * as s from "../../src/server/db/schema";

export const PASSWORD = "e2e passphrase for testing";

export default async function setup() {
  const pool = new Pool({ connectionString: process.env.E2E__MIGRATION_DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema: s });
  // The enquiry engine's tables (present in production before these migrations).
  await pool.query(readFileSync("tests/support/engine-stub.sql", "utf8"));
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
  // Two engine conversations, labelled as tests: one from the Veritas website, one with a Mimshac proposal.
  await pool.query("truncate engine.messages, engine.proposals, engine.chats, engine.leads");
  const v = (await pool.query(`insert into engine.leads (name, email, phone, first_channel, status, facts, is_test, last_message_at) values ('E2E Thandi Test', 'thandi.e2e@example.test', '27820000001', 'whatsapp', 'waiting_details', '{"site_source":"veritas-site"}', true, now()) returning id`)).rows[0].id;
  const m = (await pool.query(`insert into engine.leads (name, email, first_channel, status, proposal_slug, is_test, last_message_at) values ('E2E Joyce Test', 'joyce.e2e@example.test', 'email', 'proposal_sent', 'e2e-overstay', true, now()) returning id`)).rows[0].id;
  await pool.query(`insert into engine.proposals (slug, lead_id, status, record) values ('e2e-overstay', $1, 'sent', '{"ref":"GIH-E2E-1","matter":"Overstay appeal","firm":{"name":"Mimshac Group"},"fees":[{"amount":10000}]}')`, [m]);
  await pool.query(`insert into engine.messages (lead_id, channel, direction, body, created_at) values ($1, 'whatsapp', 'in', 'I need a spouse visa', now() - interval '5 minutes'), ($1, 'whatsapp', 'out', 'May I have your full name?', now() - interval '4 minutes'), ($2, 'email', 'in', 'Overstay ban question', now())`, [v, m]);
  await pool.end();
  writeFileSync("tests/e2e/.state.json", JSON.stringify({ password: PASSWORD }));
}

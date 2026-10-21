/**
 * Test fixtures. The owner connection resets and seeds the test database and
 * creates users; the code under test always runs as the restricted app role.
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runSeed } from "../../scripts/seed-lib";
import { loadAccessContext, type AccessContext } from "../../src/server/access/context";
import * as s from "../../src/server/db/schema";

const ownerPool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 2 });
export const owner = drizzle(ownerPool, { schema: s });

export async function resetDatabase() {
  const res = await ownerPool.query(`select tablename from pg_tables where schemaname = 'public'`);
  const tables = res.rows.map((r) => `"${r.tablename}"`).join(", ");
  await ownerPool.query(`truncate ${tables} restart identity cascade`);
  await runSeed(owner, () => {});
}

export async function firmId(slug: string) {
  const [f] = await owner.select({ id: s.firms.id }).from(s.firms).where(eq(s.firms.slug, slug));
  return f.id;
}

export async function roleId(key: string) {
  const [r] = await owner.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, key));
  return r.id;
}

let counter = 0;

/** Create an active staff user with the given memberships and return their access context. */
export async function makeUser(opts: { name?: string; group?: string; firms?: Record<string, string> } = {}): Promise<AccessContext> {
  counter++;
  const [org] = await owner.select().from(s.organisations).limit(1);
  const [user] = await owner
    .insert(s.users)
    .values({ orgId: org.id, email: `user${counter}-${Date.now()}@test.example`, name: opts.name ?? `Test User ${counter}`, status: "active", kind: "staff" })
    .returning();
  if (opts.group) await owner.insert(s.groupMemberships).values({ userId: user.id, roleId: await roleId(opts.group) });
  for (const [slug, role] of Object.entries(opts.firms ?? {})) {
    await owner.insert(s.firmMemberships).values({ userId: user.id, firmId: await firmId(slug), roleId: await roleId(role) });
  }
  const ctx = await loadAccessContext(user.id);
  if (!ctx) throw new Error("fixture user did not load");
  return ctx;
}

export async function reload(ctx: AccessContext) {
  return loadAccessContext(ctx.user.id);
}

export async function setFirmPolicy(slug: string, values: Partial<typeof s.firms.$inferInsert>) {
  await owner.update(s.firms).set(values).where(eq(s.firms.slug, slug));
}

export async function auditCount(action: string) {
  const [{ n }] = await owner.select({ n: sql<number>`count(*)::int` }).from(s.auditEvents).where(and(eq(s.auditEvents.action, action)));
  return n;
}

export const lead = (over: Record<string, unknown> = {}) => ({
  firstName: "Thandi",
  lastName: "Test",
  email: `thandi.${Math.random().toString(36).slice(2, 8)}@test.example`,
  phone: "",
  currentCountry: "ZA",
  enquiry: "Spouse visa for my husband",
  ...over,
});

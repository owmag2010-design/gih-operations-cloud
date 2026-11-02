/** Migrate the test database once per run. Each test file resets data itself. */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

export default async function setup() {
  const url = process.env.TEST_MIGRATION_DATABASE_URL ?? "postgres://gih:gih_local_dev@localhost:5432/gih_test";
  const pool = new Pool({ connectionString: url, max: 1 });
  // The enquiry engine's tables exist in production before this app's migrations;
  // tests recreate them so the conversation views can be built and checked.
  await pool.query(readFileSync(new URL("./engine-stub.sql", import.meta.url), "utf8"));
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
}

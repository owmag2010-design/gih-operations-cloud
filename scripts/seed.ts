/** Configuration seed (idempotent). Usage: npm run db:seed */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { migrationUrl } from "./connection-url";
import * as s from "../src/server/db/schema";
import { runSeed } from "./seed-lib";

config({ path: process.env.DOTENV_PATH ?? ".env.local" });

async function main() {
  const url = migrationUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
  await runSeed(drizzle(pool, { schema: s }));
  await pool.end();
  console.log("Seed complete (configuration only).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

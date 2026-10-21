/** Apply database migrations as the schema owner. Usage: npm run db:migrate */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { migrationUrl } from "./connection-url";

config({ path: process.env.DOTENV_PATH ?? ".env.local" });

async function main() {
  const url = migrationUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

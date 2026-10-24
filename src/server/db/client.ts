import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __gihPool?: Pool };

function pool(): Pool {
  if (!globalForDb.__gihPool) {
    globalForDb.__gihPool = new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  }
  return globalForDb.__gihPool;
}

let _db: Database | null = null;

/**
 * Unscoped database handle. Firm-owned tables return no rows through it
 * (row-level security denies by default). Use it only for identity tables
 * (users, sessions, memberships) inside the auth and access modules.
 */
export function db(): Database {
  if (!_db) _db = drizzle(pool(), { schema });
  return _db;
}

export type Scope = {
  orgId: string;
  userId: string | null;
  /** Firms whose rows this transaction may read and write. */
  firmIds: readonly string[];
  intake?: boolean;
  /** Hub Airtable mirror datasets (firm_id null) may be read/written. */
  mirror?: boolean;
  auditScope?: "org" | "firm" | "";
  /** Mail sync and inbound webhooks: may read personal mailboxes' conversations. Never set from a user request. */
  mailSystem?: boolean;
  /** Firms where the caller administers the practice and so sees restricted matters. */
  matterAdminFirms?: readonly string[];
};

/**
 * Run `fn` in a transaction whose row-level security settings are limited to
 * `scope`. Settings are transaction-local, so they cannot leak to other requests
 * sharing the pooled connection.
 */
export async function withScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (const id of [...scope.firmIds, ...(scope.matterAdminFirms ?? [])]) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid firm id in scope");
  }
  return db().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.org_id', ${scope.orgId}, true),
      set_config('app.user_id', ${scope.userId ?? ""}, true),
      set_config('app.firm_ids', ${scope.firmIds.join(",")}, true),
      set_config('app.intake', ${scope.intake ? "on" : "off"}, true),
      set_config('app.mirror', ${scope.mirror ? "on" : "off"}, true),
      set_config('app.audit_scope', ${scope.auditScope ?? ""}, true),
      set_config('app.mail_system', ${scope.mailSystem ? "on" : "off"}, true),
      set_config('app.matter_admin_firms', ${(scope.matterAdminFirms ?? []).join(",")}, true)`);
    return fn(tx);
  });
}

import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

/** Liveness and database reachability for uptime monitors. No details are exposed. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

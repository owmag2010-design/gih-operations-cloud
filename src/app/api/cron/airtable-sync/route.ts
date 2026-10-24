import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runDueMirrorSyncs } from "@/server/modules/mirror/mirror";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel Cron, every 15 minutes: incremental Airtable syncs, with a full sync every six hours. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const r = await runDueMirrorSyncs(Date.now() + 55_000);
  return Response.json(
    "skipped" in r ? { synced: 0, note: "Airtable is not connected" } : { synced: r.synced, failures: r.results.filter((x) => x.status === "error").length },
    { headers: { "Cache-Control": "no-store" } },
  );
}

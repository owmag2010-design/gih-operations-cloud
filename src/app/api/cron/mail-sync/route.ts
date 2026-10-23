import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runDueSyncs } from "@/server/modules/email/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel Cron, every 5 minutes: sync connected mailboxes and catch up anything missed. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const reports = await runDueSyncs(50_000);
  return Response.json(
    { synced: reports.length, imported: reports.reduce((n, r) => n + r.imported, 0), failures: reports.filter((r) => r.error).length },
    { headers: { "Cache-Control": "no-store" } },
  );
}

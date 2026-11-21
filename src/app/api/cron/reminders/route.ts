import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runDueReminders } from "@/server/modules/reminders/reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron, once a day: client document reminders and team digests for
 * practices that have switched them on. Safe to run again the same day.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const reports = await runDueReminders();
  const sum = (k: "clientSent" | "digestsSent" | "failed" | "skipped") => reports.reduce((n, r) => n + r[k], 0);
  return Response.json(
    { practices: reports.length, clientReminders: sum("clientSent"), digests: sum("digestsSent"), failed: sum("failed"), skipped: sum("skipped") },
    { headers: { "Cache-Control": "no-store" } },
  );
}

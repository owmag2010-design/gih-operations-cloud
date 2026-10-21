import { exportClientsCsv } from "@/server/modules/clients/clients";
import { requireFirm } from "@/server/next/session";

export async function GET(request: Request, { params }: RouteContext<"/f/[firmSlug]/clients/export">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("clients:export", firm.firmId)) return new Response("Forbidden", { status: 403 });
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const csv = await exportClientsCsv(ctx, firm.firmId, { status });
  return new Response(`﻿${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${firm.slug}-clients-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}

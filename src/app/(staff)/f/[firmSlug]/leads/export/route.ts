import { parseLeadFilters } from "@/server/modules/crm/filters";
import { exportLeadsCsv } from "@/server/modules/crm/leads";
import { requireFirm } from "@/server/next/session";

export async function GET(request: Request, { params }: RouteContext<"/f/[firmSlug]/leads/export">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  if (!ctx.has("leads:export", firm.firmId)) return new Response("Forbidden", { status: 403 });
  const csv = await exportLeadsCsv(ctx, firm.firmId, parseLeadFilters(sp));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${firm.slug}-leads-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

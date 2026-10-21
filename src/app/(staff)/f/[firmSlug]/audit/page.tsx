import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listAuditEvents } from "@/server/modules/audit/read";
import { requireFirm } from "@/server/next/session";

export const metadata: Metadata = { title: "Audit log" };

export default async function FirmAuditPage({ params, searchParams }: PageProps<"/f/[firmSlug]/audit">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("audit:firm", firm.firmId)) notFound();
  const sp = await searchParams;
  const before = Number(sp.before) || undefined;
  const events = await listAuditEvents(ctx, { firmId: firm.firmId, before });
  return (
    <>
      <PageHeader title="Audit log" description={`Every change to ${firm.tradingName}'s records and access. Entries can't be edited or deleted.`} />
      <Panel><AuditTable events={events} basePath={`/f/${firm.slug}/audit`} showFirm={false} /></Panel>
    </>
  );
}

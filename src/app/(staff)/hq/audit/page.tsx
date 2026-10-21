import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listAuditEvents } from "@/server/modules/audit/read";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Audit log" };

export default async function OrgAuditPage({ searchParams }: PageProps<"/hq/audit">) {
  const { ctx } = await requireStaff();
  if (!ctx.has("audit:view")) notFound();
  const sp = await searchParams;
  const events = await listAuditEvents(ctx, { before: Number(sp.before) || undefined });
  return (
    <>
      <PageHeader title="Audit log" description="Sign-ins, access changes, routing and record changes across the organisation. Entries can't be edited or deleted." />
      <Panel><AuditTable events={events} basePath="/hq/audit" showFirm /></Panel>
    </>
  );
}

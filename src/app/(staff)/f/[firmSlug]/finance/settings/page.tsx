import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { canViewFinance, getBilling } from "@/server/modules/finance/finance";
import { requireFirm } from "@/server/next/session";
import { BillingForm } from "../client";
import { FinanceTabs } from "../tabs";

export const metadata: Metadata = { title: "Billing settings" };

export default async function BillingSettingsPage({ params }: PageProps<"/f/[firmSlug]/finance/settings">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewFinance(ctx, firm.firmId)) notFound();
  const billing = await getBilling(ctx, firm.firmId);
  return (
    <>
      <PageHeader title="Billing settings" description={`How ${firm.tradingName} invoices as its own entity. Issued invoices keep the details they were issued with; changes here apply to invoices issued from now on.`} />
      <FinanceTabs slug={firm.slug} current="settings" showSettings />
      <Panel className="p-5">
        <BillingForm slug={firm.slug} billing={billing} canEdit={ctx.has("invoices:issue", firm.firmId)} />
      </Panel>
      <p className="mt-3 text-xs text-muted">Whether and at what rate the practice charges tax is the practice&apos;s decision; the system applies what is entered here.</p>
    </>
  );
}

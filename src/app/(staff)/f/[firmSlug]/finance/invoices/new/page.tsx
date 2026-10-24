import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { invoiceFormOptions } from "@/server/modules/finance/finance";
import { requireFirm } from "@/server/next/session";
import { NewInvoiceForm } from "./form";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ params, searchParams }: PageProps<"/f/[firmSlug]/finance/invoices/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("invoices:edit", firm.firmId)) notFound();
  const sp = await searchParams;
  const options = await invoiceFormOptions(ctx, firm.firmId);
  return (
    <>
      <PageHeader title="New invoice" description="Start a draft for a client. You add the lines next; nothing is numbered or sent until it is issued." />
      <Panel className="max-w-3xl p-5">
        <NewInvoiceForm
          slug={firm.slug}
          clients={options.clients}
          matters={options.matters}
          defaultCurrency={options.billing.defaultCurrency}
          defaults={{ clientId: typeof sp.client === "string" ? sp.client : undefined, matterId: typeof sp.matter === "string" ? sp.matter : undefined }}
        />
      </Panel>
    </>
  );
}

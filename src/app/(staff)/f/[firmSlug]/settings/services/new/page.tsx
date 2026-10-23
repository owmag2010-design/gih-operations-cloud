import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { requireFirm } from "@/server/next/session";
import { createServiceAction } from "../../../actions";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "New service" };

export default async function NewServicePage({ params }: PageProps<"/f/[firmSlug]/settings/services/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("services:manage", firm.firmId)) notFound();
  return (
    <>
      <PageHeader title="Add a service" description={`A new service in ${firm.tradingName}'s catalogue. It can be added to proposals straight away.`} />
      <Panel className="max-w-3xl p-4">
        <ServiceForm
          action={createServiceAction.bind(null, firmSlug)}
          submitLabel="Add service"
          initial={{ name: "", category: "Other", jurisdiction: "ZA", currency: "ZAR", deposit: "", isActive: true, lines: [] }}
        />
      </Panel>
    </>
  );
}

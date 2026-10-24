import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { documentFormOptions, KIND_LABEL } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";
import { NewDocumentForm } from "../client";

export const metadata: Metadata = { title: "New document" };

export default async function NewDocumentPage({ params, searchParams }: PageProps<"/f/[firmSlug]/documents/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("documents:edit", firm.firmId)) notFound();
  const sp = await searchParams;
  const options = await documentFormOptions(ctx, firm.firmId);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return (
    <>
      <PageHeader title="New document" description="Choose a template and link the client or matter; their details are filled in for you." />
      <Panel className="max-w-3xl p-5">
        <NewDocumentForm slug={firm.slug} options={options} kinds={Object.entries(KIND_LABEL)} defaults={{ matterId: str(sp.matter), clientId: str(sp.client), templateId: str(sp.template) }} />
      </Panel>
    </>
  );
}

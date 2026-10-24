import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { MERGE_FIELDS } from "@/server/modules/documents/content";
import { KIND_LABEL } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";
import { TemplateEditor } from "../../client";

export const metadata: Metadata = { title: "New document template" };

export default async function NewTemplatePage({ params }: PageProps<"/f/[firmSlug]/documents/templates/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("document_templates:manage", firm.firmId)) notFound();
  return (
    <>
      <PageHeader title="New document template" />
      <Panel className="p-5">
        <TemplateEditor slug={firm.slug} id={null} initial={{ name: "", kind: "letter", description: "", letterhead: true, content: { type: "doc", content: [{ type: "paragraph" }] } }} kinds={Object.entries(KIND_LABEL)} fields={Object.entries(MERGE_FIELDS)} />
      </Panel>
    </>
  );
}

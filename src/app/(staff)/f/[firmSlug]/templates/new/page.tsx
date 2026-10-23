import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/email/template-editor";
import { PageHeader } from "@/components/ui/primitives";
import { requireFirm } from "@/server/next/session";

export const metadata: Metadata = { title: "New template" };

export default async function NewFirmTemplatePage({ params }: PageProps<"/f/[firmSlug]/templates/new">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("templates:manage", firm.firmId)) notFound();
  return (
    <>
      <PageHeader title="New email template" description={`Sent in ${firm.tradingName}'s branding.`} />
      <TemplateEditor scopeKey={firm.slug} base={`/f/${firm.slug}`} id={null} initial={{ name: "", category: "General", subject: "", preheader: "", isActive: true, blocks: [{ type: "heading", text: "" }, { type: "paragraph", text: "Hi {{first_name}},\n\n" }] }} />
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplatesList } from "@/components/email/templates-list";
import { PageHeader } from "@/components/ui/primitives";
import { listTemplates } from "@/server/modules/email/mail";
import { requireFirm } from "@/server/next/session";

export const metadata: Metadata = { title: "Email templates" };

export default async function FirmTemplatesPage({ params }: PageProps<"/f/[firmSlug]/templates">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("email:view", firm.firmId) && !ctx.has("templates:manage", firm.firmId)) notFound();
  const templates = await listTemplates(ctx, { kind: "firm", firmId: firm.firmId }, { includeHub: true });
  return (
    <>
      <PageHeader title="Email templates" description={`${firm.tradingName}'s own templates, plus the Hub's shared ones (marked Hub). Emails go out in ${firm.tradingName}'s branding.`} />
      <TemplatesList base={`/f/${firm.slug}`} templates={templates} canEdit={ctx.has("templates:manage", firm.firmId)} showHub />
    </>
  );
}

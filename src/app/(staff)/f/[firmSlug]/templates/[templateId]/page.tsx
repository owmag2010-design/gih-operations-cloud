import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/email/template-editor";
import { Notice, PageHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { getTemplate } from "@/server/modules/email/mail";
import { requireFirm } from "@/server/next/session";

export const metadata: Metadata = { title: "Email template" };

export default async function FirmTemplatePage({ params }: PageProps<"/f/[firmSlug]/templates/[templateId]">) {
  const { firmSlug, templateId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const t = await getTemplate(ctx, { kind: "firm", firmId: firm.firmId }, templateId).catch((e) => (e instanceof NotFoundError ? notFound() : Promise.reject(e)));
  const hub = t.firmId === null;
  const readOnly = hub || !ctx.has("templates:manage", firm.firmId);
  return (
    <>
      <PageHeader title={t.name} description={`Version ${t.version}${hub ? " · Shared by the Hub" : ""}`} />
      {hub ? <Notice className="mb-4">This is a Hub template shared with every firm. It sends in {firm.tradingName}&apos;s branding. Only Hub administrators can change it; create your own to adapt it.</Notice> : null}
      <TemplateEditor scopeKey={firm.slug} base={`/f/${firm.slug}`} id={hub ? null : t.id} readOnly={readOnly} initial={{ name: t.name, category: t.category, subject: t.subject, preheader: t.preheader ?? "", isActive: t.isActive, blocks: t.blocks }} />
    </>
  );
}

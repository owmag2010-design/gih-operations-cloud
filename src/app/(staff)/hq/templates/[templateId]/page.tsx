import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/email/template-editor";
import { PageHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { getTemplate } from "@/server/modules/email/mail";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Email template" };

export default async function HubTemplatePage({ params }: PageProps<"/hq/templates/[templateId]">) {
  const { templateId } = await params;
  const { ctx } = await requireStaff();
  const t = await getTemplate(ctx, { kind: "hub" }, templateId).catch((e) => (e instanceof NotFoundError ? notFound() : Promise.reject(e)));
  return (
    <>
      <PageHeader title={t.name} description={`Version ${t.version} · Shared with every partner firm`} />
      <TemplateEditor scopeKey="hub" base="/hq" id={t.id} readOnly={!ctx.has("hub_templates:manage")} initial={{ name: t.name, category: t.category, subject: t.subject, preheader: t.preheader ?? "", isActive: t.isActive, blocks: t.blocks, format: t.format, html: t.html, slots: t.slots, textOverride: t.textOverride }} />
    </>
  );
}

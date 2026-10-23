import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplatesList } from "@/components/email/templates-list";
import { PageHeader } from "@/components/ui/primitives";
import { listTemplates } from "@/server/modules/email/mail";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Email templates" };

export default async function HubTemplatesPage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("hub_templates:manage") && !ctx.has("intake:view")) notFound();
  const templates = await listTemplates(ctx, { kind: "hub" });
  return (
    <>
      <PageHeader title="Email templates" description="The Hub's templates. Every partner firm can use them; each firm's emails go out in that firm's branding." />
      <TemplatesList base="/hq" templates={templates} canEdit={ctx.has("hub_templates:manage")} showHub={false} />
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/email/template-editor";
import { PageHeader } from "@/components/ui/primitives";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "New template" };

export default async function NewHubTemplatePage() {
  const { ctx } = await requireStaff();
  if (!ctx.has("hub_templates:manage")) notFound();
  return (
    <>
      <PageHeader title="New Hub template" description="Shared with every partner firm." />
      <TemplateEditor scopeKey="hub" base="/hq" id={null} initial={{ name: "", category: "General", subject: "", preheader: "", isActive: true, blocks: [{ type: "heading", text: "" }, { type: "paragraph", text: "Hi {{first_name}},\n\n" }] }} />
    </>
  );
}

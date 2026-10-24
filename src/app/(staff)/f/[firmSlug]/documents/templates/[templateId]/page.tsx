import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { MERGE_FIELDS } from "@/server/modules/documents/content";
import { getTemplate, KIND_LABEL } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";
import { TemplateEditor } from "../../client";

export const metadata: Metadata = { title: "Document template" };

export default async function TemplatePage({ params }: PageProps<"/f/[firmSlug]/documents/templates/[templateId]">) {
  const { firmSlug, templateId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("document_templates:manage", firm.firmId)) notFound();
  let v: Awaited<ReturnType<typeof getTemplate>>;
  try {
    v = await getTemplate(ctx, firm.firmId, templateId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { template: t, history } = v;
  return (
    <>
      <p className="mb-2 text-[13px]"><Link href={`/f/${firm.slug}/documents/templates`} className="text-muted hover:text-ink">← Document templates</Link></p>
      <PageHeader title={t.name} description={`Version ${t.version}. Documents already created keep the text they started with.`} />
      {t.isStarter ? <Notice tone="warn" className="mb-4">Starter template: structure and merge fields only. Replace the [[…]] prompts and add the practice&apos;s own wording before relying on it.</Notice> : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
        <Panel className="p-5">
          <TemplateEditor slug={firm.slug} id={t.id} initial={{ name: t.name, kind: t.kind, description: t.description ?? "", letterhead: t.letterhead, content: t.content }} kinds={Object.entries(KIND_LABEL)} fields={Object.entries(MERGE_FIELDS)} />
        </Panel>
        <Panel>
          <PanelHeader title="History" />
          <ol className="flex flex-col divide-y divide-hairline text-[13px]">
            {history.map((h) => (
              <li key={h.version} className="px-4 py-2"><span className="font-medium">v{h.version}</span> <span className="text-xs text-muted">{h.editedBy ?? "Set-up"} · <LocalTime value={h.editedAt} mode="relative" /></span></li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

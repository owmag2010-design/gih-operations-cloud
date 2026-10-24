import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, EmptyState, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { KIND_LABEL, listTemplates } from "@/server/modules/documents/documents";
import { requireFirm } from "@/server/next/session";
import { TemplateActiveToggle } from "../client";
import { DocumentTabs } from "../tabs";

export const metadata: Metadata = { title: "Document templates" };

export default async function DocumentTemplatesPage({ params }: PageProps<"/f/[firmSlug]/documents/templates">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("document_templates:manage", firm.firmId)) notFound();
  const rows = await listTemplates(ctx, firm.firmId);
  const base = `/f/${firm.slug}/documents`;
  return (
    <>
      <PageHeader
        title="Document templates"
        description={`${firm.tradingName}'s letterhead templates. Starter templates give the structure only; adapt the wording before relying on them. Every change is kept as a version.`}
        actions={<Button asChild variant="primary"><Link href={`${base}/templates/new`}>New template</Link></Button>}
      />
      <DocumentTabs slug={firm.slug} current="templates" show={{ templates: true, email: ctx.has("email:view", firm.firmId) || ctx.has("templates:manage", firm.firmId) }} />
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No templates yet" />
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Template</th><th className={t.th}>Type</th><th className={t.th}>Version</th><th className={t.th}>Updated</th><th className={t.th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={t.row}>
                    <td className={t.td}>
                      <Link href={`${base}/templates/${r.id}`} className="text-ink underline-offset-2 hover:underline">{r.name}</Link>
                      {r.isStarter ? <Badge tone="outline" className="ml-2">Starter</Badge> : null}
                      {!r.isActive ? <Badge className="ml-2">Off</Badge> : null}
                      {r.description ? <div className="text-xs text-muted">{r.description}</div> : null}
                    </td>
                    <td className={`${t.td} text-ink-2`}>{KIND_LABEL[r.kind]}</td>
                    <td className={`${t.td} num`}>v{r.version}</td>
                    <td className={`${t.td} text-muted`}><LocalTime value={r.updatedAt} mode="relative" /></td>
                    <td className={`${t.td} text-right`}>
                      <span className="inline-flex gap-1">
                        {r.isActive ? <Button asChild size="sm" variant="ghost"><Link href={`${base}/new?template=${r.id}`}>Use</Link></Button> : null}
                        <TemplateActiveToggle slug={firm.slug} id={r.id} active={r.isActive} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

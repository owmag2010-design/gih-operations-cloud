import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { getMirrorRecord } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";
import { FieldValue } from "../../values";

export const metadata: Metadata = { title: "Airtable record" };

export default async function MirrorRecordPage({ params }: PageProps<"/airtable/[sourceId]/[recordId]">) {
  const { sourceId, recordId } = await params;
  const { ctx } = await requireStaff();
  const { source, record, names, back } = await getMirrorRecord(ctx, sourceId, decodeURIComponent(recordId)).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const backBy = new Map<string, typeof back>();
  for (const b of back) backBy.set(b.dataset, [...(backBy.get(b.dataset) ?? []), b]);
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href="/airtable" className="hover:text-ink">Airtable mirror</Link> <span aria-hidden="true">/</span> <Link href={`/airtable/${source.id}`} className="hover:text-ink">{source.dataset}</Link> <span aria-hidden="true">/</span> <span className="num">{record.recordId}</span>
      </nav>
      <PageHeader title={record.primaryValue || record.recordId} description={`${source.baseName} › ${source.tableName}. Read-only: change this record in Airtable.`} meta={record.removedAt ? <Badge tone="danger">Removed in Airtable</Badge> : <Badge tone="ok">In Airtable</Badge>} />
      {record.removedAt ? <Notice tone="warn" className="mb-4">This record wasn&apos;t in Airtable at the full sync on <LocalTime value={record.removedAt} />. It is kept here as last seen, under the mirror&apos;s retention policy.</Notice> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Panel>
          <PanelHeader title="Fields" />
          <dl className="divide-y divide-hairline">
            {source.fields.map((f) => (
              <div key={f.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[200px_1fr]">
                <dt className="text-[13px] text-muted">{f.name}{f.computed ? <span className="ml-1 text-[11px] text-warn">(calculated)</span> : null}</dt>
                <dd className="text-sm text-ink"><FieldValue field={f} value={record.fields[f.id]} names={names} sourceId={source.id} recordId={record.recordId} /></dd>
              </div>
            ))}
          </dl>
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Mirror details" />
            <dl className="flex flex-col gap-2 p-4 text-[13px]">
              <div><dt className="text-muted">Airtable record id</dt><dd className="num text-ink">{record.recordId}</dd></div>
              <div><dt className="text-muted">Created in Airtable</dt><dd className="text-ink">{record.airtableCreatedAt ? <LocalTime value={record.airtableCreatedAt} /> : "Unknown"}</dd></div>
              <div><dt className="text-muted">First imported</dt><dd className="text-ink"><LocalTime value={record.firstSeenAt} /></dd></div>
              <div><dt className="text-muted">Last changed</dt><dd className="text-ink"><LocalTime value={record.lastChangedAt} /></dd></div>
              <div><dt className="text-muted">Last seen in Airtable</dt><dd className="text-ink"><LocalTime value={record.lastSeenAt} /></dd></div>
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title="Linked from" description="Mirrored records that link to this one." />
            {backBy.size ? (
              <div className="flex flex-col gap-3 p-4">
                {[...backBy.entries()].map(([ds, list]) => (
                  <div key={ds}>
                    <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{ds}</p>
                    <ul className="flex flex-col gap-0.5">{list.map((b) => <li key={b.recordId}><Link href={`/airtable/${b.sourceId}/${b.recordId}`} className="text-[13px] text-ink hover:underline">{b.name || b.recordId}</Link></li>)}</ul>
                  </div>
                ))}
              </div>
            ) : <p className="p-4 text-[13px] text-muted">Nothing links here.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}

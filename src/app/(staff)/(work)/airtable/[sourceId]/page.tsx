import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, cn, EmptyState, Notice, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { ClientSearch } from "@/app/(staff)/f/[firmSlug]/clients/search";
import { NotFoundError } from "@/server/errors";
import { getSource, listMirrorRecords, mirrorConnected } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";
import { SyncControls } from "../client";
import { FieldValue, TRUTH } from "../values";

export const metadata: Metadata = { title: "Airtable dataset" };

const SIMPLE = new Set(["singleLineText", "email", "phoneNumber", "singleSelect", "multipleSelects", "date", "dateTime", "currency", "number", "checkbox", "multipleRecordLinks", "createdTime"]);

export default async function SourcePage({ params, searchParams }: PageProps<"/airtable/[sourceId]">) {
  const { sourceId } = await params;
  const { ctx } = await requireStaff();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const tab = one(sp.tab) === "fields" ? "fields" : one(sp.tab) === "history" ? "history" : "records";
  const show = one(sp.show) === "removed" ? "removed" : one(sp.show) === "all" ? "all" : "active";
  const [{ source, runs, linked, canManage }, data] = await Promise.all([
    getSource(ctx, sourceId),
    listMirrorRecords(ctx, sourceId, { q: one(sp.q), show, page: Number(one(sp.page)) || 1 }),
  ]).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const primary = source.fields.find((f) => f.id === source.primaryFieldId);
  const columns = source.fields.filter((f) => f.id !== source.primaryFieldId && SIMPLE.has(f.type)).slice(0, 5);
  const base = `/airtable/${source.id}`;
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ tab: tab === "records" ? undefined : tab, show: show === "active" ? undefined : show, q: one(sp.q), ...over }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return p.toString() ? `${base}?${p}` : base;
  };
  const pill = (active: boolean) => cn("rounded-full px-3.5 py-1.5 text-[13px]", active ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-sunken");

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted"><Link href="/airtable" className="hover:text-ink">Airtable mirror</Link> <span aria-hidden="true">/</span> {source.dataset}</nav>
      <PageHeader
        title={source.dataset}
        description={<>{source.baseName} › {source.tableName}. Read-only mirror{source.lastSuccessAt ? <>, last synced <LocalTime value={source.lastSuccessAt} mode="relative" /></> : ", not synced yet"}.</>}
        meta={<><Badge tone={TRUTH[source.sourceOfTruth].tone}>{TRUTH[source.sourceOfTruth].label}</Badge>{!source.enabled ? <Badge tone="outline">Paused</Badge> : null}</>}
        actions={<><Button asChild size="sm"><Link href={`${base}/reconcile`}>Reconciliation</Link></Button>{canManage && mirrorConnected() ? <SyncControls sourceId={source.id} enabled={source.enabled} /> : null}</>}
      />
      {source.truthNote ? <Notice className="mb-4">{source.truthNote}</Notice> : null}
      {source.lastError ? <Notice tone="danger" className="mb-4">Last sync failed: {source.lastError}{source.nextAttemptAt ? <> Next automatic attempt <LocalTime value={source.nextAttemptAt} mode="relative" />.</> : null}</Notice> : null}

      <nav aria-label="View" className="mb-4 flex flex-wrap items-center gap-1">
        <Link href={qs({ tab: undefined })} className={pill(tab === "records")}>Records</Link>
        <Link href={qs({ tab: "fields" })} className={pill(tab === "fields")}>Field mapping</Link>
        <Link href={qs({ tab: "history" })} className={pill(tab === "history")}>Sync history</Link>
      </nav>

      {tab === "records" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ClientSearch initial={one(sp.q) ?? ""} label="Search records" placeholder="Search any field" />
            {[["active", "In Airtable"], ["removed", "Removed in Airtable"], ["all", "All"]].map(([v, l]) => <Link key={v} href={qs({ show: v === "active" ? undefined : v, page: undefined })} className={pill(show === v)}>{l}</Link>)}
          </div>
          <Panel>
            {data.rows.length ? (
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead><tr><th className={t.th}>{primary?.name ?? "Record"}</th>{columns.map((c) => <th key={c.id} className={t.th}>{c.name}</th>)}<th className={t.th}>Changed</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className={t.row}>
                        <td className={t.td}><Link href={`${base}/${r.recordId}`} className={cn("font-medium text-ink hover:underline", r.removedAt && "line-through")}>{r.primaryValue || r.recordId}</Link>{r.removedAt ? <span className="block text-xs text-danger">Removed in Airtable</span> : null}</td>
                        {columns.map((c) => <td key={c.id} className={`${t.td} max-w-[240px] text-ink-2`}><FieldValue field={c} value={r.fields[c.id]} names={data.names} sourceId={source.id} recordId={r.recordId} compact /></td>)}
                        <td className={`${t.td} text-ink-2`}><LocalTime value={r.lastChangedAt} mode="relative" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={source.lastSuccessAt ? "No records match" : "Nothing imported yet"}>{source.lastSuccessAt ? "Try another search or view." : "Records appear after the first sync."}</EmptyState>
            )}
            {data.total > data.pageSize ? (
              <div className="flex items-center justify-between px-3 py-2.5 text-[13px] text-muted">
                <span className="num">Page {data.page} of {Math.ceil(data.total / data.pageSize)} · {data.total} records</span>
                <div className="flex gap-1">
                  {data.page > 1 ? <Button asChild size="sm"><Link href={qs({ page: String(data.page - 1) })}>Previous</Link></Button> : null}
                  {data.page * data.pageSize < data.total ? <Button asChild size="sm"><Link href={qs({ page: String(data.page + 1) })}>Next</Link></Button> : null}
                </div>
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}

      {tab === "fields" ? (
        <Panel>
          <PanelHeader title="Field mapping" description="Every field in the Airtable table, as the mirror stores it. Calculated fields can never be edited from the dashboard; while the mirror is read-only, no field is edited here." />
          {source.fields.length ? (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead><tr><th className={t.th}>Field</th><th className={t.th}>Airtable type</th><th className={t.th}>Kind</th><th className={t.th}>Links to</th><th className={t.th}>Field id</th></tr></thead>
                <tbody>
                  {source.fields.map((f) => (
                    <tr key={f.id} className={t.row}>
                      <td className={t.td}><span className="font-medium text-ink">{f.name}</span>{f.id === source.primaryFieldId ? <Badge tone="outline" className="ml-1.5">Primary</Badge> : null}{f.description ? <p className="mt-0.5 max-w-[420px] text-xs text-muted">{f.description}</p> : null}</td>
                      <td className={`${t.td} text-ink-2`}>{f.type}</td>
                      <td className={t.td}>{f.computed ? <Badge tone="warn">Calculated by Airtable</Badge> : <Badge tone="neutral">Stored value</Badge>}</td>
                      <td className={t.td}>{f.linkedTableId ? (linked[f.id] ? <Link href={`/airtable/${linked[f.id]!.id}`} className="text-ink underline-offset-2 hover:underline">{linked[f.id]!.dataset}</Link> : <span className="text-muted">A table that isn&apos;t mirrored</span>) : <span className="text-muted">—</span>}</td>
                      <td className={`${t.td} num text-xs text-muted`}>{f.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Fields appear after the first sync" />}
          <p className="px-4 py-3 text-xs text-muted">Airtable views are filters over these records; the mirror copies the underlying records, not views.{source.schemaCheckedAt ? <> Schema checked <LocalTime value={source.schemaCheckedAt} mode="relative" />.</> : null}</p>
        </Panel>
      ) : null}

      {tab === "history" ? (
        <Panel>
          <PanelHeader title="Sync history" description="The last ten runs." />
          {runs.length ? (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead><tr><th className={t.th}>Started</th><th className={t.th}>Kind</th><th className={t.th}>Trigger</th><th className={t.th}>Result</th><th className={`${t.th} text-right`}>Read</th><th className={`${t.th} text-right`}>New</th><th className={`${t.th} text-right`}>Changed</th><th className={`${t.th} text-right`}>Removed</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={t.row}>
                      <td className={t.td}><LocalTime value={r.startedAt} /></td>
                      <td className={`${t.td} capitalize`}>{r.kind}</td>
                      <td className={`${t.td} text-ink-2`}>{r.trigger.startsWith("manual") ? "Manual" : "Scheduled"}</td>
                      <td className={t.td}><Badge tone={r.status === "ok" ? "ok" : r.status === "error" ? "danger" : "neutral"}>{r.status === "ok" ? "Done" : r.status === "error" ? "Failed" : "Running"}</Badge>{r.error ? <p className="mt-1 max-w-[300px] text-xs text-danger">{r.error}</p> : null}</td>
                      <td className={`${t.td} num text-right`}>{r.fetched}</td>
                      <td className={`${t.td} num text-right`}>{r.created}</td>
                      <td className={`${t.td} num text-right`}>{r.updated}</td>
                      <td className={`${t.td} num text-right`}>{r.removed}{r.restored ? <span className="block text-xs text-muted">{r.restored} restored</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No syncs yet" />}
        </Panel>
      ) : null}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { reconcile } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Reconciliation" };

export default async function ReconcilePage({ params }: PageProps<"/airtable/[sourceId]/reconcile">) {
  const { sourceId } = await params;
  const { ctx } = await requireStaff();
  const r = await reconcile(ctx, sourceId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const s = r.source;
  const brokenLinks = r.linkIssues.filter((l) => !l.notMirrored && l.missing.length);
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted"><Link href="/airtable" className="hover:text-ink">Airtable mirror</Link> <span aria-hidden="true">/</span> <Link href={`/airtable/${s.id}`} className="hover:text-ink">{s.dataset}</Link> <span aria-hidden="true">/</span> Reconciliation</nav>
      <PageHeader title={`Reconciliation: ${s.dataset}`} description={<>Checks the mirror against Airtable at the last full sync{s.lastFullSyncAt ? <> (<LocalTime value={s.lastFullSyncAt} mode="relative" />)</> : ", which hasn't run yet"}, and against the dashboard where the dataset maps to dashboard records.</>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Stat label="In Airtable at last full sync" value={r.counts.sourceCount ?? "—"} />
        <Stat label="Active in the mirror" value={r.counts.active} />
        <Stat label="Removed in Airtable (kept)" value={r.counts.removed} />
        <Stat label="Changed since last full sync" value={r.counts.changedSinceFull} />
      </div>
      {r.countMatches === false ? <Notice tone="danger" className="mb-4">The mirror holds {r.counts.active} active records but Airtable returned {r.counts.sourceCount}. Run a full sync; if it persists, check the sync history for errors.</Notice> : r.countMatches ? <Notice tone="ok" className="mb-4">Record counts match Airtable.</Notice> : null}
      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Linked records" description="Every link to a mirrored table should point at a record in the mirror." />
          <ul className="divide-y divide-hairline">
            {r.linkIssues.map((l) => (
              <li key={l.fieldId} className="px-4 py-3 text-[13px]">
                <p className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{l.fieldName}</span>{l.notMirrored ? <Badge tone="outline">Links to a table that isn&apos;t mirrored</Badge> : l.missing.length ? <Badge tone="danger">{l.missing.length} missing</Badge> : <Badge tone="ok">All present in {l.target}</Badge>}{l.removedTargets ? <Badge tone="warn">{l.removedTargets} point at removed records</Badge> : null}</p>
                {l.missing.length ? <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-2">{l.missing.map((m) => <li key={m.from + m.recordId}><Link href={`/airtable/${s.id}/${m.from}`} className="underline-offset-2 hover:underline">{m.fromName || m.from}</Link> → <span className="num">{m.recordId}</span> not in {l.target}</li>)}</ul> : null}
              </li>
            ))}
            {!r.linkIssues.length ? <li className="px-4 py-3 text-[13px] text-muted">This table has no link fields.</li> : null}
          </ul>
          {brokenLinks.length ? <p className="border-t border-hairline px-4 py-2.5 text-xs text-muted">Missing links usually mean the linked table hasn&apos;t synced since the link was made. Sync that table, then check again.</p> : null}
        </Panel>
        {r.notInDashboard ? (
          <Panel>
            <PanelHeader title="Not yet in the dashboard" description="Clients in this Airtable table whose email doesn't match any client of the practice in the dashboard." />
            {r.notInDashboard.length ? (
              <ul className="divide-y divide-hairline">{r.notInDashboard.map((c) => <li key={c.recordId} className="flex justify-between px-4 py-2 text-[13px]"><Link href={`/airtable/${s.id}/${c.recordId}`} className="text-ink hover:underline">{c.name || c.recordId}</Link><span className="text-muted">{c.email}</span></li>)}</ul>
            ) : <EmptyState title="Every client with an email is in the dashboard" />}
          </Panel>
        ) : null}
        <Panel>
          <PanelHeader title="Removed in Airtable" description="Kept in the mirror as last seen. They are never deleted here." />
          {r.removedRows.length ? (
            <ul className="divide-y divide-hairline">{r.removedRows.map((x) => <li key={x.recordId} className="flex justify-between px-4 py-2 text-[13px]"><Link href={`/airtable/${s.id}/${x.recordId}`} className="text-ink line-through hover:underline">{x.name || x.recordId}</Link><span className="text-muted">{x.removedAt ? <LocalTime value={x.removedAt} mode="relative" /> : null}</span></li>)}</ul>
          ) : <EmptyState title="Nothing removed" />}
        </Panel>
        <Panel>
          <PanelHeader title="Calculated fields" description="Values Airtable computes. They are mirrored as shown in Airtable and can't be edited from the dashboard." />
          <p className="p-4 text-[13px] text-ink-2">{r.computedFields.length ? r.computedFields.join(", ") : "None"}</p>
        </Panel>
        <Panel>
          <PanelHeader title="Pending updates" />
          <p className="p-4 text-[13px] text-ink-2">None. The mirror is read-only: no changes are queued for Airtable. Write-back will only be switched on after the update, conflict and loop-prevention rules in docs/16-airtable-mirror.md are agreed.</p>
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="num font-display text-[28px] text-ink">{value}</p>
    </div>
  );
}

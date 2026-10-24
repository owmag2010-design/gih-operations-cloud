import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Notice, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { canUseMirror, listSources, mirrorConnected } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";
import { SyncControls } from "./client";
import { TRUTH } from "./values";

export const metadata: Metadata = { title: "Airtable mirror" };

function status(s: { enabled: boolean; lastError: string | null; lastSuccessAt: Date | null; lastSyncAt: Date | null }) {
  if (!s.enabled) return { label: "Paused", tone: "outline" as const };
  if (s.lastError) return { label: "Error", tone: "danger" as const };
  if (!s.lastSuccessAt) return { label: "Not synced yet", tone: "neutral" as const };
  return { label: "Up to date", tone: "ok" as const };
}

export default async function MirrorPage() {
  const { ctx } = await requireStaff();
  if (!canUseMirror(ctx)) notFound();
  const sources = await listSources(ctx);
  const connected = mirrorConnected();
  const groups = new Map<string, typeof sources>();
  for (const s of sources) {
    const k = s.firmName ?? "Global Immigration Hub";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return (
    <>
      <nav aria-label="Clients and matters" className="mb-4 flex gap-1 text-[13px]">
        <Link href="/matters" className="rounded-full px-3.5 py-1.5 text-ink-2 hover:bg-sunken">Matters</Link>
        <Link href="/airtable" aria-current="page" className="rounded-full bg-accent px-3.5 py-1.5 font-medium text-accent-ink">Airtable records</Link>
      </nav>
      <PageHeader
        title="Airtable mirror"
        description="A read-only copy of the Airtable tables your work still runs on, refreshed every 15 minutes with a full reconciliation every six hours. Records removed in Airtable are kept here and marked removed. Nothing is written back to Airtable."
      />
      {!connected ? (
        <Notice tone="warn" className="mb-5">
          Airtable isn&apos;t connected yet, so nothing has been imported. A Hub administrator needs to create an Airtable personal access token with <b>data.records:read</b> and <b>schema.bases:read</b> for the bases below, and add it as <code>AIRTABLE_TOKEN</code> in the hosting settings. See docs/16-airtable-mirror.md.
        </Notice>
      ) : null}
      <div className="flex flex-col gap-5">
        {!sources.length ? <Panel><p className="p-5 text-sm text-muted">No Airtable tables are mirrored for the practices you belong to.</p></Panel> : null}
        {[...groups.entries()].map(([group, list]) => (
          <Panel key={group}>
            <div className="border-b border-hairline px-4 py-3"><h2 className="text-sm font-semibold text-ink">{group}</h2></div>
            <div className={t.wrap}>
              <table className={t.table}>
                <thead><tr><th className={t.th}>Dataset</th><th className={t.th}>Airtable</th><th className={t.th}>Source of truth</th><th className={`${t.th} text-right`}>Records</th><th className={t.th}>Last successful sync</th><th className={t.th}>Status</th>{list.some((s) => s.canManage) ? <th className={t.th}><span className="sr-only">Actions</span></th> : null}</tr></thead>
                <tbody>
                  {list.map((s) => {
                    const st = status(s);
                    return (
                      <tr key={s.id} className={t.row}>
                        <td className={t.td}><Link href={`/airtable/${s.id}`} className="font-medium text-ink hover:underline">{s.dataset}</Link></td>
                        <td className={`${t.td} text-xs text-ink-2`}>{s.baseName} › {s.tableName}</td>
                        <td className={t.td}><Badge tone={TRUTH[s.sourceOfTruth].tone}>{s.sourceOfTruth === "airtable" ? "Airtable" : s.sourceOfTruth === "dashboard" ? "Dashboard" : "Shared"}</Badge></td>
                        <td className={`${t.td} num text-right`}>{s.active.toLocaleString("en-ZA")}{s.removed ? <span className="block text-xs text-muted">{s.removed} removed</span> : null}</td>
                        <td className={`${t.td} text-ink-2`}>{s.lastSuccessAt ? <LocalTime value={s.lastSuccessAt} mode="relative" /> : "Never"}</td>
                        <td className={t.td}><Badge tone={st.tone}>{st.label}</Badge>{s.lastError ? <p className="mt-1 max-w-[260px] text-xs text-danger">{s.lastError}</p> : null}</td>
                        {list.some((x) => x.canManage) ? <td className={t.td}>{s.canManage && connected ? <SyncControls sourceId={s.id} enabled={s.enabled} compact /> : null}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

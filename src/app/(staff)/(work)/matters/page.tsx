import type { Metadata } from "next";
import { Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { practicePalette } from "@/components/shell/theme";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { fullName } from "@/lib/labels";
import { canViewMatters, listMatters } from "@/server/modules/matters/matters";
import { canUseMirror } from "@/server/modules/mirror/mirror";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Matters" };

/** Matters across every practice the person can see, grouped by practice. */
export default async function AllMattersPage() {
  const { ctx } = await requireStaff();
  const practices = [...ctx.firms.values()].filter((f) => canViewMatters(ctx, f.firmId)).sort((a, b) => a.tradingName.localeCompare(b.tradingName));
  if (!practices.length) notFound();
  const lists = await Promise.all(practices.map(async (f) => ({ f, data: await listMatters(ctx, f.firmId, { status: "open" }) })));
  const total = lists.reduce((n, l) => n + l.data.total, 0);
  return (
    <>
      <nav aria-label="Clients and matters" className="mb-4 flex gap-1 text-[13px]">
        <Link href="/matters" aria-current="page" className="rounded-full bg-accent px-3.5 py-1.5 font-medium text-accent-ink">Matters</Link>
        {canUseMirror(ctx) ? <Link href="/airtable" className="rounded-full px-3.5 py-1.5 text-ink-2 hover:bg-sunken">Airtable records</Link> : null}
      </nav>
      <PageHeader title="Matters" description={`${total} open matter${total === 1 ? "" : "s"} across ${practices.length === 1 ? practices[0].tradingName : `${practices.length} practices`}. Each practice's records stay in that practice.`} />
      <div className="flex flex-col gap-5">
        {lists.map(({ f, data }) => (
          <Panel key={f.firmId}>
            <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
              <span className="size-3 rounded-full" style={{ background: practicePalette(f.slug, f.brandColor).dark.base }} aria-hidden="true" />
              <h2 className="flex-1 text-sm font-semibold text-ink">{f.tradingName}</h2>
              <Link href={`/f/${f.slug}/matters`} className="text-[13px] text-ink-2 hover:text-ink">All {data.total} →</Link>
            </div>
            {data.rows.length ? (
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead><tr><th className={t.th}>Matter</th><th className={t.th}>Client</th><th className={t.th}>Stage</th><th className={t.th}>Case manager</th><th className={t.th}>Next deadline</th><th className={t.th}>Updated</th></tr></thead>
                  <tbody>
                    {data.rows.slice(0, 10).map((m) => (
                      <tr key={m.id} className={t.row}>
                        <td className={t.td}><Link href={`/f/${f.slug}/matters/${m.id}`} className="font-medium text-ink hover:underline">{m.title}</Link><div className="flex items-center gap-1 text-xs text-muted"><span className="num">{m.ref}</span>{m.restricted ? <Lock className="size-3" aria-label="Restricted" /> : null}</div></td>
                        <td className={t.td}>{fullName(m.clientFirst, m.clientLast)}</td>
                        <td className={t.td}><Badge tone="accent">{m.stageName}</Badge></td>
                        <td className={t.td}>{m.caseManager ?? <span className="text-muted">None</span>}</td>
                        <td className={`${t.td} num`}>{m.nextDate ?? <span className="text-muted">—</span>}</td>
                        <td className={`${t.td} text-ink-2`}><LocalTime value={m.updatedAt} mode="relative" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No open matters" />}
          </Panel>
        ))}
      </div>
    </>
  );
}

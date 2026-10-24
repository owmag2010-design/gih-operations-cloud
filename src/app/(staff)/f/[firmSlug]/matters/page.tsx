import type { Metadata } from "next";
import { Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, cn, EmptyState, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { fullName } from "@/lib/labels";
import { canViewMatters, listMatters } from "@/server/modules/matters/matters";
import { requireFirm } from "@/server/next/session";
import { ClientSearch } from "../clients/search";

export const metadata: Metadata = { title: "Matters" };

const CATEGORY_TONE = { opening: "accent", active: "neutral", submitted: "warn", closed: "outline" } as const;

export default async function MattersPage({ params, searchParams }: PageProps<"/f/[firmSlug]/matters">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewMatters(ctx, firm.firmId)) notFound();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const status = one(sp.status) === "closed" ? "closed" : one(sp.status) === "all" ? "all" : "open";
  const filters = { q: one(sp.q), stage: one(sp.stage), status, mine: one(sp.mine) === "1", page: Number(one(sp.page)) || 1 } as const;
  const data = await listMatters(ctx, firm.firmId, filters);
  const base = `/f/${firm.slug}/matters`;
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: filters.q, stage: filters.stage, status: status === "open" ? undefined : status, mine: filters.mine ? "1" : undefined, ...over }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return p.toString() ? `?${p}` : "";
  };
  const pill = (active: boolean) => cn("rounded-full px-3.5 py-1.5 text-[13px]", active ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-sunken");
  const defaultStages = data.stages.filter((s) => !s.serviceId);

  return (
    <>
      <nav aria-label="Clients and matters" className="mb-4 flex gap-1">
        <Link href={`/f/${firm.slug}/clients`} className={pill(false)}>Clients</Link>
        <Link href={base} aria-current="page" className={pill(true)}>Matters</Link>
      </nav>
      <PageHeader
        title="Matters"
        description={`${data.total.toLocaleString("en-ZA")} ${status === "all" ? "" : `${status} `}matter${data.total === 1 ? "" : "s"}${filters.q ? ` matching “${filters.q}”` : ""}${ctx.has("matters:view_all", firm.firmId) ? "" : " on your team"}.`}
        actions={ctx.has("matters:create", firm.firmId) ? <Button asChild variant="primary"><Link href={`${base}/new`}>Open a matter</Link></Button> : null}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ClientSearch initial={filters.q ?? ""} label="Search matters" placeholder="Title, client, reference" />
        <nav aria-label="Status" className="flex gap-1">
          {[["", "Open"], ["closed", "Closed"], ["all", "All"]].map(([v, l]) => <Link key={l} href={`${base}${qs({ status: v || undefined, page: undefined })}`} className={pill((status === "open" ? "" : status) === v)}>{l}</Link>)}
        </nav>
        <Link href={`${base}${qs({ mine: filters.mine ? undefined : "1" })}`} className={pill(filters.mine)}>On my team</Link>
        {defaultStages.length ? (
          <nav aria-label="Stage" className="flex flex-wrap gap-1">
            {[{ id: "", name: "Any stage" }, ...defaultStages].map((s) => <Link key={s.id || "any"} href={`${base}${qs({ stage: s.id || undefined })}`} className={pill((filters.stage ?? "") === s.id)}>{s.name}</Link>)}
          </nav>
        ) : null}
      </div>
      <Panel>
        {data.rows.length === 0 ? (
          <EmptyState title={filters.q || filters.mine || filters.stage ? "No matters match" : "No matters yet"}>
            {filters.q || filters.mine || filters.stage ? "Try a different filter." : "Open a matter from a client's page, or from an accepted proposal."}
          </EmptyState>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Matter</th><th className={t.th}>Client</th><th className={t.th}>Stage</th><th className={t.th}>Case manager</th><th className={t.th}>Next deadline</th><th className={t.th}>Open tasks</th><th className={t.th}>Updated</th></tr></thead>
              <tbody>
                {data.rows.map((m) => (
                  <tr key={m.id} className={t.row}>
                    <td className={t.td}>
                      <Link href={`${base}/${m.id}`} className="font-medium text-ink hover:underline">{m.title}</Link>
                      <div className="flex items-center gap-1.5 text-xs text-muted"><span className="num">{m.ref}</span>{m.serviceName ? <span>· {m.serviceName}</span> : null}{m.restricted ? <span className="inline-flex items-center gap-0.5"><Lock className="size-3" /> Restricted</span> : null}{m.risk !== "low" ? <Badge tone={m.risk === "high" ? "danger" : "warn"} className="capitalize">{m.risk} risk</Badge> : null}</div>
                    </td>
                    <td className={t.td}><Link href={`/f/${firm.slug}/clients/${m.clientId}`} className="text-ink-2 hover:underline">{fullName(m.clientFirst, m.clientLast)}</Link></td>
                    <td className={t.td}><Badge tone={CATEGORY_TONE[m.stageCategory]}>{m.stageName}</Badge></td>
                    <td className={t.td}>{m.caseManager ?? <span className="text-muted">None</span>}</td>
                    <td className={`${t.td} num`}>{m.nextDate ?? <span className="text-muted">—</span>}</td>
                    <td className={`${t.td} num`}>{m.openTasks || <span className="text-muted">0</span>}</td>
                    <td className={`${t.td} text-ink-2`}><LocalTime value={m.updatedAt} mode="relative" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.total > data.pageSize ? (
          <div className="flex items-center justify-between px-3 py-2.5 text-[13px] text-muted">
            <span className="num">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
            <div className="flex gap-1">
              {data.page > 1 ? <Button asChild size="sm"><Link href={`${base}${qs({ page: String(data.page - 1) })}`}>Previous</Link></Button> : null}
              {data.page * data.pageSize < data.total ? <Button asChild size="sm"><Link href={`${base}${qs({ page: String(data.page + 1) })}`}>Next</Link></Button> : null}
            </div>
          </div>
        ) : null}
      </Panel>
    </>
  );
}

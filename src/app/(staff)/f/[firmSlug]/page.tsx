import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/ui/forms";
import { Button, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { fullName } from "@/lib/labels";
import { firmDashboard } from "@/server/modules/metrics/metrics";
import { requireFirm } from "@/server/next/session";

export const metadata: Metadata = { title: "Dashboard" };

const PERIODS = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" } as const;

export default async function FirmDashboardPage({ params, searchParams }: PageProps<"/f/[firmSlug]">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const sp = await searchParams;
  const period = (typeof sp.days === "string" && sp.days in PERIODS ? sp.days : "30") as keyof typeof PERIODS;
  const base = `/f/${firm.slug}`;

  if (!ctx.has("metrics:firm", firm.firmId)) {
    return (
      <>
        <PageHeader title={firm.tradingName} description={`You're signed in as ${firm.roleName}.`} />
        <Panel>
          <EmptyState title="Your role doesn't include the firm dashboard">
            Use the navigation to open the records your role covers.
          </EmptyState>
        </Panel>
      </>
    );
  }

  const since = new Date(Date.now() - Number(period) * 864e5);
  const d = await firmDashboard(ctx, firm.firmId, since);
  const s = d.summary;
  const openStages = d.byStage.filter((x) => x.category === "open");
  const maxStage = Math.max(1, ...openStages.map((x) => x.n));

  return (
    <>
      <PageHeader
        title={firm.tradingName}
        description="Pipeline and workload, from this firm's own records."
        actions={
          <>
            <nav aria-label="Period" className="flex rounded-md border border-hairline bg-surface p-0.5">
              {Object.entries(PERIODS).map(([k, label]) => (
                <Link key={k} href={`${base}?days=${k}`} aria-current={k === period ? "true" : undefined} className={`rounded px-2.5 py-1 text-[13px] ${k === period ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}>
                  {label}
                </Link>
              ))}
            </nav>
            {ctx.has("leads:create", firm.firmId) ? <Button asChild variant="primary"><Link href={`${base}/leads/new`}>New lead</Link></Button> : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-4">
        <Stat label="New leads" value={s.newLeads} note={PERIODS[period].toLowerCase()} href={`${base}/leads?sort=created`} />
        <Stat label="Open leads" value={s.openLeads} note={`${s.unassignedOpenLeads} unassigned`} href={`${base}/leads`} />
        <Stat label="Follow-ups overdue" value={s.overdueFollowUps} note="open leads past their date" href={`${base}/leads?followUp=overdue`} alert={s.overdueFollowUps > 0} />
        <Stat label="Active clients" value={s.activeClients} note={`${s.newClients} new, ${PERIODS[period].toLowerCase()}`} href={`${base}/clients`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Open pipeline" description="Leads in each open stage right now." />
          {s.openLeads === 0 ? (
            <EmptyState title="No open leads">Leads routed from the Hub or added by your team appear here.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2.5 p-4">
              {openStages.map((st) => (
                <li key={st.id}>
                  <Link href={`${base}/leads?stage=${st.id}`} className="group grid grid-cols-[minmax(140px,190px)_1fr_40px] items-center gap-3 text-[13px]">
                    <span className="truncate text-ink-2 group-hover:text-ink">{st.name}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-sunken">
                      <span className="block h-full rounded-full bg-firm" style={{ width: `${(st.n / maxStage) * 100}%`, opacity: st.n ? 1 : 0 }} />
                    </span>
                    <span className="num text-right text-ink">{st.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Due and overdue follow-ups" description="Up to the end of tomorrow." />
          {d.followUps.length === 0 ? (
            <EmptyState title="Nothing due">Follow-up dates you set on leads show up here.</EmptyState>
          ) : (
            <ul className="divide-y divide-hairline">
              {d.followUps.map((l) => {
                const overdue = l.followUpAt && new Date(l.followUpAt) < new Date();
                return (
                  <li key={l.id}>
                    <Link href={`${base}/leads/${l.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] hover:bg-sunken/50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{fullName(l.firstName, l.lastName)}</span>
                        <span className="num block text-xs text-muted">{l.ref}{l.assignee ? `, ${l.assignee}` : ", unassigned"}</span>
                      </span>
                      <span className={`shrink-0 text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}><LocalTime value={l.followUpAt} mode="relative" /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-5">
        <PanelHeader title="Workload" description="Open leads per person." />
        {d.workload.length === 0 ? (
          <EmptyState title="No one has open leads assigned">Assign leads from the Leads page.</EmptyState>
        ) : (
          <ul className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
            {d.workload.map((w) => (
              <li key={w.userId} className="flex items-center justify-between bg-surface px-4 py-3 text-[13px]">
                <Link href={`${base}/leads?assignee=${w.userId}`} className="truncate text-ink hover:underline">{w.name}</Link>
                <span className="num text-ink-2">
                  {w.open} open{w.overdue ? <span className="text-danger">, {w.overdue} overdue</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Stat({ label, value, note, href, alert }: { label: string; value: number; note: string; href: string; alert?: boolean }) {
  return (
    <Link href={href} className="block bg-surface px-4 py-4 hover:bg-sunken/40">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`num mt-1 text-[28px] leading-none font-semibold tracking-[-0.02em] ${alert ? "text-danger" : "text-ink"}`}>{value.toLocaleString("en-ZA")}</p>
      <p className="mt-1.5 text-xs text-muted">{note}</p>
    </Link>
  );
}

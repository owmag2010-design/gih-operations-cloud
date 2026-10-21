import type { Metadata } from "next";
import { daysAgo } from "@/lib/time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FirmSwatch } from "@/components/shell/client";
import { LocalTime } from "@/components/ui/forms";
import { Button, EmptyState, Notice, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { SOURCE_LABELS } from "@/lib/labels";
import { groupCommandCentre } from "@/server/modules/metrics/metrics";
import { requireStaff } from "@/server/next/session";
import { CommandCentreFilters } from "./filters";

export const metadata: Metadata = { title: "Command Centre" };

const PERIODS: Record<string, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", "365": "Last 12 months" };

const NOT_RELEASED = [
  ["Pending proposals", 2],
  ["Open cases", 3],
  ["Upcoming deadlines", 3],
  ["Outstanding document requests", 4],
  ["Revenue and outstanding invoices", 6],
] as const;

export default async function CommandCentrePage({ searchParams }: PageProps<"/hq">) {
  const { ctx } = await requireStaff();
  if (!ctx.has("metrics:group")) {
    if (ctx.has("intake:view")) {
      const { redirect } = await import("next/navigation");
      redirect("/hq/intake");
    }
    notFound();
  }
  const sp = await searchParams;
  const period = typeof sp.days === "string" && sp.days in PERIODS ? sp.days : "30";
  const firmId = typeof sp.firm === "string" ? sp.firm : undefined;
  const since = daysAgo(Number(period));
  const d = await groupCommandCentre(ctx, { since, firmId });
  const totals = d.totals;
  const periodLabel = PERIODS[period].toLowerCase();
  const sources = Object.entries(d.bySource).sort((a, b) => b[1] - a[1]);
  const sourceTotal = sources.reduce((a, [, n]) => a + n, 0);

  return (
    <>
      <PageHeader
        title="Command Centre"
        description="Counts across the partner firms that share them with the Hub. Firm records stay with each firm."
        actions={<CommandCentreFilters firms={d.visibleFirms} period={period} firmId={firmId ?? ""} periods={PERIODS} />}
      />

      {d.withheldFirms.length ? (
        <Notice className="mb-4">Not shared with the Hub: {d.withheldFirms.join(", ")}. Those firms&apos; numbers are left out, not counted as zero.</Notice>
      ) : null}

      {d.intake ? (
        <Link href="/hq/intake" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface px-4 py-3.5 hover:border-hairline-strong">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[13px] text-muted">Hub enquiries waiting</p>
              <p className={`num text-[28px] leading-none font-semibold tracking-[-0.02em] ${d.intake.new + d.intake.held > 0 ? "text-ink" : "text-muted"}`}>{d.intake.new + d.intake.held}</p>
            </div>
            <p className="text-[13px] text-ink-2">
              {d.intake.new} ready to route, {d.intake.held} held for review
              {d.intake.oldestWaitingAt ? <><br /><span className="text-muted">Oldest received <LocalTime value={d.intake.oldestWaitingAt} mode="relative" /></span></> : null}
            </p>
          </div>
          <span className="text-[13px] text-muted">{d.intake.receivedSince} received, {periodLabel}</span>
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active firms" value={d.activeFirms} note={`${d.perFirm.length} shown`} />
        <Stat label="New leads" value={totals.newLeads} note={periodLabel} />
        <Stat label="Open leads" value={totals.openLeads} note={`${totals.unassignedOpenLeads} unassigned`} />
        <Stat label="Overdue follow-ups" value={totals.overdueFollowUps} note="open leads" alert={totals.overdueFollowUps > 0} />
        <Stat label="Converted to clients" value={totals.wonLeads} note={periodLabel} />
        <Stat label="Active clients" value={totals.activeClients} note={`${totals.newClients} new, ${periodLabel}`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel>
          <PanelHeader title="By firm" />
          {d.perFirm.length === 0 ? (
            <EmptyState title="No firm shares its numbers with the Hub" />
          ) : (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th className={t.th}>Firm</th>
                    <th className={`${t.th} text-right`}>New leads</th>
                    <th className={`${t.th} text-right`}>Open</th>
                    <th className={`${t.th} text-right`}>Unassigned</th>
                    <th className={`${t.th} text-right`}>Overdue</th>
                    <th className={`${t.th} text-right`}>Active clients</th>
                  </tr>
                </thead>
                <tbody>
                  {d.perFirm.map((f) => {
                    const member = ctx.firms.get(f.firmId);
                    return (
                      <tr key={f.firmId} className={t.row}>
                        <td className={t.td}>
                          <span className="flex items-center gap-2">
                            <FirmSwatch color={f.brandColor} label={f.firmName} small />
                            {member ? <Link href={`/f/${member.slug}`} className="font-medium text-ink hover:underline">{f.firmName}</Link> : <span className="font-medium text-ink">{f.firmName}</span>}
                          </span>
                        </td>
                        <td className={`${t.td} num text-right`}>{f.newLeads}</td>
                        <td className={`${t.td} num text-right`}>{f.openLeads}</td>
                        <td className={`${t.td} num text-right ${f.unassignedOpenLeads ? "text-warn" : ""}`}>{f.unassignedOpenLeads}</td>
                        <td className={`${t.td} num text-right ${f.overdueFollowUps ? "font-medium text-danger" : ""}`}>{f.overdueFollowUps}</td>
                        <td className={`${t.td} num text-right`}>{f.activeClients}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Where new leads came from" description={periodLabel} />
          {sources.length === 0 ? (
            <EmptyState title="No new leads in this period" />
          ) : (
            <ul className="flex flex-col gap-2.5 p-4">
              {sources.map(([src, n]) => (
                <li key={src} className="grid grid-cols-[130px_1fr_36px] items-center gap-3 text-[13px]">
                  <span className="truncate text-ink-2">{SOURCE_LABELS[src] ?? src}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-accent" style={{ width: `${(n / sourceTotal) * 100}%` }} /></span>
                  <span className="num text-right text-ink">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel>
          <PanelHeader title="Workload" description="Open leads per person, for firms you belong to." />
          {d.workload.length === 0 ? (
            d.workloadAvailable ? (
              <EmptyState title="No open leads are assigned yet">Assign leads in each firm&apos;s Leads page to see who is carrying what.</EmptyState>
            ) : (
              <EmptyState title="Nothing to show">Workload appears for firms where you hold a membership with dashboard access.</EmptyState>
            )
          ) : (
            <ul className="grid gap-px bg-hairline sm:grid-cols-2">
              {d.workload.map((w) => (
                <li key={w.userId} className="flex items-center justify-between bg-surface px-4 py-3 text-[13px]">
                  <span className="truncate text-ink">{w.name}</span>
                  <span className="num text-ink-2">{w.open} open{w.overdue ? <span className="text-danger">, {w.overdue} overdue</span> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Coming with later releases" description="Shown here once the modules exist, from real records only." />
          <ul className="divide-y divide-hairline">
            {NOT_RELEASED.map(([label, r]) => (
              <li key={label} className="flex items-center justify-between px-4 py-2.5 text-[13px] text-muted">
                <span>{label}</span><span className="text-xs">Release {r}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {ctx.has("intake:create") ? <div className="mt-5"><Button asChild><Link href="/hq/intake/new">Capture an enquiry</Link></Button></div> : null}
    </>
  );
}

function Stat({ label, value, note, alert }: { label: string; value: number; note: string; alert?: boolean }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`num mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] ${alert ? "text-danger" : "text-ink"}`}>{value.toLocaleString("en-ZA")}</p>
      <p className="mt-1.5 text-xs text-muted">{note}</p>
    </div>
  );
}

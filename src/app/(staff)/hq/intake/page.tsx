import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, EmptyState, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { FLAG_LABELS, fullName, INTAKE_STATUS_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { listIntake } from "@/server/modules/intake/intake";
import { listFirms } from "@/server/modules/org/firms";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Hub intake" };

const TABS = [["open", "Waiting"], ["routed", "Routed"], ["rejected", "Closed"], ["all", "All"]] as const;

export default async function IntakePage({ searchParams }: PageProps<"/hq/intake">) {
  const { ctx } = await requireStaff();
  if (!ctx.has("intake:view")) notFound();
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "open") as (typeof TABS)[number][0];
  const [{ rows, counts }, firms] = await Promise.all([listIntake(ctx, tab), listFirms(ctx)]);
  const firmName = (id: string | null) => firms.find((f) => f.id === id)?.tradingName ?? null;
  const waiting = (counts.new ?? 0) + (counts.held ?? 0);

  return (
    <>
      <PageHeader
        title="Hub intake"
        description="Every enquiry to Global Immigration Hub lands here first. Check the suggested firm and route it; the firm's team takes it from there."
        actions={ctx.has("intake:create") ? <Button asChild variant="primary"><Link href="/hq/intake/new">Capture an enquiry</Link></Button> : null}
      />
      <nav aria-label="Intake status" className="mb-3 flex gap-1 border-b border-hairline">
        {TABS.map(([k, label]) => {
          const n = k === "open" ? waiting : k === "routed" ? counts.routed ?? 0 : k === "rejected" ? (counts.rejected ?? 0) + (counts.duplicate ?? 0) : undefined;
          return (
            <Link key={k} href={k === "open" ? "/hq/intake" : `/hq/intake?tab=${k}`} aria-current={tab === k ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {label}{n !== undefined ? <span className="num ml-1.5 text-muted">{n}</span> : null}
            </Link>
          );
        })}
      </nav>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title={tab === "open" ? "Nothing waiting" : "No enquiries here"}>
            {tab === "open" ? "New enquiries from the website form, WhatsApp and staff appear here as they arrive." : null}
          </EmptyState>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Person</th><th className={t.th}>Enquiry</th><th className={t.th}>{tab === "routed" ? "Routed to" : "Suggested firm"}</th><th className={t.th}>Status</th><th className={t.th}>Received</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={t.row}>
                    <td className={t.td}>
                      <Link href={`/hq/intake/${i.id}`} className="font-medium text-ink hover:underline">{fullName(i.firstName, i.lastName)}</Link>
                      <div className="text-xs text-muted">{[SOURCE_LABELS[i.source], i.currentCountry ? `in ${countryName(i.currentCountry)}` : null].filter(Boolean).join(", ")}</div>
                    </td>
                    <td className={`${t.td} max-w-[360px]`}>
                      <div className="truncate text-ink-2">{i.immigrationCategory ? <span className="text-ink">{i.immigrationCategory}: </span> : null}{i.enquiry ?? "No details"}</div>
                      {i.flags.length ? <div className="mt-1 flex flex-wrap gap-1">{i.flags.map((f) => <Badge key={f} tone={f === "possible_duplicate" || f === "needs_information" ? "warn" : "accent"}>{FLAG_LABELS[f] ?? f}</Badge>)}</div> : null}
                    </td>
                    <td className={t.td}>{(tab === "routed" ? firmName(i.routedFirmId) : firmName(i.suggestedFirmId)) ?? <span className="text-muted">Needs a person</span>}</td>
                    <td className={t.td}><Badge tone={i.status === "new" ? "accent" : i.status === "held" ? "warn" : i.status === "routed" ? "ok" : "outline"}>{INTAKE_STATUS_LABELS[i.status]}</Badge></td>
                    <td className={`${t.td} whitespace-nowrap text-ink-2`}><LocalTime value={i.receivedAt} mode="relative" /></td>
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

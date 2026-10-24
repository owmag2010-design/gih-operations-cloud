import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState, Input, Label, Notice, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { stripeConfigured, stripeMode } from "@/server/integrations/stripe";
import { canViewFinance, financeSummary } from "@/server/modules/finance/finance";
import { isIsoDate } from "@/server/modules/matters/dates";
import { requireFirm } from "@/server/next/session";
import { FinanceTabs } from "./tabs";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceOverview({ params, searchParams }: PageProps<"/f/[firmSlug]/finance">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewFinance(ctx, firm.firmId)) notFound();
  const sp = await searchParams;
  const now = new Date().toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && isIsoDate(sp.from) ? sp.from : `${now.slice(0, 8)}01`;
  const to = typeof sp.to === "string" && isIsoDate(sp.to) && sp.to >= from ? sp.to : now;
  const s = await financeSummary(ctx, firm.firmId, { from, to });
  const base = `/f/${firm.slug}/finance`;
  const mode = stripeMode();
  return (
    <>
      <PageHeader
        title="Proposals & Finance"
        description={`Invoices, payments and what is outstanding for ${firm.tradingName}. An operational view only: the practice's books stay in its accounting package.`}
        actions={ctx.has("invoices:edit", firm.firmId) ? <Button asChild variant="primary"><Link href={`${base}/invoices/new`}>New invoice</Link></Button> : null}
      />
      <FinanceTabs slug={firm.slug} current="overview" showSettings={ctx.has("invoices:view", firm.firmId)} />

      <div className="mb-4 flex flex-col gap-2">
        {s.pendingPayments ? (
          <Notice tone="warn">
            {s.pendingPayments} recorded payment{s.pendingPayments === 1 ? " is" : "s are"} waiting to be checked against the bank statement. They don&apos;t count towards any invoice until verified. <Link href={`${base}/payments`} className="font-medium underline">Review payments</Link>
          </Notice>
        ) : null}
        {!stripeConfigured() ? (
          <Notice>Card payments aren&apos;t connected. Add the Stripe keys in the hosting settings to create payment links; bank transfers can be recorded meanwhile.</Notice>
        ) : mode === "test" ? (
          <Notice>Stripe is in test mode: payment links take test cards only.</Notice>
        ) : null}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" aria-label="Report period">
        <div className="flex flex-col gap-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} className="w-40" /></div>
        <div className="flex flex-col gap-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} className="w-40" /></div>
        <Button type="submit" variant="secondary">Show period</Button>
      </form>

      {s.byCurrency.length === 0 ? (
        <Panel><EmptyState title="Nothing billed yet">Issued invoices and verified payments appear here, per currency.</EmptyState></Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {s.byCurrency.map((c) => (
            <Panel key={c.currency}>
              <PanelHeader title={c.currency} description={`Billed and received between ${from} and ${to}. Outstanding is as of today.`} />
              <dl className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4">
                {[
                  ["Billed", formatMoney(c.billed, c.currency), `${c.billedCount} invoice${c.billedCount === 1 ? "" : "s"}`],
                  ["Received", formatMoney(c.received, c.currency), `${c.receivedCount} verified payment${c.receivedCount === 1 ? "" : "s"}`],
                  ["Outstanding", formatMoney(c.outstanding, c.currency), `${c.openCount} open invoice${c.openCount === 1 ? "" : "s"}`],
                  ["Overdue", formatMoney(c.overdue, c.currency), "Past the due date"],
                ].map(([k, v, h]) => (
                  <div key={k} className="bg-paper p-4">
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="num mt-1 text-xl font-semibold text-ink">{v}</dd>
                    <dd className="text-xs text-muted">{h}</dd>
                  </div>
                ))}
              </dl>
              <div className={t.wrap}>
                <table className={t.table}>
                  <caption className="sr-only">Ageing of outstanding {c.currency} invoices</caption>
                  <thead><tr><th className={t.th}>Ageing</th><th className={`${t.th} text-right`}>Not yet due</th><th className={`${t.th} text-right`}>1–30 days</th><th className={`${t.th} text-right`}>31–60 days</th><th className={`${t.th} text-right`}>Over 60 days</th></tr></thead>
                  <tbody>
                    <tr className={t.row}>
                      <td className={t.td}>Outstanding</td>
                      {[c.ageing.current, c.ageing.d30, c.ageing.d60, c.ageing.d90].map((v, i) => <td key={i} className={`${t.td} num text-right`}>{formatMoney(v, c.currency)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Amounts are kept per currency and never converted. This is not an accounting or trust-accounting record.</p>
    </>
  );
}

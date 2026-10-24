import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Panel, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { canViewFinance, financeSummary } from "@/server/modules/finance/finance";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Finance" };

/** Practice summaries side by side for people who work in more than one practice. Each practice remains its own entity; currencies are never combined. */
export default async function PracticeFinancePage() {
  const { ctx } = await requireStaff();
  const practices = [...ctx.firms.values()].filter((f) => canViewFinance(ctx, f.firmId)).sort((a, b) => a.tradingName.localeCompare(b.tradingName));
  if (!practices.length) notFound();
  const now = new Date().toISOString().slice(0, 10);
  const from = `${now.slice(0, 8)}01`;
  const rows = await Promise.all(practices.map(async (f) => ({ f, s: await financeSummary(ctx, f.firmId, { from, to: now }) })));
  return (
    <>
      <PageHeader title="Proposals & Finance" description="This month's billing and what is outstanding, per practice. Each practice invoices as its own entity; open a practice to work on its invoices." />
      <Panel>
        <div className={t.wrap}>
          <table className={t.table}>
            <thead><tr><th className={t.th}>Practice</th><th className={t.th}>Currency</th><th className={`${t.th} text-right`}>Billed this month</th><th className={`${t.th} text-right`}>Received this month</th><th className={`${t.th} text-right`}>Outstanding</th><th className={`${t.th} text-right`}>Overdue</th><th className={`${t.th} text-right`}>To verify</th></tr></thead>
            <tbody>
              {rows.flatMap(({ f, s }) =>
                (s.byCurrency.length ? s.byCurrency : [null]).map((c, i) => (
                  <tr key={`${f.firmId}-${c?.currency ?? "none"}`} className={t.row}>
                    <td className={t.td}>{i === 0 ? <Link href={`/f/${f.slug}/finance`} className="font-medium underline-offset-2 hover:underline">{f.tradingName}</Link> : null}</td>
                    {c ? (
                      <>
                        <td className={`${t.td} num`}>{c.currency}</td>
                        <td className={`${t.td} num text-right`}>{formatMoney(c.billed, c.currency)}</td>
                        <td className={`${t.td} num text-right`}>{formatMoney(c.received, c.currency)}</td>
                        <td className={`${t.td} num text-right`}>{formatMoney(c.outstanding, c.currency)}</td>
                        <td className={`${t.td} num text-right`}>{formatMoney(c.overdue, c.currency)}</td>
                      </>
                    ) : (
                      <td className={`${t.td} text-muted`} colSpan={5}>No invoices yet</td>
                    )}
                    <td className={`${t.td} num text-right`}>{i === 0 ? s.pendingPayments : null}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        {!rows.length ? <EmptyState title="No practices" /> : null}
      </Panel>
      <p className="mt-3 text-xs text-muted">An operational view, not accounting or trust-accounting records.</p>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { canViewFinance, getBilling, invoiceFormOptions, listInvoices, reconciliationQueue } from "@/server/modules/finance/finance";
import { requireFirm } from "@/server/next/session";
import { AllocateDialog, RecordPaymentDialog, RejectPaymentDialog, VerifyPaymentDialog } from "../client";
import { METHOD } from "../labels";
import { FinanceTabs } from "../tabs";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ params }: PageProps<"/f/[firmSlug]/finance/payments">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewFinance(ctx, firm.firmId)) notFound();
  const canVerify = ctx.has("payments:verify", firm.firmId);
  const [queue, open, billing, options] = await Promise.all([
    reconciliationQueue(ctx, firm.firmId),
    listInvoices(ctx, firm.firmId, { status: "open" }),
    getBilling(ctx, firm.firmId),
    canVerify && ctx.has("invoices:edit", firm.firmId) ? invoiceFormOptions(ctx, firm.firmId) : Promise.resolve(null),
  ]);
  const pending = queue.filter((p) => p.status === "pending");
  const unallocated = queue.filter((p) => p.status === "verified" && !p.invoiceId);
  const base = `/f/${firm.slug}`;
  const isAdmin = ctx.has("firm:manage", firm.firmId);
  const invoicesFor = (p: { currency: string; clientId: string | null }) =>
    open.rows.filter((i) => i.currency === p.currency && (!p.clientId || i.clientId === p.clientId)).map((i) => ({ id: i.id, label: `${i.number} · ${i.billToName} · ${formatMoney(i.totalMinor - i.paidMinor - i.creditedMinor, i.currency)} due` }));

  const table = (rows: typeof queue, kind: "pending" | "unallocated") => (
    <div className={t.wrap}>
      <table className={t.table}>
        <thead><tr><th className={t.th}>Received</th><th className={t.th}>From</th><th className={t.th}>Method and reference</th><th className={t.th}>Invoice</th><th className={`${t.th} text-right`}>Amount</th><th className={t.th}><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={t.row}>
              <td className={`${t.td} num`}>{p.receivedOn}</td>
              <td className={t.td}>{p.clientName ?? <span className="text-muted">Not known</span>}</td>
              <td className={t.td}>{METHOD[p.method] ?? p.method} · <span className="num">{p.reference}</span>{p.recordedBy ? <div className="text-xs text-muted">Recorded by {p.recordedBy}</div> : null}{p.note && kind === "unallocated" ? <div className="text-xs text-muted">{p.note}</div> : null}</td>
              <td className={t.td}>{p.invoiceId ? <Link href={`${base}/finance/invoices/${p.invoiceId}`} className="num underline-offset-2 hover:underline">{p.invoiceNumber}</Link> : <Badge tone="warn">Unallocated</Badge>}</td>
              <td className={`${t.td} num text-right`}>{formatMoney(p.amountMinor, p.currency)}</td>
              <td className={`${t.td} text-right`}>
                {canVerify ? (
                  <span className="inline-flex flex-wrap justify-end gap-1.5">
                    {kind === "pending" ? (
                      <>
                        {p.recordedById !== ctx.user.id || isAdmin ? <VerifyPaymentDialog slug={firm.slug} paymentId={p.id} summary={`${formatMoney(p.amountMinor, p.currency)} received ${p.receivedOn}, reference ${p.reference}.`} /> : <span className="self-center text-xs text-muted">Another person verifies</span>}
                        <RejectPaymentDialog slug={firm.slug} paymentId={p.id} />
                      </>
                    ) : null}
                    {!p.invoiceId ? <AllocateDialog slug={firm.slug} paymentId={p.id} invoices={invoicesFor(p)} /> : null}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money recorded by hand is checked against the bank statement by a second person before it counts. Stripe payments arrive verified."
        actions={canVerify ? <RecordPaymentDialog slug={firm.slug} currency={billing.defaultCurrency} clients={options?.clients.map((c) => ({ id: c.id, label: `${[c.firstName, c.lastName].filter(Boolean).join(" ")} (${c.ref})` }))} /> : null}
      />
      <FinanceTabs slug={firm.slug} current="payments" showSettings />
      <div className="flex flex-col gap-4">
        <Panel>
          <PanelHeader title="Awaiting verification" description="Check each one against the statement line before verifying." />
          {pending.length ? table(pending, "pending") : <EmptyState title="Nothing to verify" />}
        </Panel>
        <Panel>
          <PanelHeader title="Verified but not allocated" description="Money that arrived without matching an invoice, for example a Stripe payment on an old link." />
          {unallocated.length ? table(unallocated, "unallocated") : <EmptyState title="Everything is allocated" />}
        </Panel>
      </div>
    </>
  );
}

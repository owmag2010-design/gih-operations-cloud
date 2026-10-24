import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, EmptyState, Facts, Notice, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { stripeConfigured } from "@/server/integrations/stripe";
import { canViewFinance, getInvoice } from "@/server/modules/finance/finance";
import { requireFirm } from "@/server/next/session";
import { CreditDialog, DraftEditor, IssueDialog, PaymentLinkButton, RecordPaymentDialog, RejectPaymentDialog, VerifyPaymentDialog, VoidDialog } from "../../client";
import { INVOICE_STATUS, LINE_KIND, METHOD, PAYMENT_STATUS } from "../../labels";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/f/[firmSlug]/finance/invoices/[invoiceId]">) {
  const { firmSlug, invoiceId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewFinance(ctx, firm.firmId)) notFound();
  let d: Awaited<ReturnType<typeof getInvoice>>;
  try {
    d = await getInvoice(ctx, firm.firmId, invoiceId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { invoice: inv, lines, payments, credits, client, matter, proposal, billing } = d;
  const base = `/f/${firm.slug}`;
  const st = INVOICE_STATUS[inv.display] ?? INVOICE_STATUS.draft;
  const isDraft = inv.status === "draft";
  const open = inv.status === "issued" || inv.status === "partially_paid";
  const canEdit = ctx.has("invoices:edit", firm.firmId);
  const canIssue = ctx.has("invoices:issue", firm.firmId);
  const canVerify = ctx.has("payments:verify", firm.firmId);
  const money = (m: number) => formatMoney(m, inv.currency);
  const clientName = client ? [client.firstName, client.lastName].filter(Boolean).join(" ") : inv.billToName;

  return (
    <>
      <p className="mb-2 text-[13px]"><Link href={`${base}/finance/invoices`} className="text-muted hover:text-ink">← Invoices</Link></p>
      <PageHeader
        title={<span className="num">{inv.number ?? "Draft invoice"}</span>}
        meta={<Badge tone={st.tone}>{st.label}</Badge>}
        description={`${inv.billToName} · ${money(inv.totalMinor)}${open ? ` · ${money(inv.balanceMinor)} outstanding` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild><a href={`${base}/finance/invoices/${inv.id}/pdf`} target="_blank" rel="noopener">{isDraft ? "Preview PDF" : "Download PDF"}</a></Button>
            {isDraft && canIssue ? <IssueDialog slug={firm.slug} id={inv.id} termsDays={billing.paymentTermsDays} /> : null}
            {open && canVerify ? <RecordPaymentDialog slug={firm.slug} invoiceId={inv.id} currency={inv.currency} balance={inv.balanceMinor} /> : null}
            {open && canIssue ? <CreditDialog slug={firm.slug} id={inv.id} balance={inv.balanceMinor} currency={inv.currency} /> : null}
            {(isDraft ? canEdit && canIssue : open && canIssue && inv.paidMinor === 0) ? <VoidDialog slug={firm.slug} id={inv.id} isDraft={isDraft} /> : null}
          </div>
        }
      />

      {inv.status === "void" ? <Notice className="mb-4">Voided{inv.voidedAt ? <> on <LocalTime value={inv.voidedAt} mode="date" /></> : null}: {inv.voidReason}</Notice> : null}
      {isDraft && !canIssue ? <Notice className="mb-4">A finance officer or practice administrator issues this invoice when it is ready.</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          {isDraft && canEdit ? (
            <Panel className="p-5">
              <DraftEditor
                slug={firm.slug}
                id={inv.id}
                currency={inv.currency}
                taxRateBp={billing.taxRateBp}
                taxLabel={billing.taxLabel}
                fields={{ billToName: inv.billToName, billToEmail: inv.billToEmail ?? "", billToAddress: inv.billToAddress ?? "", reference: inv.reference ?? "", terms: inv.terms ?? "", notes: inv.notes ?? "" }}
                lines={lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, taxable: l.taxable }))}
              />
            </Panel>
          ) : (
            <Panel>
              <PanelHeader title="Lines" />
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead><tr><th className={t.th}>Description</th><th className={t.th}>Type</th><th className={`${t.th} text-right`}>Qty</th><th className={`${t.th} text-right`}>Unit</th><th className={`${t.th} text-right`}>Amount</th></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className={t.row}>
                        <td className={t.td}>{l.description}</td>
                        <td className={`${t.td} text-ink-2`}>{LINE_KIND[l.kind] ?? l.kind}{l.taxable ? "" : l.kind === "discount" ? "" : " · no tax"}</td>
                        <td className={`${t.td} num text-right`}>{l.quantity}</td>
                        <td className={`${t.td} num text-right`}>{money(l.unitMinor)}</td>
                        <td className={`${t.td} num text-right`}>{money(l.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4} className={`${t.td} text-right text-muted`}>Subtotal</td><td className={`${t.td} num text-right`}>{money(inv.subtotalMinor)}</td></tr>
                    {inv.discountMinor ? <tr><td colSpan={4} className={`${t.td} text-right text-muted`}>Discount</td><td className={`${t.td} num text-right`}>−{money(inv.discountMinor)}</td></tr> : null}
                    {inv.taxRateBp ? <tr><td colSpan={4} className={`${t.td} text-right text-muted`}>{billing.taxLabel ?? "VAT"} at {inv.taxRateBp / 100}%</td><td className={`${t.td} num text-right`}>{money(inv.taxMinor)}</td></tr> : null}
                    <tr><td colSpan={4} className={`${t.td} text-right font-semibold`}>Total</td><td className={`${t.td} num text-right font-semibold`}>{money(inv.totalMinor)}</td></tr>
                  </tfoot>
                </table>
              </div>
            </Panel>
          )}

          {!isDraft ? (
            <Panel>
              <PanelHeader title="Payments" description="Only verified payments reduce the balance. Stripe payments are verified by their signed confirmation." />
              {payments.length === 0 ? (
                <EmptyState title="No payments yet" />
              ) : (
                <div className={t.wrap}>
                  <table className={t.table}>
                    <thead><tr><th className={t.th}>Received</th><th className={t.th}>Method</th><th className={t.th}>Reference</th><th className={t.th}>Status</th><th className={`${t.th} text-right`}>Amount</th><th className={t.th}><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {payments.map((p) => {
                        const ps = PAYMENT_STATUS[p.status];
                        return (
                          <tr key={p.id} className={t.row}>
                            <td className={`${t.td} num`}>{p.receivedOn}</td>
                            <td className={t.td}>{METHOD[p.method] ?? p.method}</td>
                            <td className={t.td}>
                              <span className="num">{p.reference}</span>
                              <div className="text-xs text-muted">{p.recordedBy ? `Recorded by ${p.recordedBy}` : null}{p.verifiedByName ? ` · verified by ${p.verifiedByName}` : p.verifiedBy ? ` · ${p.verifiedBy}` : null}</div>
                            </td>
                            <td className={t.td}><Badge tone={ps.tone}>{ps.label}</Badge></td>
                            <td className={`${t.td} num text-right`}>{formatMoney(p.amountMinor, p.currency)}</td>
                            <td className={`${t.td} text-right`}>
                              {p.status === "pending" && canVerify ? (
                                <span className="inline-flex gap-1.5">
                                  {p.recordedById !== ctx.user.id || ctx.has("firm:manage", firm.firmId) ? <VerifyPaymentDialog slug={firm.slug} paymentId={p.id} summary={`${formatMoney(p.amountMinor, p.currency)} received ${p.receivedOn}, reference ${p.reference}.`} /> : <span className="text-xs text-muted">Another person verifies</span>}
                                  <RejectPaymentDialog slug={firm.slug} paymentId={p.id} />
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}

          {credits.length ? (
            <Panel>
              <PanelHeader title="Credit notes" />
              <div className={t.wrap}>
                <table className={t.table}>
                  <thead><tr><th className={t.th}>Number</th><th className={t.th}>Reason</th><th className={t.th}>Issued</th><th className={`${t.th} text-right`}>Amount</th></tr></thead>
                  <tbody>
                    {credits.map((c) => (
                      <tr key={c.id} className={t.row}>
                        <td className={`${t.td} num`}>{c.number}</td>
                        <td className={t.td}>{c.reason}</td>
                        <td className={t.td}><LocalTime value={c.issuedAt} mode="date" /></td>
                        <td className={`${t.td} num text-right`}>{money(c.amountMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <Panel className="p-4">
            <Facts
              items={[
                ["Client", client ? <Link href={`${base}/clients/${client.id}`} className="underline-offset-2 hover:underline">{clientName} <span className="num text-muted">({client.ref})</span></Link> : inv.billToName],
                ["Matter", matter ? <Link href={`${base}/matters/${matter.id}`} className="underline-offset-2 hover:underline"><span className="num">{matter.ref}</span> {matter.title}</Link> : null],
                ["Proposal", proposal ? <Link href={`${base}/proposals/${proposal.id}`} className="num underline-offset-2 hover:underline">{proposal.ref}</Link> : null],
                ["Issued", inv.issueDate ?? (isDraft ? "Not yet" : null)],
                ["Due", inv.dueDate ?? (isDraft ? "Set on issue" : null)],
                ["Total", <span key="t" className="num">{money(inv.totalMinor)}</span>],
                ["Paid", <span key="p" className="num">{money(inv.paidMinor)}</span>],
                ...(inv.creditedMinor ? ([["Credited", <span key="c" className="num">{money(inv.creditedMinor)}</span>]] as [string, React.ReactNode][]) : []),
                ["Balance", <span key="b" className="num font-semibold">{inv.status === "void" ? "—" : money(inv.balanceMinor)}</span>],
              ]}
            />
          </Panel>
          {open && canIssue ? (
            <Panel className="p-4">
              <h2 className="mb-1 text-[13px] font-semibold text-ink">Card payment</h2>
              {stripeConfigured() ? (
                <>
                  <p className="mb-3 text-xs text-muted">A Stripe Checkout link for the outstanding balance. The invoice is marked paid only when Stripe&apos;s signed confirmation arrives.</p>
                  <PaymentLinkButton slug={firm.slug} id={inv.id} existing={inv.checkoutUrl} />
                </>
              ) : (
                <p className="text-xs text-muted">Stripe isn&apos;t connected yet, so card links aren&apos;t available. Record bank transfers with Record payment.</p>
              )}
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}

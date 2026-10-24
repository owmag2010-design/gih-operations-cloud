import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, EmptyState, Input, PageHeader, Panel, cn, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { canViewFinance, listInvoices } from "@/server/modules/finance/finance";
import { requireFirm } from "@/server/next/session";
import { INVOICE_STATUS } from "../labels";
import { FinanceTabs } from "../tabs";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS = [
  { key: "all", label: "All" }, { key: "draft", label: "Drafts" }, { key: "open", label: "Open" }, { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" }, { key: "credited", label: "Credited" }, { key: "void", label: "Void" },
];

export default async function InvoicesPage({ params, searchParams }: PageProps<"/f/[firmSlug]/finance/invoices">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!canViewFinance(ctx, firm.firmId)) notFound();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "all";
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Number(sp.page) || 1;
  const { rows, total, pageSize } = await listInvoices(ctx, firm.firmId, { status: status === "all" ? undefined : status, q, page });
  const base = `/f/${firm.slug}/finance`;
  const href = (o: Record<string, string | number>) => {
    const u = new URLSearchParams();
    const next = { status, q, ...o };
    if (next.status && next.status !== "all") u.set("status", String(next.status));
    if (next.q) u.set("q", String(next.q));
    if (o.page && Number(o.page) > 1) u.set("page", String(o.page));
    const s = u.toString();
    return `${base}/invoices${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Drafts can be changed freely. Issuing gives the invoice its number; after that it is corrected with a credit note, never edited."
        actions={ctx.has("invoices:edit", firm.firmId) ? <Button asChild variant="primary"><Link href={`${base}/invoices/new`}>New invoice</Link></Button> : null}
      />
      <FinanceTabs slug={firm.slug} current="invoices" showSettings />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 text-[13px]" aria-label="Filter invoices">
          {FILTERS.map((f) => (
            <Link key={f.key} href={href({ status: f.key, page: 1 })} aria-current={status === f.key ? "page" : undefined} className={cn("rounded-md px-2.5 py-1", status === f.key ? "bg-sky font-medium text-ink" : "text-muted hover:text-ink")}>{f.label}</Link>
          ))}
        </nav>
        <form className="flex gap-2" role="search">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="q" defaultValue={q} placeholder="Number, client or reference" aria-label="Search invoices" className="w-64" />
          <Button type="submit">Search</Button>
        </form>
      </div>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No invoices here">Create an invoice from an accepted proposal, or start one from scratch.</EmptyState>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Invoice</th><th className={t.th}>Bill to</th><th className={t.th}>Status</th><th className={t.th}>Due</th><th className={`${t.th} text-right`}>Total</th><th className={`${t.th} text-right`}>Balance</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = INVOICE_STATUS[r.display] ?? INVOICE_STATUS.draft;
                  const balance = Math.max(0, r.totalMinor - r.paidMinor - r.creditedMinor);
                  return (
                    <tr key={r.id} className={t.row}>
                      <td className={t.td}>
                        <Link href={`${base}/invoices/${r.id}`} className="num text-ink underline-offset-2 hover:underline">{r.number ?? "Draft"}</Link>
                        {r.reference ? <div className="text-xs text-muted">{r.reference}</div> : null}
                      </td>
                      <td className={t.td}>{r.billToName}<div className="num text-xs text-muted">{r.clientRef}{r.matterRef ? ` · ${r.matterRef}` : ""}</div></td>
                      <td className={t.td}><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className={`${t.td} num text-ink-2`}>{r.dueDate ?? "—"}</td>
                      <td className={`${t.td} num text-right`}>{formatMoney(r.totalMinor, r.currency)}</td>
                      <td className={`${t.td} num text-right`}>{r.status === "draft" || r.status === "void" ? "—" : formatMoney(balance, r.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {total > pageSize ? (
        <nav className="mt-3 flex items-center justify-between text-[13px] text-muted" aria-label="Pages">
          <span>{total} invoices</span>
          <span className="flex gap-2">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="underline">Previous</Link> : null}
            {page * pageSize < total ? <Link href={href({ page: page + 1 })} className="underline">Next</Link> : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}

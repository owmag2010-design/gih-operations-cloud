import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, PageHeader, Panel, cn, tableClass as t } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import { listProposals, statusLabel, type ProposalStatus } from "@/server/modules/proposals/proposals";
import { requireFirm } from "@/server/next/session";
import { PROPOSAL_TONE } from "./labels";

export const metadata: Metadata = { title: "Proposals" };

const TABS: { key: string; label: string }[] = [
  { key: "open", label: "Open" }, { key: "in_review", label: "In review" }, { key: "released", label: "Sent" }, { key: "accepted", label: "Accepted" }, { key: "declined", label: "Declined" }, { key: "expired", label: "Expired" }, { key: "all", label: "All" },
];

export default async function ProposalsPage({ params, searchParams }: PageProps<"/f/[firmSlug]/proposals">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  if (!ctx.has("proposals:view", firm.firmId)) notFound();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "open";
  const { rows, counts } = await listProposals(ctx, firm.firmId, { status: status === "all" ? undefined : status });
  const base = `/f/${firm.slug}`;
  return (
    <>
      <PageHeader title="Proposals" description="Start a proposal from a lead. It goes through review and approval before the client receives a secure link. Sent proposals expire at the end of their validity period." />
      <nav className="mb-3 flex flex-wrap gap-1 text-[13px]" aria-label="Filter proposals">
        {TABS.map((tab) => (
          <Link key={tab.key} href={tab.key === "open" ? `${base}/proposals` : `${base}/proposals?status=${tab.key}`} className={cn("rounded-md px-2.5 py-1", status === tab.key ? "bg-sky font-medium text-ink" : "text-muted hover:text-ink")}>
            {tab.label}{tab.key in counts ? <span className="num ml-1 text-xs text-muted">{counts[tab.key as ProposalStatus | "expired"]}</span> : null}
          </Link>
        ))}
      </nav>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No proposals here">Open a lead and choose <strong>Create proposal</strong>.</EmptyState>
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead><tr><th className={t.th}>Proposal</th><th className={t.th}>Client</th><th className={t.th}>Status</th><th className={`${t.th} text-right`}>Total</th><th className={t.th}>Owner</th><th className={t.th}>Updated</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={t.row}>
                    <td className={t.td}><Link href={`${base}/proposals/${r.id}`} className="text-ink underline-offset-2 hover:underline">{r.title}</Link><div className="num text-xs text-muted">{r.ref} · v{r.version}</div></td>
                    <td className={t.td}>{r.recipientName}<div className="num text-xs text-muted">{r.leadRef}</div></td>
                    <td className={t.td}>{r.expired ? <Badge tone="outline">Expired</Badge> : <Badge tone={PROPOSAL_TONE[r.status]}>{statusLabel(r.status)}</Badge>}</td>
                    <td className={`${t.td} num text-right`}>{formatMoney(r.totalMinor, r.currency)}</td>
                    <td className={`${t.td} text-ink-2`}>{r.ownerName ?? "—"}</td>
                    <td className={`${t.td} text-muted`}><LocalTime value={r.updatedAt} mode="relative" /></td>
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

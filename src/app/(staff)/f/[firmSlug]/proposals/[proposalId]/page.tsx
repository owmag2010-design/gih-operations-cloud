import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, Facts, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { formatMoney, fullName } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { getProposal, statusLabel } from "@/server/modules/proposals/proposals";
import { listCatalogue } from "@/server/modules/services/services";
import { requireFirm } from "@/server/next/session";
import { DetailsEditor, ItemsEditor, WorkflowBar } from "../client";
import { PROPOSAL_TONE } from "../labels";

export const metadata: Metadata = { title: "Proposal" };

const money = (m: number) => (m / 100).toFixed(m % 100 === 0 ? 0 : 2);

export default async function ProposalPage({ params }: PageProps<"/f/[firmSlug]/proposals/[proposalId]">) {
  const { firmSlug, proposalId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const view = await getProposal(ctx, firm.firmId, proposalId).catch((e) => (e instanceof NotFoundError ? notFound() : Promise.reject(e)));
  const { proposal: p, items, lead, versions } = view;
  const base = `/f/${firm.slug}`;
  const editable = ctx.has("proposals:edit", firm.firmId) && (p.status === "draft" || p.status === "changes_requested");
  const services = editable ? (await listCatalogue(ctx, firm.firmId, { activeOnly: true })).map((s) => ({ id: s.id, name: s.name, category: s.category, total: formatMoney(s.totalMinor, s.currency) })) : [];
  const released = versions.find((v) => v.version === p.version);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href={`${base}/proposals`} className="hover:text-ink">Proposals</Link> <span aria-hidden="true">/</span> <span className="num">{p.ref}</span>
      </nav>
      <PageHeader
        title={p.title}
        meta={<><Badge tone={PROPOSAL_TONE[p.status]}>{statusLabel(p.status)}</Badge><Badge tone="outline">Version {p.version}</Badge>{view.linkExpired ? <Badge tone="warn">Link expired</Badge> : null}</>}
        actions={
          <Button asChild>
            <a href={`${base}/proposals/${p.id}/pdf${released ? `?version=${p.version}` : ""}`} target="_blank" rel="noopener">{released ? "PDF sent to client" : "Preview PDF"}</a>
          </Button>
        }
      />
      {p.status === "changes_requested" && p.reviewNote ? <Notice tone="warn" className="mb-4"><strong>Changes requested:</strong> {p.reviewNote}</Notice> : null}
      {p.status === "accepted" ? <Notice tone="ok" className="mb-4">Accepted by {p.responseName} on <LocalTime value={p.respondedAt} />. {lead?.convertedClientId ? (ctx.has("matters:create", firm.firmId) ? <>Next: <Link className="underline" href={`${base}/matters/new?client=${lead.convertedClientId}&proposal=${p.id}`}>open the matter</Link>.</> : "The lead is already a client.") : <>Next: <Link className="underline" href={`${base}/leads/${lead?.id}`}>convert the lead to a client</Link> once the deposit is paid, then open the matter.</>}</Notice> : null}
      {p.status === "declined" ? <Notice tone="danger" className="mb-4">Declined by {p.responseName}{p.responseNote ? `: “${p.responseNote}”` : "."} You can start a new version.</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader title="Fees" description={editable ? "Prices start from the catalogue. Changing one here affects this proposal only." : undefined} />
            <ItemsEditor
              firmSlug={firm.slug}
              id={p.id}
              editable={editable}
              services={services}
              totals={{ total: formatMoney(p.totalMinor, p.currency), deposit: formatMoney(p.depositMinor, p.currency), balance: formatMoney(p.totalMinor - p.depositMinor, p.currency) }}
              items={items.map((i) => ({
                id: i.id, label: i.label, description: i.description, quantity: i.quantity, unit: money(i.unitMinor), deposit: money(i.depositMinor),
                total: formatMoney(i.unitMinor * i.quantity, p.currency), fromCatalogue: !!i.serviceId, lines: i.lines.map((l) => `${l.label} ${formatMoney(l.amountMinor, p.currency)}`),
              }))}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Content" description={editable ? "What the client reads. Written from your firm's template; edit freely." : "Locked while the proposal is in review or sent. Reopen it to edit."} />
            <DetailsEditor
              key={`${p.version}-${p.updatedAt.toISOString()}`}
              firmSlug={firm.slug}
              id={p.id}
              editable={editable}
              initial={{ title: p.title, recipientName: p.recipientName, recipientEmail: p.recipientEmail ?? "", validDays: p.validDays, currency: p.currency, sections: p.sections }}
            />
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Next step" />
            <div className="p-4">
              <WorkflowBar firmSlug={firm.slug} id={p.id} status={p.status} can={{ edit: ctx.has("proposals:edit", firm.firmId), approve: ctx.has("proposals:approve", firm.firmId), release: ctx.has("proposals:release", firm.firmId) }} />
              <ol className="mt-4 flex flex-col gap-1 text-xs text-muted">
                <li>1. Draft → <span className="text-ink-2">send for review</span></li>
                <li>2. Review → <span className="text-ink-2">approve or request changes</span></li>
                <li>3. Approved → <span className="text-ink-2">send to client (secure link)</span></li>
                <li>4. Client accepts or declines online</li>
              </ol>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Details" />
            <div className="p-4">
              <Facts items={[
                ["Lead", lead ? <Link key="l" href={`${base}/leads/${lead.id}`} className="num underline-offset-2 hover:underline">{lead.ref} · {fullName(lead.firstName, lead.lastName)}</Link> : "—"],
                ["Created by", view.createdBy ?? "—"],
                ["Approved by", view.approvedBy ? <>{view.approvedBy} · <LocalTime value={p.approvedAt} mode="date" /></> : "—"],
                ["Sent", p.releasedAt ? <><LocalTime value={p.releasedAt} /> by {view.releasedBy}</> : "Not yet"],
                ["Link valid until", p.linkExpiresAt ? <LocalTime value={p.linkExpiresAt} mode="date" /> : "—"],
                ["Client opened it", p.firstViewedAt ? <LocalTime value={p.firstViewedAt} /> : p.releasedAt ? "Not yet" : "—"],
              ]} />
            </div>
          </Panel>
          {versions.length ? (
            <Panel>
              <PanelHeader title="Versions sent" />
              <ul className="divide-y divide-hairline text-[13px]">
                {versions.map((v) => (
                  <li key={v.version} className="flex items-center justify-between px-4 py-2.5">
                    <span>Version {v.version} · <LocalTime value={v.createdAt} mode="date" /></span>
                    <a className="text-accent underline-offset-2 hover:underline" href={`${base}/proposals/${p.id}/pdf?version=${v.version}`} target="_blank" rel="noopener">PDF</a>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

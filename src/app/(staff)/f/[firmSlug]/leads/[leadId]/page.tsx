import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Button, Facts, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { fullName, PRIORITY_LABELS, PRIORITY_TONE, SOURCE_LABELS, STAGE_TONE } from "@/lib/labels";
import { NotFoundError } from "@/server/errors";
import { getLead, listStages } from "@/server/modules/crm/leads";
import { listTemplates } from "@/server/modules/email/mail";
import { ComposeDialog } from "@/components/email/client";
import { listProposals, statusLabel } from "@/server/modules/proposals/proposals";
import { listCatalogue } from "@/server/modules/services/services";
import { formatMoney } from "@/lib/labels";
import { CreateProposalDialog } from "../../proposals/client";
import { PROPOSAL_TONE } from "../../proposals/labels";
import { requireFirm } from "@/server/next/session";
import { Timeline } from "../../timeline";
import { ConsentDialog, ConvertButton, DuplicateList, NoteForm, StageSelect } from "./client";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params, searchParams }: PageProps<"/f/[firmSlug]/leads/[leadId]">) {
  const { firmSlug, leadId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const detail = await getLead(ctx, firm.firmId, leadId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { lead, stage, assignee, timeline, consents, duplicates, client } = detail;
  const stages = await listStages(ctx, firm.firmId);
  const sp = await searchParams;
  const canEdit = ctx.has("leads:edit", firm.firmId);
  const canConvert = ctx.has("leads:convert", firm.firmId) && ctx.has("clients:create", firm.firmId);
  const base = `/f/${firm.slug}`;
  const contactConsent = consents.find((c) => c.purpose === "contact");
  const canEmail = ctx.has("email:send", firm.firmId);
  const canPropose = ctx.has("proposals:create", firm.firmId) && !client;
  const canSeeProposals = ctx.has("proposals:view", firm.firmId);
  const proposals = canSeeProposals ? (await listProposals(ctx, firm.firmId, { leadId: lead.id })).rows : [];
  const catalogue = canPropose ? (await listCatalogue(ctx, firm.firmId, { activeOnly: true })).map((x) => ({ id: x.id, name: x.name, category: x.category, total: formatMoney(x.totalMinor, x.currency) })) : [];
  const templates = canEmail ? (await listTemplates(ctx, { kind: "firm", firmId: firm.firmId }, { includeHub: true, activeOnly: true })).map((t) => ({ id: t.id, name: t.name, category: t.category, subject: t.subject, hub: t.firmId === null })) : [];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href={`${base}/leads`} className="hover:text-ink">Leads</Link> <span aria-hidden="true">/</span> <span className="num">{lead.ref}</span>
      </nav>
      <PageHeader
        title={fullName(lead.firstName, lead.lastName)}
        meta={
          <>
            <Badge tone={STAGE_TONE[stage.category]}>{stage.name}</Badge>
            <Badge tone={PRIORITY_TONE[lead.priority]}>{PRIORITY_LABELS[lead.priority]} priority</Badge>
            {lead.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>)}
          </>
        }
        actions={
          <>
            {canEmail ? <ComposeDialog firmSlug={firm.slug} target={{ leadId: lead.id }} to={lead.email} templates={templates} /> : null}
            {canPropose ? <CreateProposalDialog firmSlug={firm.slug} leadId={lead.id} services={catalogue} /> : null}
            {canEdit && !client ? <StageSelect firmSlug={firm.slug} leadId={lead.id} current={lead.stageId} stages={stages.filter((s) => s.category !== "won").map((s) => ({ id: s.id, name: s.name }))} /> : null}
            {canEdit ? <Button asChild><Link href={`${base}/leads/${lead.id}/edit`}>Edit</Link></Button> : null}
            {client ? (
              <Button asChild variant="primary"><Link href={`${base}/clients/${client.id}`}>Open client {client.ref}</Link></Button>
            ) : canConvert ? (
              <ConvertButton firmSlug={firm.slug} leadId={lead.id} name={fullName(lead.firstName, lead.lastName)} />
            ) : null}
          </>
        }
      />
      {sp.created ? <Notice tone="ok" className="mb-4">Lead {lead.ref} created.</Notice> : null}
      {lead.duplicateOfId ? <Notice tone="warn" className="mb-4">Marked as a duplicate of another lead.</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader title="Enquiry" description={lead.immigrationCategory ?? "Category not set"} />
            <div className="p-4">
              {lead.enquiry ? <p className="max-w-[75ch] text-sm leading-relaxed whitespace-pre-wrap text-ink">{lead.enquiry}</p> : <p className="text-[13px] text-muted">No enquiry text was recorded.</p>}
            </div>
          </Panel>
          {canSeeProposals && proposals.length ? (
            <Panel>
              <PanelHeader title="Proposals" />
              <ul className="divide-y divide-hairline">
                {proposals.map((pr) => (
                  <li key={pr.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <Link href={`${base}/proposals/${pr.id}`} className="text-ink underline-offset-2 hover:underline">{pr.title} <span className="num text-xs text-muted">{pr.ref} v{pr.version}</span></Link>
                    <span className="flex items-center gap-2"><span className="num text-ink-2">{formatMoney(pr.totalMinor, pr.currency)}</span><Badge tone={PROPOSAL_TONE[pr.status]}>{statusLabel(pr.status)}</Badge></span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel>
            <PanelHeader title="Activity" description="Internal: never shown to the client." />
            {canEdit ? <div className="border-b border-hairline p-4"><NoteForm firmSlug={firm.slug} leadId={lead.id} /></div> : null}
            <Timeline items={timeline.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Contact" />
            <div className="p-4">
              <Facts
                items={[
                  ["Email", lead.email ? <a href={`mailto:${lead.email}`} className="text-accent hover:underline">{lead.email}</a> : null],
                  ["Phone", lead.phone ? <a href={`tel:${lead.phone}`} className="num text-accent hover:underline">{lead.phone}</a> : null],
                  ["Nationality", countryName(lead.nationality)],
                  ["Lives in", countryName(lead.currentCountry)],
                  ["Wants to go to", countryName(lead.destinationCountry)],
                ]}
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Handling" />
            <div className="p-4">
              <Facts
                items={[
                  ["Assigned to", assignee?.name ?? "Unassigned"],
                  ["Follow up", lead.followUpAt ? <LocalTime value={lead.followUpAt} /> : "None set"],
                  ["Source", `${SOURCE_LABELS[lead.source]}${lead.sourceDetail ? `: ${lead.sourceDetail}` : ""}`],
                  ["Received", <LocalTime key="r" value={lead.createdAt} />],
                  ["Reference", <span key="ref" className="num">{lead.ref}</span>],
                ]}
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Consent" description="The basis for contacting and processing this person's information." actions={canEdit ? <ConsentDialog firmSlug={firm.slug} leadId={lead.id} /> : null} />
            {consents.length === 0 ? (
              <p className="p-4 text-[13px] text-muted">No consent recorded{contactConsent ? "" : ". Record it before contacting them about anything beyond this enquiry"}.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {consents.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{c.purpose === "contact" ? "Contact" : c.purpose === "data_processing" ? "Data processing" : "Marketing"}</span>
                      <Badge tone={c.granted ? "ok" : "danger"}>{c.granted ? "Given" : "Refused"}</Badge>
                    </div>
                    <p className="text-xs text-muted">{c.method}, <LocalTime value={c.recordedAt} mode="date" /></p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {duplicates.length ? (
            <Panel>
              <PanelHeader title="Possible duplicates" description="Other leads in this firm with the same email or phone." />
              <DuplicateList firmSlug={firm.slug} leadId={lead.id} canEdit={canEdit && !lead.duplicateOfId} items={duplicates.map((d) => ({ id: d.id, ref: d.ref, name: fullName(d.firstName, d.lastName), createdAt: d.createdAt.toISOString() }))} />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

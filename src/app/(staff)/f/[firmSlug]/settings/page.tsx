import type { Metadata } from "next";
import { Badge, EmptyState, Facts, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/labels";
import { listStages } from "@/server/modules/crm/leads";
import { getFirmForSettings } from "@/server/modules/org/firms";
import { listCatalogue } from "@/server/modules/services/services";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { requireFirm } from "@/server/next/session";
import { getAiDraftingSetting } from "@/server/modules/documents/documents";
import { LocalTime } from "@/components/ui/forms";
import { AiDraftingToggle } from "../consent-client";
import { DepartmentForm, PoliciesForm, ProfileForm, StageEditor } from "./client";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/f/[firmSlug]/settings">) {
  const { firmSlug } = await params;
  const { ctx, firm: access } = await requireFirm(firmSlug);
  const { firm, offices, departments } = await getFirmForSettings(ctx, access.firmId);
  const [stages, services, ai] = await Promise.all([listStages(ctx, firm.id, true), listCatalogue(ctx, firm.id), getAiDraftingSetting(ctx, firm.id)]);
  const canManage = ctx.has("firm:manage", firm.id);
  const canEditProfile = canManage || ctx.has("firms:edit");
  const canEditFees = ctx.has("services:manage", firm.id);

  return (
    <>
      <PageHeader title="Settings" description={canManage ? `How ${firm.tradingName} is set up.` : `${firm.tradingName}'s setup. Only firm administrators can change it.`} />
      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Firm profile" description="Used on client-facing documents and emails as they are released." />
          <div className="p-4">
            {canEditProfile ? (
              <ProfileForm firmSlug={firm.slug} firm={{ legalName: firm.legalName, tradingName: firm.tradingName, brandColor: firm.brandColor, website: firm.website, emailDomain: firm.emailDomain, contactEmail: firm.contactEmail, contactPhone: firm.contactPhone, jurisdictions: firm.jurisdictions }} />
            ) : (
              <Facts items={[["Legal name", firm.legalName], ["Trading name", firm.tradingName], ["Website", firm.website], ["Contact email", firm.contactEmail], ["Jurisdictions", firm.jurisdictions.map(countryName).join(", ")]]} />
            )}
          </div>
        </Panel>

        <Panel id="ai">
          <PanelHeader title="AI drafting assistance" description="Lets staff ask for a first draft of a document from the linked client and matter records. Off unless switched on here." />
          <div className="flex flex-col gap-3 p-4 text-[13px]">
            <p className="text-ink-2">
              {!ai.configured ? "Not set up for this workspace yet (no API key). " : null}
              Status: <strong className="text-ink">{ai.enabled ? "On" : "Off"}</strong>
              {ai.changedAt ? <span className="text-muted"> · changed by {ai.changedBy ?? "an administrator"} <LocalTime value={ai.changedAt} mode="date" /></span> : null}
            </p>
            <ul className="list-disc pl-5 text-ink-2">
              <li>Works only for clients whose consent to AI-assisted drafting is recorded on their client page.</li>
              <li>Sends only the linked client&apos;s and matter&apos;s records to Anthropic&apos;s API (outside South Africa), with people&apos;s names replaced by labels.</li>
              <li>Never sends children&apos;s details, facts marked sensitive, ID or passport numbers, dates of birth or contact details.</li>
              <li>Every draft is marked AI-assisted, logged, and must be reviewed by a second person before it can be made final.</li>
            </ul>
            <p className="text-muted">Switching it on is the practice&apos;s decision under POPIA (operator agreement with Anthropic and the cross-border transfer basis).</p>
            {canManage ? <div><AiDraftingToggle slug={firm.slug} enabled={!!ai.enabled} /></div> : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Data sharing and security" description="These belong to the firm, not to the Hub. Only this firm's administrators can change them." />
          <div className="p-4">
            {canManage ? (
              <PoliciesForm firmSlug={firm.slug} policies={{ shareAggregateMetrics: firm.shareAggregateMetrics, allowGroupAdminAccess: firm.allowGroupAdminAccess, requireMfaForAll: firm.requireMfaForAll }} />
            ) : (
              <Facts items={[["Share counts with the Hub", firm.shareAggregateMetrics ? "Yes" : "No"], ["Hub administrators may join", firm.allowGroupAdminAccess ? "Yes" : "No"], ["Two-step sign-in for everyone", firm.requireMfaForAll ? "Required" : "Only for administrators"]]} />
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Lead pipeline" description="Stages leads move through. Hidden stages stay on old records but can't be chosen." />
          <StageEditor firmSlug={firm.slug} canManage={canManage} stages={stages.map((s) => ({ id: s.id, name: s.name, category: s.category, isActive: s.isActive }))} />
        </Panel>

        <Link href={`/f/${firm.slug}/settings/matters`} id="matters" className="flex items-center justify-between rounded-2xl border border-hairline bg-surface px-5 py-4 hover:border-hairline-strong">
          <span>
            <span className="block text-sm font-semibold text-ink">Matters</span>
            <span className="block text-[13px] text-muted">Stages by service, task templates and validated deadline rules.</span>
          </span>
          <span className="text-[13px] text-ink-2">Open →</span>
        </Link>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Offices" description="Global Immigration Hub centres this firm works from." />
            {offices.length === 0 ? <EmptyState title="No offices linked" /> : (
              <ul className="divide-y divide-hairline">
                {offices.map((o) => (
                  <li key={o.id} className="px-4 py-3 text-[13px]">
                    <p className="font-medium text-ink">{o.name} {o.kind === "gih_centre" ? <Badge tone="outline" className="ml-1">Hub centre</Badge> : null}</p>
                    <p className="text-muted">{[o.addressLine1, o.addressLine2, o.city, countryName(o.country)].filter(Boolean).join(", ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Departments" />
            {departments.length ? (
              <ul className="divide-y divide-hairline">{departments.map((d) => <li key={d.id} className="px-4 py-2.5 text-[13px] text-ink">{d.name}</li>)}</ul>
            ) : <p className="px-4 pt-4 text-[13px] text-muted">No departments yet.</p>}
            {canManage ? <div className="p-4"><DepartmentForm firmSlug={firm.slug} /></div> : null}
          </Panel>
        </div>

        <Panel id="services">
          <PanelHeader
            title="Service catalogue and fees"
            description={services.length ? `${services.length} services. Totals are core fees; add-ons are charged only when needed. ${canEditFees ? "Open a service to change its fees; every change is kept as a price version." : "Only firm administrators and finance officers can change fees."}` : undefined}
            actions={canEditFees ? <Button asChild size="sm" variant="secondary"><Link href={`/f/${firm.slug}/settings/services/new`}><Plus /> Add service</Link></Button> : undefined}
          />
          {services.length === 0 ? (
            <EmptyState title="No fees configured for this firm yet">Fees are loaded from the approved fee schedule. Send the confirmed schedule for this firm and it will be added.</EmptyState>
          ) : (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead><tr><th className={t.th}>Service</th><th className={t.th}>Group</th><th className={t.th}>Version</th><th className={`${t.th} text-right`}>Total</th><th className={`${t.th} text-right`}>Deposit</th><th className={t.th}>Add-ons</th></tr></thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.id} className={t.row}>
                      <td className={t.td}>
                        <Link href={`/f/${firm.slug}/settings/services/${s.id}`} className="text-ink underline-offset-2 hover:underline">{s.name}</Link>
                        {s.isActive ? null : <Badge tone="outline" className="ml-1.5">Not offered</Badge>}
                        <ul className="mt-1 text-xs text-muted">
                          {s.lines.map((l) => <li key={l.label} className="num">{l.label}: {formatMoney(l.amountMinor, s.currency)}</li>)}
                        </ul>
                      </td>
                      <td className={`${t.td} text-ink-2`}>{s.category}</td>
                      <td className={`${t.td} num text-ink-2`}>v{s.version}</td>
                      <td className={`${t.td} num text-right`}>{formatMoney(s.totalMinor, s.currency)}</td>
                      <td className={`${t.td} num text-right text-ink-2`}>{formatMoney(s.depositMinor, s.currency)}</td>
                      <td className={`${t.td} max-w-[280px] text-xs text-muted`}>{s.addOns.map((a) => `${a.label}${a.amountMinor != null ? ` ${formatMoney(a.amountMinor, s.currency)}` : ` (${(a.note ?? "TBC").toLowerCase()})`}`).join("; ") || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

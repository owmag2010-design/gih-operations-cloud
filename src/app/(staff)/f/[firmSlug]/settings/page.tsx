import type { Metadata } from "next";
import { Badge, EmptyState, Facts, PageHeader, Panel, PanelHeader, tableClass as t } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/labels";
import { listStages } from "@/server/modules/crm/leads";
import { getFirmForSettings, listServices } from "@/server/modules/org/firms";
import { requireFirm } from "@/server/next/session";
import { DepartmentForm, PoliciesForm, ProfileForm, StageEditor } from "./client";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/f/[firmSlug]/settings">) {
  const { firmSlug } = await params;
  const { ctx, firm: access } = await requireFirm(firmSlug);
  const { firm, offices, departments } = await getFirmForSettings(ctx, access.firmId);
  const [stages, services] = await Promise.all([listStages(ctx, firm.id, true), listServices(ctx, firm.id)]);
  const canManage = ctx.has("firm:manage", firm.id);
  const canEditProfile = canManage || ctx.has("firms:edit");

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

        <Panel>
          <PanelHeader title="Service catalogue and fees" description={services.length ? `${services.length} services from ${services[0].sourceNote ?? "the fee schedule"}. Totals are core fees; add-ons are charged only when needed. Editing arrives with proposals in Release 2.` : undefined} />
          {services.length === 0 ? (
            <EmptyState title="No fees configured for this firm yet">Fees are loaded from the approved fee schedule. Send the confirmed schedule for this firm and it will be added.</EmptyState>
          ) : (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead><tr><th className={t.th}>Service</th><th className={t.th}>Group</th><th className={`${t.th} text-right`}>Total</th><th className={`${t.th} text-right`}>Deposit</th><th className={t.th}>Add-ons</th></tr></thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.id} className={t.row}>
                      <td className={t.td}>
                        <details>
                          <summary className="cursor-pointer text-ink">{s.name}</summary>
                          <ul className="mt-1.5 mb-1 text-xs text-muted">
                            {s.lines.map((l) => <li key={l.label} className="num">{l.label}: {formatMoney(l.amountMinor, s.currency)}</li>)}
                          </ul>
                        </details>
                      </td>
                      <td className={`${t.td} text-ink-2`}>{s.category}</td>
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

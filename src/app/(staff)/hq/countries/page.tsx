import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Panel, PanelHeader, tableClass } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { statusTone } from "@/lib/country-status";
import {
  CAPABILITY_AREA_LABELS, CAPABILITY_AREAS, CAPABILITY_STATUS_LABELS, CAPABILITY_STATUSES, COUNTRY_STATUS_LABELS, getCapabilityMatrix, listCountries,
} from "@/server/modules/countries/countries";
import { requireStaff } from "@/server/next/session";
import { CapabilityForm, RegisteredCountryForm } from "./client";

export const metadata: Metadata = { title: "Countries" };


export default async function CountriesPage() {
  const { ctx } = await requireStaff();
  const [countries, matrix] = await Promise.all([listCountries(ctx), getCapabilityMatrix(ctx)]);
  const canManage = ctx.has("countries:manage");
  const canReview = ctx.has("countries:review");
  const live = countries.filter((c) => c.status !== "retired");
  return (
    <>
      <PageHeader
        title="Countries"
        description="How the platform works in each country, and how far each one has been checked. A country being listed here doesn't make its services usable: only operational countries appear in work sent to clients."
        actions={canManage ? <Link href="/hq/countries/new" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-accent-hover">Add a country</Link> : null}
      />
      <Panel className="mb-5">
        <PanelHeader title="Country profiles" description="Draft → in review → verified → operational. Editing a verified or operational profile sends it back to draft." />
        <div className={tableClass.wrap}>
          <table className={tableClass.table}>
            <thead>
              <tr>{["Country", "Status", "Currency", "Main time zone", "Holiday calendars", "Sources", "Version"].map((h) => <th key={h} className={tableClass.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.id} className={tableClass.row}>
                  <td className={tableClass.td}><Link className="font-medium underline-offset-2 hover:underline" href={`/hq/countries/${c.code}`}>{c.name}</Link> <span className="text-muted">{c.code}</span></td>
                  <td className={tableClass.td}><Badge tone={statusTone(c.status)}>{COUNTRY_STATUS_LABELS[c.status]}</Badge>{c.selfReviewed && (c.status === "verified" || c.status === "operational") ? <span className="ml-1.5 text-xs text-muted">self-reviewed</span> : null}</td>
                  <td className={tableClass.td}>{c.currency}</td>
                  <td className={tableClass.td}>{c.defaultTimezone}</td>
                  <td className={tableClass.td}>{c.verifiedCalendars} of {c.calendars} verified</td>
                  <td className={tableClass.td}>{c.verifiedSources} of {c.sources} verified</td>
                  <td className={tableClass.td}>v{c.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mb-5">
        <PanelHeader
          title="Practice-by-country checks"
          description={`Each practice is a separate legal entity. What works for one practice in one country is recorded here and never assumed for another. Areas: ${CAPABILITY_AREAS.map((a) => CAPABILITY_AREA_LABELS[a].toLowerCase()).join(", ")}. "Settled" means verified or not needed; open a country for the detail.`}
        />
        <div className={tableClass.wrap}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>Practice</th>
                <th className={`${tableClass.th} min-w-[300px]`}>Registered in</th>
                {live.map((c) => <th key={c.code} className={tableClass.th}>{c.code}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.firms.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className={tableClass.td}>{f.name}</td>
                  <td className={tableClass.td}>
                    {ctx.has("firms:edit") ? <RegisteredCountryForm firmId={f.id} value={f.registeredCountry} /> : (countryName(f.registeredCountry) || <span className="text-muted">Not confirmed</span>)}
                  </td>
                  {live.map((c) => {
                    const cells = matrix.cells.filter((x) => x.firmId === f.id && x.countryCode === c.code);
                    const done = cells.filter((x) => x.status === "verified" || x.status === "not_needed").length;
                    const pending = cells.filter((x) => x.status === "pending").length;
                    const unavailable = cells.filter((x) => x.status === "unavailable").length;
                    return (
                      <td key={c.code} className={tableClass.td}>
                        <Link href={`/hq/countries/${c.code}`} className="grid gap-0.5 text-[12px] hover:underline" aria-label={`${f.name} in ${c.name}: ${done} of ${CAPABILITY_AREAS.length} areas settled`}>
                          <span className={done === CAPABILITY_AREAS.length ? "text-ok" : "text-ink"}>{done} of {CAPABILITY_AREAS.length} settled</span>
                          {pending || unavailable ? <span className="text-muted">{[pending && `${pending} pending`, unavailable && `${unavailable} unavailable`].filter(Boolean).join(" · ")}</span> : null}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <details className="border-t border-hairline">
            <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-2">Record a check</summary>
            <CapabilityForm
              code={null}
              firms={matrix.firms.map((f) => ({ id: f.id, name: f.name }))}
              areas={CAPABILITY_AREAS.map((a) => [a, CAPABILITY_AREA_LABELS[a]])}
              statuses={CAPABILITY_STATUSES.map((s) => [s, CAPABILITY_STATUS_LABELS[s]])}
              canReview={canReview}
            />
          </details>
        ) : null}
      </Panel>
    </>
  );
}

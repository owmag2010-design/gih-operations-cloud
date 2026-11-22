import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Facts, Notice, PageHeader, Panel, PanelHeader, tableClass } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/forms";
import { NotFoundError } from "@/server/errors";
import {
  CAPABILITY_AREA_LABELS, CAPABILITY_AREAS, CAPABILITY_STATUS_LABELS, CAPABILITY_STATUSES, COUNTRY_STATUS_LABELS, getCountry,
} from "@/server/modules/countries/countries";
import { listOrgStaff } from "@/server/modules/people/people";
import { requireStaff } from "@/server/next/session";
import { CalendarCard, CapabilityForm, NewCalendarForm, ProfileForm, SourceActions, SourceForm, StatusActions } from "../client";
import { kindLabel, statusTone } from "@/lib/country-status";

export async function generateMetadata({ params }: PageProps<"/hq/countries/[code]">): Promise<Metadata> {
  return { title: `Country ${(await params).code.toUpperCase()}` };
}

export default async function CountryPage({ params }: PageProps<"/hq/countries/[code]">) {
  const { ctx } = await requireStaff();
  const { code } = await params;
  let view;
  try {
    view = await getCountry(ctx, code);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { profile: p, calendars, sources, matrix, versions, readiness } = view;
  const canManage = ctx.has("countries:manage");
  const canReview = ctx.has("countries:review");
  const staff = ctx.has("staff:view") ? (await listOrgStaff(ctx)).filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name })) : [];
  const editable = canManage && (p.status === "draft" || p.status === "verified" || p.status === "operational");
  return (
    <>
      <p className="mb-2 text-[13px]"><Link href="/hq/countries" className="text-muted hover:text-ink">← Countries</Link></p>
      <PageHeader
        title={`${p.name}`}
        description={p.status === "operational" ? "Operational: services and proposals for this country can go to clients." : "Not operational: nothing client-facing can use this country yet."}
        meta={<><Badge tone={statusTone(p.status)}>{COUNTRY_STATUS_LABELS[p.status]}</Badge><span className="text-[13px] text-muted">{p.code} · version {p.version}</span>{p.selfReviewed ? <Badge tone="outline">Reviewed by the person who submitted it</Badge> : null}</>}
      />
      {p.reviewNote && p.status === "draft" ? <Notice tone="warn" className="mb-4">Reviewer&apos;s note: {p.reviewNote}</Notice> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="grid min-w-0 gap-5">
          <Panel>
            <PanelHeader title="Profile" description="Currency, formats, time zones and the authorities for this country." />
            <ProfileForm
              mode="edit"
              canEdit={editable}
              warnReopen={p.status === "verified" || p.status === "operational" ? `Saving takes ${p.code} out of ${COUNTRY_STATUS_LABELS[p.status].toLowerCase()} use until it is reviewed again.` : undefined}
              initial={{
                code: p.code, name: p.name, currency: p.currency, dateFormat: p.dateFormat, phonePrefix: p.phonePrefix ?? "", timezones: p.timezones.join(", "), defaultTimezone: p.defaultTimezone,
                addressFormat: p.addressFormat.map((f) => `${f.key} | ${f.label}${f.required ? " | required" : ""}`).join("\n"),
                authorities: p.authorities.map((a) => [a.name, a.kind, a.url ?? ""].join(" | ")).join("\n"),
                notes: p.notes ?? "",
              }}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Public-holiday calendars" description="Business-day deadlines skip these dates only once the calendar is verified. A deadline rule names the calendar it uses." />
            {calendars.length ? calendars.map((c) => (
              <CalendarCard key={c.id} code={p.code} canManage={canManage} canReview={canReview}
                cal={{ ...c, reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null, holidays: c.holidays.map((h) => ({ id: h.id, date: h.date, name: h.name, sourceUrl: h.sourceUrl })) }} />
            )) : <p className="p-4 text-[13px] text-muted">No calendars yet.</p>}
            {canManage ? (
              <details className="border-t border-hairline">
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-2">Add a calendar</summary>
                <NewCalendarForm code={p.code} />
              </details>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title="Authoritative sources" description="Legislation, official fees, requirements and guidance this country's configuration relies on, with effective dates and who reviews them." />
            <div className={tableClass.wrap}>
              <table className={tableClass.table}>
                <thead><tr>{["Source", "Kind", "In effect", "Reviewer", "Status", ""].map((h, i) => <th key={i} className={tableClass.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id} className={tableClass.row}>
                      <td className={tableClass.td}><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a>{s.publisher ? <span className="text-muted"> · {s.publisher}</span> : null}{s.notes ? <p className="text-xs text-muted">{s.notes}</p> : null}</td>
                      <td className={tableClass.td}>{kindLabel(s.kind)}</td>
                      <td className={tableClass.td}>{s.effectiveFrom ?? "—"}{s.effectiveTo ? ` to ${s.effectiveTo}` : ""}</td>
                      <td className={tableClass.td}>{s.owner ?? <span className="text-muted">Not assigned</span>}</td>
                      <td className={tableClass.td}><Badge tone={s.status === "verified" ? "ok" : s.status === "superseded" ? "outline" : "warn"}>{s.status === "verified" ? `Verified${s.reviewedBy ? ` by ${s.reviewedBy}` : ""}` : s.status === "superseded" ? "Superseded" : "Draft"}</Badge></td>
                      <td className={tableClass.td}><SourceActions code={p.code} id={s.id} status={s.status} canReview={canReview} /></td>
                    </tr>
                  ))}
                  {!sources.length ? <tr><td colSpan={6} className="p-4 text-[13px] text-muted">No sources yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {canManage ? (
              <details className="border-t border-hairline">
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-2">Add a source</summary>
                <SourceForm code={p.code} staff={staff} />
              </details>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title={`Practice checks in ${p.name}`} description="What has been confirmed for each practice in this country. An integration that works in one country isn't assumed to work here." />
            <div className={tableClass.wrap}>
              <table className={tableClass.table}>
                <thead><tr><th className={tableClass.th}>Area</th>{matrix.firms.map((f) => <th key={f.id} className={tableClass.th}>{f.name}</th>)}</tr></thead>
                <tbody>
                  {CAPABILITY_AREAS.map((a) => (
                    <tr key={a}>
                      <td className={tableClass.td}>{CAPABILITY_AREA_LABELS[a]}</td>
                      {matrix.firms.map((f) => {
                        const cell = matrix.cells.find((c) => c.firmId === f.id && c.area === a);
                        return (
                          <td key={f.id} className={tableClass.td}>
                            <span className={cell?.status === "verified" ? "text-ok" : cell?.status === "unavailable" ? "text-danger" : cell?.status === "pending" ? "text-warn" : "text-muted"}>{CAPABILITY_STATUS_LABELS[cell?.status ?? "not_assessed"]}</span>
                            {cell?.provider ? <span className="text-muted"> · {cell.provider}</span> : null}
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
                <CapabilityForm code={p.code} firms={matrix.firms.map((f) => ({ id: f.id, name: f.name }))} areas={CAPABILITY_AREAS.map((a) => [a, CAPABILITY_AREA_LABELS[a]])} statuses={CAPABILITY_STATUSES.map((s) => [s, CAPABILITY_STATUS_LABELS[s]])} canReview={canReview} />
              </details>
            ) : null}
          </Panel>
        </div>

        <div className="grid content-start gap-5">
          <Panel>
            <PanelHeader title="Review" />
            {canManage || canReview ? <StatusActions code={p.code} status={p.status} canManage={canManage} canReview={canReview} blockers={readiness} /> : <p className="p-4 text-[13px] text-muted">Only Hub country administrators can change this.</p>}
            <div className="border-t border-hairline p-4">
              <Facts items={[
                ["Submitted by", p.submittedBy ? <>{p.submittedBy}{p.submittedAt ? <> · <LocalTime value={p.submittedAt} mode="date" /></> : null}</> : null],
                ["Verified by", p.reviewedBy ? <>{p.reviewedBy}{p.reviewedAt ? <> · <LocalTime value={p.reviewedAt} mode="date" /></> : null}</> : null],
                ["Made operational by", p.operationalBy ? <>{p.operationalBy}{p.operationalAt ? <> · <LocalTime value={p.operationalAt} mode="date" /></> : null}</> : null],
              ]} />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Version history" />
            <ol className="grid gap-2 p-4 text-[13px]">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-col">
                  <span><span className="font-medium">v{v.version}</span> · {COUNTRY_STATUS_LABELS[v.status]} · {v.reason}</span>
                  <span className="text-xs text-muted">{v.changedBy ?? "Configuration load"} · <LocalTime value={v.createdAt} /></span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

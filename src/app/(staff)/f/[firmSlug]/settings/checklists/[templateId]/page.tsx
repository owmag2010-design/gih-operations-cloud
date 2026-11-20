import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, Notice, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { APPLIES_TO_LABELS, getChecklistTemplate } from "@/server/modules/checklists/checklists";
import { listCatalogue } from "@/server/modules/services/services";
import { requireFirm } from "@/server/next/session";
import { AddItemForm, ChecklistDetailsForm, RemoveItemButton, VersionActions } from "../client";

export const metadata: Metadata = { title: "Document checklist" };

export default async function ChecklistPage({ params }: PageProps<"/f/[firmSlug]/settings/checklists/[templateId]">) {
  const { firmSlug, templateId } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  let view;
  try {
    view = await getChecklistTemplate(ctx, firm.firmId, templateId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { template: t, items, versions, source, service, country, sources } = view;
  const canManage = ctx.has("firm:manage", firm.firmId);
  const draft = t.status === "draft";
  const countryReady = country?.status === "verified" || country?.status === "operational";
  const catalogue = draft && canManage ? (await listCatalogue(ctx, firm.firmId, { activeOnly: true })).filter((s) => s.jurisdiction === t.countryCode) : [];
  const blockers = [
    !items.length && "add at least one document",
    !countryReady && `a Hub reviewer must verify ${country?.name ?? t.countryCode} first`,
    !t.sourceId && !t.sourceNote && "record where the checklist comes from",
  ].filter(Boolean) as string[];
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted">
        <Link href={`/f/${firm.slug}/settings`} className="hover:text-ink">Settings</Link> <span aria-hidden="true">/</span>{" "}
        <Link href={`/f/${firm.slug}/settings/matters#checklists`} className="hover:text-ink">Matters</Link> <span aria-hidden="true">/</span> Checklist
      </nav>
      <PageHeader
        title={t.name}
        description={`${country?.name ?? t.countryCode}${service ? ` · ${service.name}` : " · any service"}. Each version is fixed once published; matters keep the version they were given.`}
        meta={<><Badge tone={t.status === "published" ? "ok" : t.status === "retired" ? "outline" : "warn"}>{t.status === "published" ? "Published" : t.status === "retired" ? "Retired" : "Draft"}</Badge><span className="text-[13px] text-muted">Version {t.version}</span></>}
        actions={canManage ? <VersionActions slug={firm.slug} id={t.id} status={t.status} canPublish={!blockers.length} /> : null}
      />
      {draft && blockers.length && canManage ? <Notice tone="warn" className="mb-4">Before publishing: {blockers.join("; ")}.</Notice> : null}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 gap-5 content-start">
          <Panel>
            <PanelHeader title="Documents" description="Each line becomes a request on the matter, once or for each person it applies to." />
            {items.length ? (
              <ol className="divide-y divide-hairline">
                {items.map((i, n) => (
                  <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="num w-6 pt-0.5 text-xs text-muted">{n + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{i.label}</p>
                      <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted">
                        <span>{APPLIES_TO_LABELS[i.appliesTo]}</span>
                        <span>· {i.required ? "Required" : "Optional"}</span>
                        {i.tracksExpiry ? <span>· Expiry recorded</span> : null}
                        {!i.clientVisible ? <span>· Staff only</span> : null}
                      </p>
                      {i.guidance ? <p className="mt-1 text-[13px] text-ink-2">{i.guidance}</p> : null}
                    </div>
                    {draft && canManage ? <RemoveItemButton slug={firm.slug} templateId={t.id} itemId={i.id} label={i.label} /> : null}
                  </li>
                ))}
              </ol>
            ) : <p className="p-4 text-[13px] text-muted">No documents yet.</p>}
            {draft && canManage ? <AddItemForm slug={firm.slug} templateId={t.id} /> : null}
          </Panel>
          {draft && canManage ? (
            <Panel>
              <PanelHeader title="Details and source" />
              <ChecklistDetailsForm slug={firm.slug} t={t} services={catalogue.map((s) => ({ id: s.id, name: s.name }))} sources={sources} />
            </Panel>
          ) : null}
        </div>
        <div className="grid content-start gap-5">
          <Panel>
            <PanelHeader title="Source" />
            <div className="p-4 text-[13px]">
              {source ? <p><a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> <span className="text-muted">({source.status})</span></p> : null}
              {t.sourceNote ? <p className="mt-1 text-ink-2">{t.sourceNote}</p> : null}
              {!source && !t.sourceNote ? <p className="text-muted">Not recorded yet.</p> : null}
              <p className="mt-2 text-muted">Country profile: {country ? country.status.replace("_", " ") : "none"}.</p>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Versions" />
            <ol className="grid gap-2 p-4 text-[13px]">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link className={v.id === t.id ? "font-semibold text-ink" : "text-ink-2 hover:underline"} href={`/f/${firm.slug}/settings/checklists/${v.id}`}>Version {v.version}</Link>
                  <span className="text-muted"> · {v.status}{v.publishedAt ? <> · <LocalTime value={v.publishedAt} mode="date" /></> : null}</span>
                  {v.changeNote ? <p className="text-xs text-muted">{v.changeNote}</p> : null}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

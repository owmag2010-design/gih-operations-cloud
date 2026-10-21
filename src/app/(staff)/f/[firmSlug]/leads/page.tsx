import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, PageHeader, Panel } from "@/components/ui/primitives";
import { parseLeadFilters } from "@/server/modules/crm/filters";
import { assignableUsers, leadTags, listLeads, listStages } from "@/server/modules/crm/leads";
import { listSavedViews } from "@/server/modules/crm/views";
import { requireFirm } from "@/server/next/session";
import { LeadBoard, LeadCalendar, LeadFilterBar, LeadsTable, ViewSwitcher } from "./client";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ params, searchParams }: PageProps<"/f/[firmSlug]/leads">) {
  const { firmSlug } = await params;
  const { ctx, firm } = await requireFirm(firmSlug);
  const canAll = ctx.has("leads:view_all", firm.firmId);
  if (!canAll && !ctx.has("leads:view_assigned", firm.firmId)) notFound();

  const sp = await searchParams;
  const filters = parseLeadFilters(sp);
  const rawQuery = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : []))).toString();

  const [stages, people, tags, views] = await Promise.all([
    listStages(ctx, firm.firmId),
    canAll ? assignableUsers(ctx, firm.firmId) : Promise.resolve([]),
    leadTags(ctx, firm.firmId),
    listSavedViews(ctx, firm.firmId),
  ]);

  let monthStart: Date | undefined;
  if (filters.view === "calendar") {
    const [y, m] = (filters.month ?? new Date().toISOString().slice(0, 7)).split("-").map(Number);
    monthStart = new Date(Date.UTC(y, m - 1, 1));
  }
  const data =
    filters.view === "board"
      ? await listLeads(ctx, firm.firmId, { ...filters, status: "open", page: 1 }, { limit: 600 })
      : filters.view === "calendar"
        ? await listLeads(ctx, firm.firmId, { ...filters, status: filters.status ?? "all", page: 1, followUpFrom: new Date(monthStart!.getTime() - 7 * 864e5), followUpTo: new Date(Date.UTC(monthStart!.getUTCFullYear(), monthStart!.getUTCMonth() + 1, 8)), sort: "follow_up", dir: "asc" }, { limit: 1000 })
        : await listLeads(ctx, firm.firmId, filters);

  const perms = {
    create: ctx.has("leads:create", firm.firmId),
    edit: ctx.has("leads:edit", firm.firmId),
    assign: ctx.has("leads:assign", firm.firmId),
    remove: ctx.has("leads:delete", firm.firmId),
    exportCsv: ctx.has("leads:export", firm.firmId),
    shareViews: ctx.has("firm:manage", firm.firmId),
  };
  const base = `/f/${firm.slug}/leads`;
  const rows = data.rows.map((r) => ({ ...r, followUpAt: r.followUpAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));

  return (
    <>
      <PageHeader
        title="Leads"
        description={canAll ? `${data.total.toLocaleString("en-ZA")} matching your filters.` : `Leads assigned to you: ${data.total.toLocaleString("en-ZA")} matching.`}
        actions={
          <>
            {perms.exportCsv ? <Button asChild><a href={`${base}/export?${rawQuery}`} download>Export CSV</a></Button> : null}
            {perms.create ? <Button asChild variant="primary"><Link href={`${base}/new`}>New lead</Link></Button> : null}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ViewSwitcher current={filters.view} />
      </div>
      <LeadFilterBar
        stages={stages.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        people={people}
        tags={tags}
        views={views.map((v) => ({ id: v.id, name: v.name, query: v.query, mine: v.userId === ctx.user.id, shared: v.isShared }))}
        firmSlug={firm.slug}
        canSeeAll={canAll}
        canShare={perms.shareViews}
        view={filters.view}
      />
      <Panel className="mt-3">
        {filters.view === "board" ? (
          <LeadBoard firmSlug={firm.slug} stages={stages.filter((s) => s.category === "open").map((s) => ({ id: s.id, name: s.name }))} rows={rows} canEdit={perms.edit} />
        ) : filters.view === "calendar" ? (
          <LeadCalendar firmSlug={firm.slug} month={monthStart!.toISOString().slice(0, 7)} rows={rows} />
        ) : (
          <LeadsTable
            firmSlug={firm.slug}
            rows={rows}
            total={data.total}
            page={data.page}
            pageSize={data.pageSize}
            stages={stages.filter((s) => s.category !== "won").map((s) => ({ id: s.id, name: s.name }))}
            people={people}
            perms={perms}
            hasFilters={rawQuery.replace(/(^|&)view=[^&]*/g, "").length > 0}
          />
        )}
      </Panel>
    </>
  );
}

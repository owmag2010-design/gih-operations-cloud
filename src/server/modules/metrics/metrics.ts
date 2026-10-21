import "server-only";
import { and, asc, count, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { db, withScope } from "../../db/client";
import { firms, intakeItems, leads, pipelineStages, users } from "../../db/schema";

export type FirmSummary = {
  firmId: string;
  firmName: string;
  brandColor: string;
  newLeads: number;
  openLeads: number;
  unassignedOpenLeads: number;
  overdueFollowUps: number;
  wonLeads: number;
  activeClients: number;
  newClients: number;
};

type SummaryRow = {
  firm_id: string;
  new_leads: string;
  open_leads: string;
  unassigned_open_leads: string;
  overdue_follow_ups: string;
  won_leads: string;
  active_clients: string;
  new_clients: string;
};

async function summaries(ctx: AccessContext, firmIds: string[], since: Date): Promise<FirmSummary[]> {
  if (!firmIds.length) return [];
  const names = await db().select({ id: firms.id, name: firms.tradingName, color: firms.brandColor }).from(firms).where(eq(firms.orgId, ctx.orgId));
  const rows = await withScope(ctx.scopeForAllFirms(), async (tx) => {
    const res = await tx.execute<SummaryRow>(sql`select * from metrics_firm_summary(${`{${firmIds.join(",")}}`}::uuid[], ${since.toISOString()}::timestamptz)`);
    return res.rows;
  });
  return rows
    .map((r) => {
      const f = names.find((n) => n.id === r.firm_id);
      return {
        firmId: r.firm_id,
        firmName: f?.name ?? "Unknown firm",
        brandColor: f?.color ?? "#888",
        newLeads: Number(r.new_leads),
        openLeads: Number(r.open_leads),
        unassignedOpenLeads: Number(r.unassigned_open_leads),
        overdueFollowUps: Number(r.overdue_follow_ups),
        wonLeads: Number(r.won_leads),
        activeClients: Number(r.active_clients),
        newClients: Number(r.new_clients),
      };
    })
    .sort((a, b) => a.firmName.localeCompare(b.firmName));
}

/**
 * Group Command Centre. Aggregates only, from firms that share metrics with the
 * group (or that the caller belongs to). Firms that don't share are listed so
 * the screen can say so rather than show a misleading zero.
 */
export async function groupCommandCentre(ctx: AccessContext, opts: { since: Date; firmId?: string }) {
  ctx.require("metrics:group");
  const all = await db().select().from(firms).where(and(eq(firms.orgId, ctx.orgId), eq(firms.status, "active"))).orderBy(asc(firms.tradingName));
  const visible = all.filter((f) => f.shareAggregateMetrics || ctx.firms.has(f.id));
  const selected = opts.firmId ? visible.filter((f) => f.id === opts.firmId) : visible;
  const perFirm = await summaries(ctx, selected.map((f) => f.id), opts.since);

  let intake: { new: number; held: number; receivedSince: number; oldestWaitingAt: Date | null } | null = null;
  if (ctx.has("intake:view")) {
    intake = await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, async (tx) => {
      const byStatus = await tx.select({ status: intakeItems.status, n: count() }).from(intakeItems).where(eq(intakeItems.orgId, ctx.orgId)).groupBy(intakeItems.status);
      const [{ n: receivedSince }] = await tx.select({ n: count() }).from(intakeItems).where(and(eq(intakeItems.orgId, ctx.orgId), sql`${intakeItems.receivedAt} >= ${opts.since}`));
      const [oldest] = await tx.select({ at: intakeItems.receivedAt }).from(intakeItems).where(and(eq(intakeItems.orgId, ctx.orgId), eq(intakeItems.status, "new"))).orderBy(asc(intakeItems.receivedAt)).limit(1);
      const get = (s: string) => byStatus.find((b) => b.status === s)?.n ?? 0;
      return { new: get("new"), held: get("held"), receivedSince, oldestWaitingAt: oldest?.at ?? null };
    });
  }

  const sourceRows = selected.length
    ? await withScope(ctx.scopeForAllFirms(), async (tx) =>
        (await tx.execute<{ firm_id: string; source: string; total: string }>(sql`select * from metrics_leads_by_source(${`{${selected.map((f) => f.id).join(",")}}`}::uuid[], ${opts.since.toISOString()}::timestamptz)`)).rows,
      )
    : [];
  const bySource: Record<string, number> = {};
  for (const r of sourceRows) bySource[r.source] = (bySource[r.source] ?? 0) + Number(r.total);

  const totals = perFirm.reduce(
    (a, f) => ({
      newLeads: a.newLeads + f.newLeads, openLeads: a.openLeads + f.openLeads, unassignedOpenLeads: a.unassignedOpenLeads + f.unassignedOpenLeads,
      overdueFollowUps: a.overdueFollowUps + f.overdueFollowUps, wonLeads: a.wonLeads + f.wonLeads, activeClients: a.activeClients + f.activeClients, newClients: a.newClients + f.newClients,
    }),
    { newLeads: 0, openLeads: 0, unassignedOpenLeads: 0, overdueFollowUps: 0, wonLeads: 0, activeClients: 0, newClients: 0 },
  );

  // Workload: only for firms where the caller can see firm metrics.
  const workloadFirms = selected.filter((f) => ctx.has("metrics:firm", f.id)).map((f) => f.id);
  const workload = workloadFirms.length ? await workloadFor(ctx, workloadFirms) : [];

  return {
    activeFirms: all.length,
    withheldFirms: all.filter((f) => !f.shareAggregateMetrics && !ctx.firms.has(f.id)).map((f) => f.tradingName),
    visibleFirms: visible.map((f) => ({ id: f.id, name: f.tradingName })),
    perFirm,
    totals,
    bySource,
    intake,
    workload,
    workloadAvailable: workloadFirms.length > 0,
  };
}

async function workloadFor(ctx: AccessContext, firmIds: string[]) {
  return withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds }, async (tx) => {
    const rows = await tx
      .select({ userId: users.id, name: users.name, open: count(), overdue: sql<number>`count(*) filter (where ${leads.followUpAt} < now())` })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .innerJoin(users, eq(users.id, leads.assignedToId))
      .where(and(isNull(leads.deletedAt), eq(pipelineStages.category, "open")))
      .groupBy(users.id, users.name)
      .orderBy(desc(count()))
      .limit(15);
    return rows.map((r) => ({ ...r, overdue: Number(r.overdue) }));
  });
}

/** Firm dashboard: the firm's own numbers, pipeline shape, workload and today's follow-ups. */
export async function firmDashboard(ctx: AccessContext, firmId: string, since: Date) {
  ctx.require("metrics:firm", firmId);
  const [summary] = await summaries(ctx, [firmId], since);
  const scope = ctx.scopeFor(firmId);
  const byStage = await withScope(scope, (tx) =>
    tx
      .select({ id: pipelineStages.id, name: pipelineStages.name, category: pipelineStages.category, n: sql<number>`count(${leads.id}) filter (where ${leads.deletedAt} is null)` })
      .from(pipelineStages)
      .leftJoin(leads, eq(leads.stageId, pipelineStages.id))
      .where(and(eq(pipelineStages.firmId, firmId), eq(pipelineStages.isActive, true)))
      .groupBy(pipelineStages.id, pipelineStages.name, pipelineStages.category, pipelineStages.position)
      .orderBy(asc(pipelineStages.position)),
  );
  const workload = await workloadFor(ctx, [firmId]);
  const canSeeLeads = ctx.has("leads:view_all", firmId) || ctx.has("leads:view_assigned", firmId);
  const overdue = canSeeLeads
    ? await withScope(scope, (tx) =>
        tx
          .select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, followUpAt: leads.followUpAt, assignee: users.name })
          .from(leads)
          .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
          .leftJoin(users, eq(users.id, leads.assignedToId))
          .where(
            and(
              eq(leads.firmId, firmId), isNull(leads.deletedAt), eq(pipelineStages.category, "open"),
              lt(leads.followUpAt, new Date(Date.now() + 864e5)),
              ctx.has("leads:view_all", firmId) ? undefined : eq(leads.assignedToId, ctx.user.id),
            ),
          )
          .orderBy(asc(leads.followUpAt))
          .limit(10),
      )
    : [];
  return { summary, byStage: byStage.map((s) => ({ ...s, n: Number(s.n) })), workload, followUps: overdue };
}

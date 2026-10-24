import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, min, or, sql } from "drizzle-orm";
import type { AccessContext } from "../../access/context";
import { withScope } from "../../db/client";
import { intakeItems, leads, matterDates, matters, matterStages, pipelineStages, proposals } from "../../db/schema";
import { inboxReach } from "../email/access";
import { listInbox, unreadCount } from "../email/mail";
import { canViewMatters, matterVisibility } from "../matters/matters";
import { listTasks } from "../tasks/tasks";

/**
 * "My day": what needs this person now, across every practice they belong to.
 * Only real records; each section is left out when the person has no access
 * to it, rather than shown as zero.
 */

export type DayPractice = { firmId: string; name: string; slug: string; brandColor: string };

export type MyDay = {
  inbox: {
    unread: number;
    mine: { id: string; subject: string; who: string; lastMessageAt: Date | null; unread: boolean; practice: string | null; practiceSlug: string | null; practiceColor: string | null; preview: string | null }[];
    unassignedOpen: number;
  } | null;
  followUps: { id: string; ref: string; name: string; followUpAt: Date; firm: DayPractice; overdue: boolean }[] | null;
  reviews: { id: string; ref: string; title: string; recipient: string; submittedAt: Date | null; firm: DayPractice }[] | null;
  changes: { id: string; ref: string; title: string; note: string | null; firm: DayPractice }[] | null;
  intake: { waiting: number; held: number; oldest: Date | null } | null;
  practices: (DayPractice & { openLeads: number | null; followUpsDue: number | null; proposalsOut: number | null; inReview: number | null; openMatters: number | null })[];
  /** My open tasks that are overdue, due by the end of tomorrow, or whose reminder has come. */
  tasks: { id: string; title: string; dueAt: Date | null; allDay: boolean; priority: string; overdue: boolean; reminded: boolean; firm: DayPractice | null; matterId: string | null; matterRef: string | null }[];
  /** Deadlines and expiry dates in the next 14 days on matters I'm on the team for. */
  deadlines: { id: string; label: string; kind: string; dueOn: string; matterId: string; matterRef: string; firm: DayPractice }[] | null;
};

function endOfTomorrow(now = new Date()) {
  return new Date(now.getTime() + 36 * 3600_000);
}

export async function myDay(ctx: AccessContext): Promise<MyDay> {
  const firmsList = [...ctx.firms.values()]
    .filter((f) => f.permissions.has("firm:view"))
    .sort((a, b) => a.tradingName.localeCompare(b.tradingName))
    .map((f) => ({ firmId: f.firmId, name: f.tradingName, slug: f.slug, brandColor: f.brandColor }));
  const horizon = endOfTomorrow();
  const now = new Date();

  // Inbox
  const reach = inboxReach(ctx);
  let inbox: MyDay["inbox"] = null;
  if (reach.hub || reach.firmIds.length) {
    const [unread, mine, unassigned] = await Promise.all([
      unreadCount(ctx).catch(() => 0),
      listInbox(ctx, { assignee: "me", status: "open" }).catch(() => []),
      listInbox(ctx, { assignee: "unassigned", status: "open" }).catch(() => []),
    ]);
    inbox = {
      unread,
      unassignedOpen: unassigned.length,
      mine: mine.slice(0, 5).map((t) => ({
        id: t.id, subject: t.subject, who: t.counterpartName || t.counterpartEmail || "Unknown sender", lastMessageAt: t.lastMessageAt,
        unread: t.unread, practice: t.firmName ?? (t.firmId ? null : "Hub"), practiceSlug: t.firmSlug, practiceColor: t.firmColor, preview: t.preview,
      })),
    };
  }

  // Follow-ups assigned to me, and per-practice counts
  const leadFirms = firmsList.filter((f) => ctx.has("leads:view_all", f.firmId) || ctx.has("leads:view_assigned", f.firmId));
  const proposalFirms = firmsList.filter((f) => ctx.has("proposals:view", f.firmId));
  const approveFirms = proposalFirms.filter((f) => ctx.has("proposals:approve", f.firmId));

  const followUps: NonNullable<MyDay["followUps"]> = [];
  const counts = new Map<string, { openLeads: number | null; followUpsDue: number | null; proposalsOut: number | null; inReview: number | null; openMatters: number | null }>();
  for (const f of firmsList) counts.set(f.firmId, { openLeads: null, followUpsDue: null, proposalsOut: null, inReview: null, openMatters: null });

  await Promise.all(
    leadFirms.map((f) =>
      withScope(ctx.scopeFor(f.firmId), async (tx) => {
        const visible = ctx.has("leads:view_all", f.firmId) ? undefined : eq(leads.assignedToId, ctx.user.id);
        const base = and(eq(leads.firmId, f.firmId), isNull(leads.deletedAt), eq(pipelineStages.category, "open"), visible);
        const [open] = await tx.select({ n: count() }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId)).where(base);
        const [due] = await tx.select({ n: count() }).from(leads).innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId)).where(and(base, lt(leads.followUpAt, horizon)));
        const mine = await tx
          .select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, followUpAt: leads.followUpAt })
          .from(leads)
          .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
          .where(and(eq(leads.firmId, f.firmId), isNull(leads.deletedAt), eq(pipelineStages.category, "open"), eq(leads.assignedToId, ctx.user.id), lt(leads.followUpAt, horizon)))
          .orderBy(asc(leads.followUpAt))
          .limit(8);
        const c = counts.get(f.firmId)!;
        c.openLeads = Number(open?.n ?? 0);
        c.followUpsDue = Number(due?.n ?? 0);
        for (const l of mine) {
          if (!l.followUpAt) continue;
          followUps.push({ id: l.id, ref: l.ref, name: [l.firstName, l.lastName].filter(Boolean).join(" "), followUpAt: l.followUpAt, firm: f, overdue: l.followUpAt < now });
        }
      }),
    ),
  );

  const reviews: NonNullable<MyDay["reviews"]> = [];
  const changes: NonNullable<MyDay["changes"]> = [];
  await Promise.all(
    proposalFirms.map((f) =>
      withScope(ctx.scopeFor(f.firmId), async (tx) => {
        const byStatus = await tx
          .select({ status: proposals.status, n: count() })
          .from(proposals)
          .where(and(eq(proposals.firmId, f.firmId), inArray(proposals.status, ["in_review", "released"])))
          .groupBy(proposals.status);
        const c = counts.get(f.firmId)!;
        c.inReview = Number(byStatus.find((r) => r.status === "in_review")?.n ?? 0);
        c.proposalsOut = Number(byStatus.find((r) => r.status === "released")?.n ?? 0);
        if (approveFirms.includes(f)) {
          const rows = await tx
            .select({ id: proposals.id, ref: proposals.ref, title: proposals.title, recipient: proposals.recipientName, submittedAt: proposals.submittedAt })
            .from(proposals)
            .where(and(eq(proposals.firmId, f.firmId), eq(proposals.status, "in_review")))
            .orderBy(asc(proposals.submittedAt))
            .limit(5);
          for (const r of rows) reviews.push({ ...r, firm: f });
        }
        const back = await tx
          .select({ id: proposals.id, ref: proposals.ref, title: proposals.title, note: proposals.reviewNote })
          .from(proposals)
          .where(and(eq(proposals.firmId, f.firmId), eq(proposals.status, "changes_requested"), eq(proposals.createdById, ctx.user.id)))
          .orderBy(desc(proposals.updatedAt))
          .limit(5);
        for (const r of back) changes.push({ ...r, firm: f });
      }),
    ),
  );

  let intake: MyDay["intake"] = null;
  if (ctx.has("intake:view")) {
    intake = await withScope({ orgId: ctx.orgId, userId: ctx.user.id, firmIds: [], intake: true }, async (tx) => {
      const rows = await tx
        .select({ status: intakeItems.status, n: count(), oldest: min(intakeItems.receivedAt) })
        .from(intakeItems)
        .where(and(eq(intakeItems.orgId, ctx.orgId), inArray(intakeItems.status, ["new", "held"])))
        .groupBy(intakeItems.status);
      const waiting = Number(rows.find((r) => r.status === "new")?.n ?? 0);
      const held = Number(rows.find((r) => r.status === "held")?.n ?? 0);
      const oldest = rows.map((r) => r.oldest).filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0] ?? null;
      return { waiting, held, oldest };
    });
  }

  // Matters: open counts per practice, and my deadlines in the next 14 days
  const deadlines: NonNullable<MyDay["deadlines"]> = [];
  const matterFirms = firmsList.filter((f) => canViewMatters(ctx, f.firmId));
  const in14 = new Date(now.getTime() + 14 * 864e5).toISOString().slice(0, 10);
  await Promise.all(
    matterFirms.map((f) =>
      withScope(ctx.scopeFor(f.firmId), async (tx) => {
        const [open] = await tx.select({ n: count() }).from(matters).innerJoin(matterStages, eq(matterStages.id, matters.stageId)).where(and(...matterVisibility(ctx, f.firmId), sql`${matterStages.category} <> 'closed'`));
        counts.get(f.firmId)!.openMatters = Number(open?.n ?? 0);
        const rows = await tx
          .select({ id: matterDates.id, label: matterDates.label, kind: matterDates.kind, dueOn: matterDates.dueOn, matterId: matters.id, matterRef: matters.ref })
          .from(matterDates)
          .innerJoin(matters, eq(matters.id, matterDates.matterId))
          .where(and(...matterVisibility(ctx, f.firmId), isNull(matterDates.completedAt), lte(matterDates.dueOn, in14), or(eq(matters.caseManagerId, ctx.user.id), eq(matters.consultantId, ctx.user.id), sql`exists (select 1 from matter_members mm where mm.matter_id = ${matters.id} and mm.user_id = ${ctx.user.id})`)))
          .orderBy(asc(matterDates.dueOn))
          .limit(10);
        for (const r of rows) deadlines.push({ ...r, firm: f });
      }),
    ),
  );
  deadlines.sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  // My tasks
  const firmById = new Map(firmsList.map((f) => [f.firmId, f]));
  const myTasks = (await listTasks(ctx, { view: "mine", status: "open" }).catch(() => []))
    .filter((t) => (t.dueAt && t.dueAt < horizon) || (t.reminderAt && t.reminderAt <= now))
    .slice(0, 10)
    .map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, allDay: t.allDay, priority: t.priority, overdue: !!t.dueAt && t.dueAt < now, reminded: !!t.reminderAt && t.reminderAt <= now, firm: t.firmId ? firmById.get(t.firmId) ?? null : null, matterId: t.matterId, matterRef: t.matterRef }));

  followUps.sort((a, b) => +a.followUpAt - +b.followUpAt);
  reviews.sort((a, b) => +(a.submittedAt ?? 0) - +(b.submittedAt ?? 0));

  return {
    inbox,
    followUps: leadFirms.length ? followUps.slice(0, 8) : null,
    reviews: approveFirms.length ? reviews : null,
    changes: proposalFirms.length ? changes : null,
    intake,
    practices: firmsList.map((f) => ({ ...f, ...counts.get(f.firmId)! })),
    tasks: myTasks,
    deadlines: matterFirms.length ? deadlines.slice(0, 10) : null,
  };
}

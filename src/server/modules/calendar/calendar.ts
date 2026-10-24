import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { activities, calendarEvents, clients, leads, matterDates, matters, pipelineStages, tasks, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { optionalText, optionalUuid, parseOrThrow } from "../../validation";

/**
 * The calendar: events people create (consultations, appointments…) plus
 * dates that live elsewhere (task due dates, matter deadlines, expiry and
 * submission dates, lead follow-ups). Only events are stored here; the rest
 * are read from their own records so there is one source of truth.
 */

export type CalendarItem = {
  key: string;
  source: "event" | "task" | "deadline" | "expiry" | "submission" | "date" | "follow_up";
  title: string;
  start: string; // ISO timestamp, or YYYY-MM-DD for all-day dates
  end: string | null;
  allDay: boolean;
  kind: string;
  timeZone: string | null;
  firmId: string | null;
  firmName: string | null;
  firmSlug: string | null;
  firmColor: string | null;
  href: string | null;
  detail: string | null;
  done: boolean;
  eventId?: string;
};

const KINDS = ["consultation", "appointment", "biometrics", "interview", "submission", "meeting", "other"] as const;

function validZone(z: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

const isoTimestamp = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), "Enter a valid date and time.").transform((v) => new Date(v));

const eventSchema = z.object({
  title: z.string().trim().min(2, "Name the event.").max(200),
  kind: z.enum(KINDS).default("appointment"),
  startsAt: isoTimestamp,
  endsAt: z.union([z.literal(""), isoTimestamp]).optional().transform((v) => (v ? v : undefined)),
  allDay: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  timeZone: z.string().trim().min(1).max(64).refine(validZone, "Choose a valid time zone.").default("Africa/Johannesburg"),
  location: optionalText(300),
  notes: optionalText(4000),
  firmId: optionalUuid,
  matterId: optionalUuid,
  clientId: optionalUuid,
  leadId: optionalUuid,
});

async function checkLinks(tx: Tx, ctx: AccessContext, input: z.infer<typeof eventSchema>) {
  const firmId = input.firmId ?? null;
  const links = [input.matterId, input.clientId, input.leadId].filter(Boolean);
  if (links.length > 1) throw new ValidationError("Link an event to one record at most.");
  if (!firmId) {
    if (links.length) throw new ValidationError("Choose the practice the linked record belongs to.", { firmId: "Choose a practice." });
    return;
  }
  if (!ctx.has("firm:view", firmId)) throw new AccessDeniedError("firm:view");
  if (input.matterId) {
    const { loadVisibleMatter } = await import("../matters/matters");
    await loadVisibleMatter(tx, ctx, firmId, input.matterId);
  }
  if (input.clientId) {
    const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.firmId, firmId), isNull(clients.deletedAt)));
    if (!c) throw new ValidationError("Choose a client from this practice.");
  }
  if (input.leadId) {
    const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, input.leadId), eq(leads.firmId, firmId), isNull(leads.deletedAt)));
    if (!l) throw new ValidationError("Choose a lead from this practice.");
  }
}

async function logOnSubject(tx: Tx, ctx: AccessContext, e: typeof calendarEvents.$inferSelect, body: string) {
  if (!e.firmId) return;
  if (e.matterId) {
    const [m] = await tx.select({ clientId: matters.clientId }).from(matters).where(eq(matters.id, e.matterId));
    if (m) await tx.insert(activities).values({ firmId: e.firmId, clientId: m.clientId, matterId: e.matterId, type: "event", body, actorId: ctx.user.id });
  } else if (e.clientId || e.leadId) {
    await tx.insert(activities).values({ firmId: e.firmId, clientId: e.clientId, leadId: e.leadId, type: "event", body, actorId: ctx.user.id });
  }
}

export async function createEvent(ctx: AccessContext, raw: unknown) {
  const input = parseOrThrow(eventSchema, raw);
  if (input.endsAt && input.endsAt < input.startsAt) throw new ValidationError("The end must be after the start.", { endsAt: "Ends before it starts." });
  return withScope(ctx.scopeForAllFirms(), async (tx) => {
    await checkLinks(tx, ctx, input);
    const [e] = await tx
      .insert(calendarEvents)
      .values({
        orgId: ctx.orgId, firmId: input.firmId ?? null, kind: input.kind, title: input.title, startsAt: input.startsAt, endsAt: input.endsAt ?? null, allDay: input.allDay,
        timeZone: input.timeZone, location: input.location ?? null, notes: input.notes ?? null, matterId: input.matterId ?? null, clientId: input.clientId ?? null,
        leadId: input.leadId ?? null, organiserId: ctx.user.id, createdById: ctx.user.id,
      })
      .returning();
    await logOnSubject(tx, ctx, e, `${e.kind[0].toUpperCase()}${e.kind.slice(1)} scheduled: ${e.title}`);
    if (e.firmId) await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: e.firmId, action: "event.created", entityType: "calendar_event", entityId: e.id, summary: `Scheduled "${e.title}"`, ip: ctx.ip }, tx);
    return e;
  });
}

async function loadEvent(tx: Tx, ctx: AccessContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Event");
  const [e] = await tx.select().from(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.orgId, ctx.orgId), isNull(calendarEvents.cancelledAt))).for("update");
  if (!e) throw new NotFoundError("Event");
  if (e.firmId && !ctx.has("firm:view", e.firmId)) throw new NotFoundError("Event");
  if (e.externalSource) throw new ValidationError("This event comes from a connected calendar; change it there.");
  return e;
}

export async function updateEvent(ctx: AccessContext, id: string, raw: unknown) {
  const input = parseOrThrow(eventSchema, raw);
  if (input.endsAt && input.endsAt < input.startsAt) throw new ValidationError("The end must be after the start.", { endsAt: "Ends before it starts." });
  return withScope(ctx.scopeForAllFirms(), async (tx) => {
    const e = await loadEvent(tx, ctx, id);
    if ((input.firmId ?? null) !== e.firmId) throw new ValidationError("An event stays in its practice.");
    await checkLinks(tx, ctx, input);
    const [updated] = await tx
      .update(calendarEvents)
      .set({ kind: input.kind, title: input.title, startsAt: input.startsAt, endsAt: input.endsAt ?? null, allDay: input.allDay, timeZone: input.timeZone, location: input.location ?? null, notes: input.notes ?? null, matterId: input.matterId ?? null, clientId: input.clientId ?? null, leadId: input.leadId ?? null, updatedAt: new Date() })
      .where(eq(calendarEvents.id, e.id))
      .returning();
    if (+e.startsAt !== +updated.startsAt) await logOnSubject(tx, ctx, updated, `Rescheduled: ${updated.title}`);
    return updated;
  });
}

export async function cancelEvent(ctx: AccessContext, id: string) {
  return withScope(ctx.scopeForAllFirms(), async (tx) => {
    const e = await loadEvent(tx, ctx, id);
    await tx.update(calendarEvents).set({ cancelledAt: new Date(), updatedAt: new Date() }).where(eq(calendarEvents.id, e.id));
    await logOnSubject(tx, ctx, e, `Cancelled: ${e.title}`);
    if (e.firmId) await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: e.firmId, action: "event.cancelled", entityType: "calendar_event", entityId: e.id, summary: `Cancelled "${e.title}"`, ip: ctx.ip }, tx);
  });
}

export type CalendarFilters = { from: Date; to: Date; firmId?: string; mine?: boolean };

/** Everything on the calendar between two instants that this person may see. */
export async function listCalendar(ctx: AccessContext, f: CalendarFilters): Promise<CalendarItem[]> {
  if (f.to <= f.from) throw new ValidationError("The range ends before it starts.");
  if (f.to.getTime() - f.from.getTime() > 120 * 864e5) throw new ValidationError("Show at most four months at a time.");
  const memberFirms = ctx.firmIdsWith("firm:view").filter((id) => !f.firmId || f.firmId === id);
  const fromDay = new Date(f.from.getTime() - 864e5).toISOString().slice(0, 10);
  const toDay = new Date(f.to.getTime() + 864e5).toISOString().slice(0, 10);
  const items: CalendarItem[] = [];
  const firmInfo = new Map([...ctx.firms.values()].map((x) => [x.firmId, { name: x.tradingName, slug: x.slug, color: x.brandColor }]));
  const firmOf = (id: string | null) => (id ? firmInfo.get(id) ?? null : null);
  const personalOnly = f.firmId === "personal";

  await withScope(ctx.scopeForAllFirms(), async (tx) => {
    // Events
    const evConds: SQL[] = [eq(calendarEvents.orgId, ctx.orgId), isNull(calendarEvents.cancelledAt), lt(calendarEvents.startsAt, f.to), or(gte(calendarEvents.endsAt, f.from), and(isNull(calendarEvents.endsAt), gte(calendarEvents.startsAt, new Date(f.from.getTime() - 864e5))))!];
    const evScope: SQL[] = [];
    if (!f.firmId || personalOnly) evScope.push(and(isNull(calendarEvents.firmId), eq(calendarEvents.createdById, ctx.user.id))!);
    if (!personalOnly && memberFirms.length) evScope.push(inArray(calendarEvents.firmId, memberFirms));
    if (!evScope.length) return;
    evConds.push(or(...evScope)!);
    if (f.mine) evConds.push(eq(calendarEvents.organiserId, ctx.user.id));
    const evs = await tx
      .select({ e: calendarEvents, organiser: users.name, matterRef: matters.ref })
      .from(calendarEvents)
      .leftJoin(users, eq(users.id, calendarEvents.organiserId))
      .leftJoin(matters, eq(matters.id, calendarEvents.matterId))
      .where(and(...evConds))
      .orderBy(asc(calendarEvents.startsAt));
    for (const { e, organiser, matterRef } of evs) {
      const fi = firmOf(e.firmId);
      items.push({
        key: `e-${e.id}`, eventId: e.id, source: "event", kind: e.kind, title: e.title, start: e.allDay ? e.startsAt.toISOString().slice(0, 10) : e.startsAt.toISOString(),
        end: e.endsAt ? e.endsAt.toISOString() : null, allDay: e.allDay, timeZone: e.timeZone, firmId: e.firmId, firmName: fi?.name ?? null, firmSlug: fi?.slug ?? null, firmColor: fi?.color ?? null,
        href: e.matterId && fi ? `/f/${fi.slug}/matters/${e.matterId}` : e.clientId && fi ? `/f/${fi.slug}/clients/${e.clientId}` : e.leadId && fi ? `/f/${fi.slug}/leads/${e.leadId}` : null,
        detail: [e.location, matterRef, organiser ? `Organiser: ${organiser}` : null].filter(Boolean).join(" · ") || null, done: false,
      });
    }

    // Tasks with a due date
    const taskScope: SQL[] = [eq(tasks.assigneeId, ctx.user.id)];
    if (!f.mine) {
      const team = ctx.firmIdsWith("tasks:view_team").filter((id) => memberFirms.includes(id));
      if (team.length) taskScope.push(inArray(tasks.firmId, team));
    }
    const taskRows = await tx
      .select({ t: tasks })
      .from(tasks)
      .where(and(eq(tasks.orgId, ctx.orgId), sql`${tasks.status} <> 'cancelled'`, gte(tasks.dueAt, f.from), lt(tasks.dueAt, f.to), or(...taskScope), personalOnly ? isNull(tasks.firmId) : f.firmId ? eq(tasks.firmId, f.firmId) : undefined));
    for (const { t } of taskRows) {
      const fi = firmOf(t.firmId);
      items.push({
        key: `t-${t.id}`, source: "task", kind: t.priority, title: t.title, start: t.allDay ? isoDayIn(t.dueAt!) : t.dueAt!.toISOString(), end: null, allDay: t.allDay, timeZone: null,
        firmId: t.firmId, firmName: fi?.name ?? null, firmSlug: fi?.slug ?? null, firmColor: fi?.color ?? null, href: `/tasks?t=${t.id}`, detail: null, done: t.status === "done",
      });
    }

    if (personalOnly || !memberFirms.length) return;
    // Matter dates (deadlines, expiry, submission) in matters the person may see
    const { matterVisibility, canViewMatters } = await import("../matters/matters");
    for (const firmId of memberFirms.filter((id) => canViewMatters(ctx, id))) {
      const fi = firmOf(firmId);
      const rows = await tx
        .select({ d: matterDates, ref: matters.ref, title: matters.title })
        .from(matterDates)
        .innerJoin(matters, eq(matters.id, matterDates.matterId))
        .where(and(eq(matterDates.firmId, firmId), gte(matterDates.dueOn, fromDay), lt(matterDates.dueOn, toDay), ...matterVisibility(ctx, firmId), f.mine ? or(eq(matters.caseManagerId, ctx.user.id), eq(matters.consultantId, ctx.user.id)) : undefined));
      for (const { d, ref, title } of rows) {
        items.push({
          key: `d-${d.id}`, source: d.kind === "other" ? "date" : d.kind, kind: d.kind, title: `${d.label} · ${ref}`, start: d.dueOn, end: null, allDay: true, timeZone: null,
          firmId, firmName: fi?.name ?? null, firmSlug: fi?.slug ?? null, firmColor: fi?.color ?? null, href: `/f/${fi?.slug}/matters/${d.matterId}`,
          detail: `${title}. ${d.basisKind === "calculated" ? "Calculated" : d.basisKind === "adjusted" ? "Adjusted after review" : "Recorded"}: ${d.basis}`, done: !!d.completedAt,
        });
      }
    }
    // Lead follow-ups
    for (const firmId of memberFirms.filter((id) => ctx.has("leads:view_all", id) || ctx.has("leads:view_assigned", id))) {
      const fi = firmOf(firmId);
      const rows = await tx
        .select({ id: leads.id, ref: leads.ref, firstName: leads.firstName, lastName: leads.lastName, followUpAt: leads.followUpAt })
        .from(leads)
        .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
        .where(and(eq(leads.firmId, firmId), isNull(leads.deletedAt), eq(pipelineStages.category, "open"), gte(leads.followUpAt, f.from), lt(leads.followUpAt, f.to), ctx.has("leads:view_all", firmId) && !f.mine ? undefined : eq(leads.assignedToId, ctx.user.id)));
      for (const l of rows) {
        items.push({
          key: `f-${l.id}`, source: "follow_up", kind: "follow_up", title: `Follow up ${[l.firstName, l.lastName].filter(Boolean).join(" ")}`, start: l.followUpAt!.toISOString(), end: null, allDay: false, timeZone: null,
          firmId, firmName: fi?.name ?? null, firmSlug: fi?.slug ?? null, firmColor: fi?.color ?? null, href: `/f/${fi?.slug}/leads/${l.id}`, detail: l.ref, done: false,
        });
      }
    }
  });
  return items.sort((a, b) => a.start.localeCompare(b.start));
}

/** All-day tasks keep the calendar day they were entered for (stored at local noon). */
function isoDayIn(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Options for the event form. */
export function calendarPractices(ctx: AccessContext) {
  return [...ctx.firms.values()].filter((f) => f.permissions.has("firm:view")).map((f) => ({ id: f.firmId, name: f.tradingName, slug: f.slug }));
}


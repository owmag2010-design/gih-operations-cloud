import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Tx } from "../../db/client";
import { activities, clients, firms, leads, matters, matterStages, services, taskTemplates, tasks, users } from "../../db/schema";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../errors";
import { optionalDate, optionalText, optionalUuid, parseOrThrow } from "../../validation";

/**
 * Tasks. A task is personal (no practice: only its owner sees it), a team
 * task (a practice, nobody assigned yet) or assigned to someone; it can link
 * to one matter, client or lead in the same practice.
 */

const PRIORITY = ["low", "normal", "high", "urgent"] as const;
const RECURRENCE = ["none", "daily", "weekly", "monthly", "yearly"] as const;

/** Practices whose tasks this person may see beyond their own. */
function teamFirms(ctx: AccessContext) {
  return ctx.firmIdsWith("tasks:view_team");
}

function visibleTask(ctx: AccessContext): SQL {
  const me = ctx.user.id;
  const team = teamFirms(ctx);
  const memberFirms = ctx.firmIdsWith("firm:view");
  const parts: SQL[] = [eq(tasks.assigneeId, me), eq(tasks.createdById, me)];
  if (team.length) parts.push(inArray(tasks.firmId, team));
  if (memberFirms.length) parts.push(and(inArray(tasks.firmId, memberFirms), isNull(tasks.assigneeId))!);
  return or(...parts)!;
}

function scopeAll(ctx: AccessContext) {
  return ctx.scopeForAllFirms();
}

export type TaskView = "mine" | "team" | "created" | "all";
export type TaskFilters = { view?: TaskView; status?: "open" | "done" | "all"; due?: "overdue" | "today" | "week" | "none" | ""; firmId?: string; matterId?: string; clientId?: string; leadId?: string; q?: string };

export async function listTasks(ctx: AccessContext, f: TaskFilters = {}) {
  const conds: SQL[] = [eq(tasks.orgId, ctx.orgId), visibleTask(ctx)];
  const view = f.view ?? "mine";
  if (view === "mine") conds.push(eq(tasks.assigneeId, ctx.user.id));
  else if (view === "created") conds.push(eq(tasks.createdById, ctx.user.id));
  else if (view === "team") conds.push(sql`${tasks.firmId} is not null`);
  if (f.status !== "all") conds.push(eq(tasks.status, f.status === "done" ? "done" : "open"));
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (f.due === "overdue") conds.push(lt(tasks.dueAt, now));
  else if (f.due === "today") conds.push(lte(tasks.dueAt, endOfToday));
  else if (f.due === "week") conds.push(lte(tasks.dueAt, new Date(now.getTime() + 7 * 864e5)));
  else if (f.due === "none") conds.push(isNull(tasks.dueAt));
  if (f.firmId === "personal") conds.push(isNull(tasks.firmId));
  else if (f.firmId && z.string().uuid().safeParse(f.firmId).success) conds.push(eq(tasks.firmId, f.firmId));
  if (f.matterId && z.string().uuid().safeParse(f.matterId).success) conds.push(eq(tasks.matterId, f.matterId));
  if (f.clientId && z.string().uuid().safeParse(f.clientId).success) conds.push(eq(tasks.clientId, f.clientId));
  if (f.leadId && z.string().uuid().safeParse(f.leadId).success) conds.push(eq(tasks.leadId, f.leadId));
  if (f.q?.trim()) {
    const term = `%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(tasks.title, term), ilike(tasks.description, term))!);
  }
  return withScope(scopeAll(ctx), (tx) =>
    tx
      .select({
        id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueAt: tasks.dueAt, allDay: tasks.allDay,
        reminderAt: tasks.reminderAt, recurrence: tasks.recurrence, recurrenceInterval: tasks.recurrenceInterval, completedAt: tasks.completedAt,
        firmId: tasks.firmId, firmName: firms.tradingName, firmSlug: firms.slug, firmColor: firms.brandColor,
        assigneeId: tasks.assigneeId, assigneeName: users.name, createdById: tasks.createdById,
        matterId: tasks.matterId, matterRef: matters.ref, matterTitle: matters.title,
        clientId: tasks.clientId, clientName: sql<string | null>`(select c.first_name || coalesce(' ' || c.last_name, '') from clients c where c.id = ${tasks.clientId})`,
        leadId: tasks.leadId, leadRef: sql<string | null>`(select l.ref from leads l where l.id = ${tasks.leadId})`,
      })
      .from(tasks)
      .leftJoin(firms, eq(firms.id, tasks.firmId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(matters, eq(matters.id, tasks.matterId))
      .where(and(...conds))
      .orderBy(sql`${tasks.status} = 'done'`, sql`${tasks.dueAt} asc nulls last`, desc(sql`array_position(array['low','normal','high','urgent']::lead_priority[], ${tasks.priority})`), desc(tasks.createdAt))
      .limit(300),
  );
}

const taskSchema = z.object({
  title: z.string().trim().min(2, "Describe the task.").max(200),
  description: optionalText(4000),
  firmId: optionalUuid,
  assigneeId: optionalUuid,
  priority: z.enum(PRIORITY).default("normal"),
  dueAt: optionalDate,
  allDay: z.union([z.literal("on"), z.literal("true"), z.literal(""), z.literal("false"), z.boolean()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  reminderAt: optionalDate,
  recurrence: z.enum(RECURRENCE).default("none"),
  recurrenceInterval: z.coerce.number().int().min(1, "At least 1.").max(365).default(1),
  matterId: optionalUuid,
  clientId: optionalUuid,
  leadId: optionalUuid,
});

type TaskInput = z.infer<typeof taskSchema>;

async function assertMember(tx: Tx, firmId: string, userId: string) {
  const res = await tx.execute(sql`select 1 from firm_memberships m join users u on u.id = m.user_id
    where m.firm_id = ${firmId} and m.user_id = ${userId} and m.status = 'active' and u.status = 'active'`);
  if (!res.rows.length) throw new ValidationError("Choose a member of this practice.", { assigneeId: "Choose a member of this practice." });
}

/** Check the practice, assignee and linked record; returns normalised values. */
async function checkTask(tx: Tx, ctx: AccessContext, input: TaskInput) {
  const firmId = input.firmId ?? null;
  const links = [input.matterId, input.clientId, input.leadId].filter(Boolean);
  if (links.length > 1) throw new ValidationError("Link a task to one record at most.");
  if (!firmId) {
    if (links.length) throw new ValidationError("Choose the practice the linked record belongs to.", { firmId: "Choose a practice." });
    if (input.assigneeId && input.assigneeId !== ctx.user.id) throw new ValidationError("Personal tasks can only be assigned to you.", { assigneeId: "Choose a practice to assign this to someone else." });
    return { firmId: null, assigneeId: ctx.user.id, matterId: null, clientId: null, leadId: null };
  }
  if (!ctx.has("firm:view", firmId)) throw new AccessDeniedError("firm:view");
  if (input.assigneeId) await assertMember(tx, firmId, input.assigneeId);
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
  return { firmId, assigneeId: input.assigneeId ?? null, matterId: input.matterId ?? null, clientId: input.clientId ?? null, leadId: input.leadId ?? null };
}

async function logOnSubject(tx: Tx, ctx: AccessContext, t: { firmId: string | null; matterId: string | null; clientId: string | null; leadId: string | null }, body: string) {
  if (!t.firmId) return;
  if (t.matterId) {
    const [m] = await tx.select({ clientId: matters.clientId }).from(matters).where(eq(matters.id, t.matterId));
    if (m) await tx.insert(activities).values({ firmId: t.firmId, clientId: m.clientId, matterId: t.matterId, type: "task", body, actorId: ctx.user.id });
  } else if (t.clientId || t.leadId) {
    await tx.insert(activities).values({ firmId: t.firmId, clientId: t.clientId, leadId: t.leadId, type: "task", body, actorId: ctx.user.id });
  }
}

export async function createTask(ctx: AccessContext, raw: unknown) {
  const input = parseOrThrow(taskSchema, raw);
  if (input.recurrence !== "none" && !input.dueAt) throw new ValidationError("Repeating tasks need a due date.", { dueAt: "Set when the first one is due." });
  return withScope(scopeAll(ctx), async (tx) => {
    const v = await checkTask(tx, ctx, input);
    const [task] = await tx
      .insert(tasks)
      .values({
        orgId: ctx.orgId, ...v, title: input.title, description: input.description ?? null, priority: input.priority, dueAt: input.dueAt ?? null, allDay: input.allDay,
        reminderAt: input.reminderAt ?? null, recurrence: input.recurrence, recurrenceInterval: input.recurrenceInterval, createdById: ctx.user.id,
      })
      .returning();
    await logOnSubject(tx, ctx, task, `Task added: ${task.title}`);
    if (task.firmId) await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: task.firmId, action: "task.created", entityType: "task", entityId: task.id, summary: `Created task "${task.title}"`, ip: ctx.ip }, tx);
    return task;
  });
}

async function loadEditable(tx: Tx, ctx: AccessContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Task");
  const [t] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.orgId, ctx.orgId), visibleTask(ctx))).for("update");
  if (!t) throw new NotFoundError("Task");
  return t;
}

export async function updateTask(ctx: AccessContext, id: string, raw: unknown) {
  const input = parseOrThrow(taskSchema, raw);
  return withScope(scopeAll(ctx), async (tx) => {
    const t = await loadEditable(tx, ctx, id);
    if ((input.firmId ?? null) !== t.firmId) throw new ValidationError("A task stays in its practice. Create a new task for another practice.");
    const v = await checkTask(tx, ctx, input);
    const [task] = await tx
      .update(tasks)
      .set({ ...v, title: input.title, description: input.description ?? null, priority: input.priority, dueAt: input.dueAt ?? null, allDay: input.allDay, reminderAt: input.reminderAt ?? null, recurrence: input.recurrence, recurrenceInterval: input.recurrenceInterval, updatedAt: new Date() })
      .where(eq(tasks.id, t.id))
      .returning();
    if (t.assigneeId !== task.assigneeId) {
      const [u] = task.assigneeId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, task.assigneeId)) : [{ name: "the team" }];
      await logOnSubject(tx, ctx, task, `Task "${task.title}" assigned to ${u?.name ?? "the team"}`);
    }
    return task;
  });
}

function nextDue(d: Date, rec: (typeof RECURRENCE)[number], n: number) {
  const x = new Date(d);
  if (rec === "daily") x.setUTCDate(x.getUTCDate() + n);
  else if (rec === "weekly") x.setUTCDate(x.getUTCDate() + 7 * n);
  else if (rec === "monthly") x.setUTCMonth(x.getUTCMonth() + n);
  else if (rec === "yearly") x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
}

/** Complete a task; a repeating task creates its next occurrence. */
export async function completeTask(ctx: AccessContext, id: string) {
  return withScope(scopeAll(ctx), async (tx) => {
    const t = await loadEditable(tx, ctx, id);
    if (t.status !== "open") return { task: t, next: null };
    const [task] = await tx.update(tasks).set({ status: "done", completedAt: new Date(), completedById: ctx.user.id, updatedAt: new Date() }).where(eq(tasks.id, t.id)).returning();
    let next = null;
    if (t.recurrence !== "none" && t.dueAt) {
      const due = nextDue(t.dueAt, t.recurrence, t.recurrenceInterval);
      const reminder = t.reminderAt ? new Date(due.getTime() - (t.dueAt.getTime() - t.reminderAt.getTime())) : null;
      [next] = await tx
        .insert(tasks)
        .values({
          orgId: t.orgId, firmId: t.firmId, title: t.title, description: t.description, priority: t.priority, dueAt: due, allDay: t.allDay, reminderAt: reminder,
          recurrence: t.recurrence, recurrenceInterval: t.recurrenceInterval, assigneeId: t.assigneeId, matterId: t.matterId, clientId: t.clientId, leadId: t.leadId,
          previousId: t.id, createdById: t.createdById,
        })
        .returning();
    }
    await logOnSubject(tx, ctx, t, `Task done: ${t.title}`);
    return { task, next };
  });
}

export async function reopenTask(ctx: AccessContext, id: string) {
  return withScope(scopeAll(ctx), async (tx) => {
    const t = await loadEditable(tx, ctx, id);
    const [task] = await tx.update(tasks).set({ status: "open", completedAt: null, completedById: null, updatedAt: new Date() }).where(eq(tasks.id, t.id)).returning();
    return task;
  });
}

export async function cancelTask(ctx: AccessContext, id: string) {
  return withScope(scopeAll(ctx), async (tx) => {
    const t = await loadEditable(tx, ctx, id);
    if (t.firmId && t.createdById !== ctx.user.id && t.assigneeId !== ctx.user.id && !ctx.has("firm:manage", t.firmId)) throw new AccessDeniedError("firm:manage");
    const [task] = await tx.update(tasks).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tasks.id, t.id)).returning();
    await logOnSubject(tx, ctx, t, `Task cancelled: ${t.title}`);
    return task;
  });
}

/** Take an unassigned team task. */
export async function claimTask(ctx: AccessContext, id: string) {
  return withScope(scopeAll(ctx), async (tx) => {
    const t = await loadEditable(tx, ctx, id);
    if (!t.firmId) return t;
    if (t.assigneeId) throw new ValidationError("Someone already has this task.");
    const [task] = await tx.update(tasks).set({ assigneeId: ctx.user.id, updatedAt: new Date() }).where(eq(tasks.id, t.id)).returning();
    await logOnSubject(tx, ctx, t, `${ctx.user.name} took the task "${t.title}"`);
    return task;
  });
}

/** Reminders due now for this person (shown on My day and in the Tasks badge). */
export async function dueReminders(ctx: AccessContext) {
  return withScope(scopeAll(ctx), (tx) =>
    tx
      .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, reminderAt: tasks.reminderAt, priority: tasks.priority, firmName: firms.tradingName, firmSlug: firms.slug })
      .from(tasks)
      .leftJoin(firms, eq(firms.id, tasks.firmId))
      .where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.assigneeId, ctx.user.id), eq(tasks.status, "open"), lte(tasks.reminderAt, new Date())))
      .orderBy(asc(tasks.reminderAt))
      .limit(20),
  );
}

export async function taskCounts(ctx: AccessContext) {
  return withScope(scopeAll(ctx), async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${tasks.status} = 'open')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} < ${now})::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.assigneeId, ctx.user.id)));
    return { open: Number(row?.open ?? 0), overdue: Number(row?.overdue ?? 0) };
  });
}

/** People who can be assigned tasks in each practice the person belongs to. */
export async function taskFormOptions(ctx: AccessContext) {
  const firmIds = ctx.firmIdsWith("firm:view");
  if (!firmIds.length) return { practices: [], people: [] as { firmId: string; id: string; name: string }[] };
  return withScope(scopeAll(ctx), async (tx) => {
    const people = await tx.execute<{ firm_id: string; id: string; name: string }>(sql`select m.firm_id, u.id, u.name from firm_memberships m join users u on u.id = m.user_id
      where m.firm_id = any(${`{${firmIds.join(",")}}`}::uuid[]) and m.status = 'active' and u.status = 'active' order by u.name`);
    const practices = [...ctx.firms.values()].filter((f) => firmIds.includes(f.firmId)).map((f) => ({ id: f.firmId, name: f.tradingName, slug: f.slug }));
    return { practices, people: people.rows.map((r) => ({ firmId: r.firm_id, id: r.id, name: r.name })) };
  });
}

/* ───────── Templates ───────── */

/**
 * Create tasks from the practice's templates when a matter opens (stageId
 * null) or reaches a stage. Each template creates at most one task per matter.
 */
export async function applyTaskTemplates(tx: Tx, ctx: AccessContext, matter: typeof matters.$inferSelect, stageId: string | null) {
  const conds: SQL[] = [eq(taskTemplates.firmId, matter.firmId), eq(taskTemplates.isActive, true), stageId ? eq(taskTemplates.stageId, stageId) : isNull(taskTemplates.stageId)];
  conds.push(matter.serviceId ? or(isNull(taskTemplates.serviceId), eq(taskTemplates.serviceId, matter.serviceId))! : isNull(taskTemplates.serviceId));
  const list = await tx.select().from(taskTemplates).where(and(...conds)).orderBy(asc(taskTemplates.position));
  let created = 0;
  for (const t of list) {
    const assignee = t.assignTo === "case_manager" ? matter.caseManagerId : t.assignTo === "consultant" ? matter.consultantId : null;
    const due = t.dueOffsetDays === null ? null : new Date(Date.now() + t.dueOffsetDays * 864e5);
    const res = await tx
      .insert(tasks)
      .values({ orgId: ctx.orgId, firmId: matter.firmId, title: t.title, description: t.description, priority: t.priority, dueAt: due, allDay: true, assigneeId: assignee, matterId: matter.id, templateId: t.id, createdById: ctx.user.id })
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    created += res.length;
  }
  if (created) await tx.insert(activities).values({ firmId: matter.firmId, clientId: matter.clientId, matterId: matter.id, type: "task", body: `${created} task${created === 1 ? "" : "s"} added from the practice's templates`, actorId: ctx.user.id });
  return created;
}

const templateSchema = z.object({
  title: z.string().trim().min(2, "Describe the task.").max(200),
  description: optionalText(2000),
  serviceId: optionalUuid,
  stageId: optionalUuid,
  priority: z.enum(PRIORITY).default("normal"),
  dueOffsetDays: z.union([z.literal(""), z.coerce.number().int().min(0).max(365)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  assignTo: z.enum(["case_manager", "consultant", "unassigned"]).default("case_manager"),
});

export async function listTaskTemplates(ctx: AccessContext, firmId: string) {
  ctx.require("firm:view", firmId);
  return withScope(ctx.scopeFor(firmId), (tx) =>
    tx
      .select({ t: taskTemplates, serviceName: services.name, stageName: matterStages.name })
      .from(taskTemplates)
      .leftJoin(services, eq(services.id, taskTemplates.serviceId))
      .leftJoin(matterStages, eq(matterStages.id, taskTemplates.stageId))
      .where(eq(taskTemplates.firmId, firmId))
      .orderBy(asc(matterStages.position), asc(taskTemplates.position))
      .then((rows) => rows.map((r) => ({ ...r.t, serviceName: r.serviceName, stageName: r.stageName }))),
  );
}

export async function saveTaskTemplate(ctx: AccessContext, firmId: string, templateId: string | null, raw: unknown) {
  ctx.require("firm:manage", firmId);
  const input = parseOrThrow(templateSchema, raw);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    if (input.stageId) {
      const [s] = await tx.select({ id: matterStages.id }).from(matterStages).where(and(eq(matterStages.id, input.stageId), eq(matterStages.firmId, firmId)));
      if (!s) throw new ValidationError("Choose a stage from this practice.", { stageId: "Choose a stage." });
    }
    const values = { ...input, serviceId: input.serviceId ?? null, stageId: input.stageId ?? null, description: input.description ?? null, updatedAt: new Date() };
    const [t] = templateId
      ? await tx.update(taskTemplates).set(values).where(and(eq(taskTemplates.id, templateId), eq(taskTemplates.firmId, firmId))).returning()
      : await tx.insert(taskTemplates).values({ firmId, ...values }).returning();
    if (!t) throw new NotFoundError("Task template");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId, action: templateId ? "task_template.updated" : "task_template.created", entityType: "task_template", entityId: t.id, summary: `${templateId ? "Updated" : "Added"} task template "${t.title}"`, ip: ctx.ip }, tx);
    return t;
  });
}

export async function setTaskTemplateActive(ctx: AccessContext, firmId: string, templateId: string, active: boolean) {
  ctx.require("firm:manage", firmId);
  return withScope(ctx.scopeFor(firmId), async (tx) => {
    const [t] = await tx.update(taskTemplates).set({ isActive: active, updatedAt: new Date() }).where(and(eq(taskTemplates.id, templateId), eq(taskTemplates.firmId, firmId))).returning();
    if (!t) throw new NotFoundError("Task template");
    return t;
  });
}

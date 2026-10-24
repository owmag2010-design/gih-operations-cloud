"use client";

import { Bell, CalendarClock, Check, Hand, Plus, Repeat, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import type { ActionResult } from "@/server/errors";
import { toast } from "sonner";
import { createTaskAction, taskStatusAction, updateTaskAction } from "@/app/(staff)/work-actions";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, DateTimeInput, fieldError, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, cn, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";

export type TaskRow = {
  id: string; title: string; description: string | null; status: "open" | "done" | "cancelled"; priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null; allDay: boolean; reminderAt: string | null; recurrence: string; recurrenceInterval: number; completedAt: string | null;
  firmId: string | null; firmName: string | null; firmSlug: string | null; assigneeId: string | null; assigneeName: string | null; createdById: string;
  matterId: string | null; matterRef: string | null; matterTitle: string | null; clientId: string | null; clientName: string | null; leadId: string | null; leadRef: string | null;
};

export type TaskOptions = { practices: { id: string; name: string; slug: string }[]; people: { firmId: string; id: string; name: string }[] };

const PRIORITY_TONE = { low: "neutral", normal: "outline", high: "warn", urgent: "danger" } as const;

/** Date-only input that submits the chosen day at local noon, so the day never shifts between time zones. */
function DayInput({ id, name, defaultValue }: { id: string; name: string; defaultValue?: string | null }) {
  const initial = defaultValue ? toLocalDay(new Date(defaultValue)) : "";
  const [day, setDay] = useState(initial);
  const iso = day ? new Date(`${day}T12:00`).toISOString() : "";
  return (
    <>
      <Input id={id} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
function toLocalDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Create or edit a task. `fixed` pins the practice and linked record (e.g. from a matter page). */
export function TaskDialog({
  options, task, fixed, trigger, meId,
}: {
  options: TaskOptions;
  task?: TaskRow;
  fixed?: { firmId: string; matterId?: string; clientId?: string; leadId?: string; label?: string };
  trigger?: React.ReactNode;
  meId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = task ? await updateTaskAction(task.id, prev, form) : await createTaskAction(prev, form);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  const [firmId, setFirmId] = useState(task?.firmId ?? fixed?.firmId ?? "");
  const [allDay, setAllDay] = useState(task ? task.allDay : true);
  const [recurrence, setRecurrence] = useState(task?.recurrence ?? "none");
  const people = useMemo(() => options.people.filter((p) => p.firmId === firmId), [options.people, firmId]);
  const lockedFirm = !!task || !!fixed;
  const id = task?.id ?? "new";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="primary"><Plus /> New task</Button>}</DialogTrigger>
      <DialogContent title={task ? "Edit task" : "New task"} description={fixed?.label ? `For ${fixed.label}` : "Personal tasks are visible only to you. Practice tasks are shared with the team."} wide>
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <Field label="Task" name="title" idPrefix={`t-${id}`} error={fieldError(state, "title")}>
            <Input defaultValue={task?.title} required maxLength={200} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {lockedFirm ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-2">Practice</span>
                <p className="flex h-9 items-center text-sm text-ink">{options.practices.find((p) => p.id === firmId)?.name ?? "Personal (only you)"}</p>
                <input type="hidden" name="firmId" value={firmId} />
              </div>
            ) : (
              <Field label="Practice" name="firmId" idPrefix={`t-${id}`} error={fieldError(state, "firmId")}>
                <Select value={firmId} onChange={(e) => setFirmId(e.target.value)}>
                  <option value="">Personal (only you)</option>
                  {options.practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Assigned to" name="assigneeId" idPrefix={`t-${id}`} error={fieldError(state, "assigneeId")} hint={firmId ? "Leave unassigned to make it a team task anyone can take." : undefined}>
              <Select defaultValue={task ? (task.assigneeId ?? "") : meId} disabled={!firmId} key={firmId}>
                {firmId ? <option value="">Unassigned (team task)</option> : null}
                {(firmId ? people : [{ id: meId, name: "Me", firmId: "" }]).map((p) => <option key={p.id} value={p.id}>{p.id === meId ? `${p.name} (me)` : p.name}</option>)}
              </Select>
            </Field>
          </div>
          {fixed?.matterId ? <input type="hidden" name="matterId" value={fixed.matterId} /> : task?.matterId ? <input type="hidden" name="matterId" value={task.matterId} /> : null}
          {fixed?.clientId ? <input type="hidden" name="clientId" value={fixed.clientId} /> : task?.clientId ? <input type="hidden" name="clientId" value={task.clientId} /> : null}
          {fixed?.leadId ? <input type="hidden" name="leadId" value={fixed.leadId} /> : task?.leadId ? <input type="hidden" name="leadId" value={task.leadId} /> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Priority" name="priority" idPrefix={`t-${id}`}>
              <Select defaultValue={task?.priority ?? "normal"}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor={`t-${id}-due`} className="text-[13px] font-medium text-ink-2">Due</label>
              <div className="flex items-center gap-3">
                <div className="flex-1">{allDay ? <DayInput id={`t-${id}-due`} name="dueAt" defaultValue={task?.dueAt} /> : <DateTimeInput id={`t-${id}-due`} name="dueAt" defaultValue={task?.dueAt} />}</div>
                <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--accent)]" /> All day
                </label>
                <input type="hidden" name="allDay" value={allDay ? "true" : "false"} />
              </div>
              {fieldError(state, "dueAt") ? <p className="text-xs text-danger">{fieldError(state, "dueAt")}</p> : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`t-${id}-rem`} className="text-[13px] font-medium text-ink-2">Remind me</label>
              <DateTimeInput id={`t-${id}-rem`} name="reminderAt" defaultValue={task?.reminderAt} />
            </div>
            <Field label="Repeats" name="recurrence" idPrefix={`t-${id}`} error={fieldError(state, "recurrence")}>
              <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                <option value="none">Doesn&apos;t repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
              </Select>
            </Field>
            {recurrence !== "none" ? (
              <Field label="Every" name="recurrenceInterval" idPrefix={`t-${id}`} error={fieldError(state, "recurrenceInterval")}>
                <Input type="number" min={1} max={365} defaultValue={task?.recurrenceInterval ?? 1} />
              </Field>
            ) : <input type="hidden" name="recurrenceInterval" value="1" />}
          </div>
          <Field label="Details" name="description" idPrefix={`t-${id}`}>
            <Textarea rows={3} defaultValue={task?.description ?? ""} maxLength={4000} />
          </Field>
          <div className="flex justify-end"><SubmitButton>{task ? "Save task" : "Add task"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const UNITS: Record<string, [string, string]> = { daily: ["day", "days"], weekly: ["week", "weeks"], monthly: ["month", "months"], yearly: ["year", "years"] };
function repeatLabel(rec: string, n: number) {
  const u = UNITS[rec];
  return u ? (n > 1 ? `Every ${n} ${u[1]}` : `Every ${u[0]}`) : "";
}

function linkFor(t: TaskRow) {
  if (!t.firmSlug) return null;
  if (t.matterId) return { href: `/f/${t.firmSlug}/matters/${t.matterId}`, label: t.matterRef ?? "Matter" };
  if (t.clientId) return { href: `/f/${t.firmSlug}/clients/${t.clientId}`, label: t.clientName ?? "Client" };
  if (t.leadId) return { href: `/f/${t.firmSlug}/leads/${t.leadId}`, label: t.leadRef ?? "Lead" };
  return null;
}

function TaskItem({ t, options, meId, showPractice }: { t: TaskRow; options: TaskOptions; meId: string; showPractice: boolean }) {
  const [pending, start] = useTransition();
  const done = t.status === "done";
  const overdue = !done && t.dueAt && new Date(t.dueAt) < new Date();
  const link = linkFor(t);
  const act = (a: "complete" | "reopen" | "cancel" | "claim") =>
    start(async () => {
      const r = await taskStatusAction(t.id, a);
      if (r.ok) toast.success(r.message); else toast.error(r.error);
    });
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", done && "opacity-60")} id={`task-${t.id}`}>
      <button
        type="button"
        onClick={() => act(done ? "reopen" : "complete")}
        disabled={pending}
        aria-label={done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
        className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", done ? "border-ok bg-ok text-white" : "border-hairline-strong hover:border-accent")}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium text-ink", done && "line-through")}>{t.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {t.dueAt ? (
            <span className={cn("inline-flex items-center gap-1", overdue && "font-semibold text-danger")}>
              <CalendarClock className="size-3.5" /> {overdue ? "Overdue · " : ""}<LocalTime value={t.dueAt} mode={t.allDay ? "date" : "datetime"} />
            </span>
          ) : null}
          {t.recurrence !== "none" ? <span className="inline-flex items-center gap-1"><Repeat className="size-3.5" /> {repeatLabel(t.recurrence, t.recurrenceInterval)}</span> : null}
          {t.reminderAt && !done ? <span className="inline-flex items-center gap-1"><Bell className="size-3.5" /> <LocalTime value={t.reminderAt} /></span> : null}
          {showPractice ? <span>{t.firmName ?? "Personal"}</span> : null}
          {link ? <Link href={link.href} className="text-ink-2 underline-offset-2 hover:underline">{link.label}</Link> : null}
          {t.firmId ? <span>{t.assigneeId ? (t.assigneeId === meId ? "You" : t.assigneeName) : "Unassigned"}</span> : null}
        </p>
        {t.description ? <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{t.description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {t.priority !== "normal" ? <Badge tone={PRIORITY_TONE[t.priority]} className="capitalize">{t.priority}</Badge> : null}
        {!done && t.firmId && !t.assigneeId ? <Button size="sm" onClick={() => act("claim")} disabled={pending}><Hand /> Take it</Button> : null}
        {!done ? <TaskDialog options={options} task={t} meId={meId} trigger={<Button size="sm" variant="ghost">Edit</Button>} /> : <Button size="icon" variant="ghost" aria-label="Reopen" onClick={() => act("reopen")}><RotateCcw /></Button>}
        {!done ? <Button size="icon" variant="ghost" aria-label={`Cancel ${t.title}`} onClick={() => { if (window.confirm("Cancel this task?")) act("cancel"); }} disabled={pending}><X /></Button> : null}
      </div>
    </li>
  );
}

export function TaskList({ tasks, options, meId, showPractice = true, empty }: { tasks: TaskRow[]; options: TaskOptions; meId: string; showPractice?: boolean; empty?: React.ReactNode }) {
  if (!tasks.length) return <EmptyState title="No tasks here">{empty ?? "Nothing to do in this view."}</EmptyState>;
  return <ul className="divide-y divide-hairline">{tasks.map((t) => <TaskItem key={t.id} t={t} options={options} meId={meId} showPractice={showPractice} />)}</ul>;
}

"use client";

import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import type { ActionResult } from "@/server/errors";
import { toast } from "sonner";
import { cancelEventAction, createEventAction } from "@/app/(staff)/work-actions";
import { practicePalette } from "@/components/shell/theme";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, DateTimeInput, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, cn, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { CalendarItem } from "@/server/modules/calendar/calendar";

const noop = () => () => {};
const ZONES = ["Africa/Johannesburg", "Africa/Harare", "Australia/Sydney", "Europe/London", "UTC"];

export function EventDialog({ practices, fixed, trigger }: { practices: { id: string; name: string }[]; fixed?: { firmId: string; matterId?: string; clientId?: string; leadId?: string; label?: string }; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await createEventAction(prev, form);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  const [allDay, setAllDay] = useState(false);
  const deviceZone = useSyncExternalStore(noop, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "Africa/Johannesburg");
  const zones = ZONES.includes(deviceZone) ? ZONES : [deviceZone, ...ZONES];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="primary"><CalendarPlus /> New event</Button>}</DialogTrigger>
      <DialogContent title="New calendar event" description={fixed?.label ? `For ${fixed.label}` : "Consultations, appointments, biometrics, interviews and meetings."} wide>
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Title" name="title" idPrefix="ev" error={fieldError(state, "title")}><Input required maxLength={200} autoFocus /></Field>
            <Field label="Type" name="kind" idPrefix="ev">
              <Select defaultValue="consultation">
                <option value="consultation">Consultation</option><option value="appointment">Appointment</option><option value="biometrics">Biometrics</option>
                <option value="interview">Interview</option><option value="submission">Submission</option><option value="meeting">Meeting</option><option value="other">Other</option>
              </Select>
            </Field>
          </div>
          {fixed ? (
            <>
              <input type="hidden" name="firmId" value={fixed.firmId} />
              {fixed.matterId ? <input type="hidden" name="matterId" value={fixed.matterId} /> : null}
              {fixed.clientId ? <input type="hidden" name="clientId" value={fixed.clientId} /> : null}
              {fixed.leadId ? <input type="hidden" name="leadId" value={fixed.leadId} /> : null}
            </>
          ) : (
            <Field label="Practice" name="firmId" idPrefix="ev" hint="Personal events are visible only to you.">
              <Select defaultValue={practices[0]?.id ?? ""}>
                <option value="">Personal (only you)</option>
                {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ev-start" className="text-[13px] font-medium text-ink-2">Starts</label>
              <DateTimeInput id="ev-start" name="startsAt" />
              {fieldError(state, "startsAt") ? <p className="text-xs text-danger">{fieldError(state, "startsAt")}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ev-end" className="text-[13px] font-medium text-ink-2">Ends</label>
              <DateTimeInput id="ev-end" name="endsAt" />
              {fieldError(state, "endsAt") ? <p className="text-xs text-danger">{fieldError(state, "endsAt")}</p> : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Time zone of the event" name="timeZone" idPrefix="ev" hint="Times above are in your device's zone; the event's own zone is shown next to it for others." error={fieldError(state, "timeZone")}>
              <Select defaultValue={deviceZone} key={deviceZone}>{zones.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</Select>
            </Field>
            <label className="mt-7 flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--accent)]" /> All day
              <input type="hidden" name="allDay" value={allDay ? "true" : ""} />
            </label>
          </div>
          <Field label="Location" name="location" idPrefix="ev"><Input maxLength={300} placeholder="e.g. VFS Pretoria, phone, Teams" /></Field>
          <Field label="Notes" name="notes" idPrefix="ev"><Textarea rows={3} maxLength={4000} /></Field>
          <div className="flex justify-end"><SubmitButton>Add to calendar</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SOURCE_LABEL: Record<CalendarItem["source"], string> = {
  event: "Event", task: "Task", deadline: "Deadline", expiry: "Expiry", submission: "Submission", date: "Date", follow_up: "Follow-up",
};

function localDay(item: CalendarItem) {
  if (item.allDay && /^\d{4}-\d{2}-\d{2}$/.test(item.start)) return item.start;
  const d = new Date(item.start);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timeOf(item: CalendarItem) {
  if (item.allDay) return null;
  return new Date(item.start).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function colour(item: CalendarItem) {
  if (item.source === "deadline") return "#b3141f";
  return item.firmSlug ? practicePalette(item.firmSlug, item.firmColor).dark.base : "#1b263b";
}

function ItemChip({ item, compact }: { item: CalendarItem; compact?: boolean }) {
  const [pending, start] = useTransition();
  const t = timeOf(item);
  const body = (
    <span className={cn("flex min-w-0 items-center gap-1.5", item.done && "line-through opacity-60")}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: colour(item) }} aria-hidden="true" />
      {t ? <span className="num shrink-0 text-muted">{t}</span> : null}
      <span className="truncate">{item.title}</span>
    </span>
  );
  if (compact) {
    return item.href ? (
      <Link href={item.href} className="block rounded-md px-1.5 py-0.5 text-[12px] text-ink hover:bg-sunken" title={`${SOURCE_LABEL[item.source]}: ${item.title}`}>{body}</Link>
    ) : (
      <span className="block rounded-md px-1.5 py-0.5 text-[12px] text-ink" title={`${SOURCE_LABEL[item.source]}: ${item.title}`}>{body}</span>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-surface px-3.5 py-2.5">
      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: colour(item) }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{SOURCE_LABEL[item.source]}{item.firmName ? ` · ${item.firmName}` : item.source === "event" || item.source === "task" ? " · Personal" : ""}</p>
        <p className={cn("text-sm font-medium text-ink", item.done && "line-through")}>{item.href ? <Link href={item.href} className="hover:underline">{item.title}</Link> : item.title}</p>
        <p className="text-xs text-muted">
          {t ? `${t}${item.end ? `–${new Date(item.end).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}` : ""}` : "All day"}
          {item.timeZone && !item.allDay && item.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone
            ? ` · ${new Date(item.start).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: item.timeZone })} in ${item.timeZone.split("/").pop()?.replace("_", " ")}`
            : ""}
        </p>
        {item.detail ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{item.detail}</p> : null}
      </div>
      {item.eventId ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
          if (!window.confirm("Cancel this event?")) return;
          const r = await cancelEventAction(item.eventId!);
          if (r.ok) toast.success(r.message); else toast.error(r.error);
        })}>Cancel</Button>
      ) : null}
    </div>
  );
}

/** Month grid (large screens) and agenda (always), in the viewer's own time zone. */
export function CalendarView({ month, items, baseHref }: { month: string; items: CalendarItem[]; baseHref: string }) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday first
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(new Date(Date.UTC(y, m - 1, 1 - startOffset + i)).toISOString().slice(0, 10));
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    if (!client) return map;
    for (const it of items) {
      const k = localDay(it);
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return map;
  }, [items, client]);
  const today = client ? localDay({ start: new Date().toISOString(), allDay: false } as CalendarItem) : "";
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const sep = baseHref.includes("?") ? "&" : "?";
  const title = first.toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
  const agendaDays = days.filter((d) => d.startsWith(month) && (byDay.get(d)?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[28px] text-ink">{title}</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button asChild size="icon" aria-label="Previous month"><Link href={`${baseHref}${sep}m=${prev}`}><ChevronLeft /></Link></Button>
          <Button asChild size="sm"><Link href={baseHref}>Today</Link></Button>
          <Button asChild size="icon" aria-label="Next month"><Link href={`${baseHref}${sep}m=${next}`}><ChevronRight /></Link></Button>
        </div>
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-hairline bg-surface lg:block">
        <div className="grid grid-cols-7 border-b border-hairline bg-sunken text-[12px] font-medium text-muted">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2.5 py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d.startsWith(month);
            return (
              <div key={d} className={cn("min-h-[112px] border-hairline p-1.5", i % 7 !== 6 && "border-r", i < 35 && "border-b", !inMonth && "bg-sunken/50")}>
                <p className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-[12px]", d === today ? "bg-accent font-semibold text-accent-ink" : inMonth ? "text-ink-2" : "text-muted")}>{Number(d.slice(8))}</p>
                <div className="flex flex-col gap-0.5">
                  {list.slice(0, 4).map((it) => <ItemChip key={it.key} item={it} compact />)}
                  {list.length > 4 ? <p className="px-1.5 text-[11px] text-muted">+{list.length - 4} more</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <section aria-label="Agenda" className="flex flex-col gap-4">
        <h3 className="text-[13px] font-medium tracking-[0.12em] text-muted uppercase lg:sr-only">Agenda</h3>
        {!client ? <p className="text-sm text-muted">Loading…</p> : agendaDays.length ? agendaDays.map((d) => (
          <div key={d} className="grid gap-2 sm:grid-cols-[140px_1fr]">
            <p className={cn("text-sm font-semibold", d === today ? "text-accent" : "text-ink")}>{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</p>
            <div className="flex flex-col gap-2">{(byDay.get(d) ?? []).map((it) => <ItemChip key={it.key} item={it} />)}</div>
          </div>
        )) : <p className="rounded-xl border border-dashed border-hairline-strong px-4 py-6 text-sm text-muted">Nothing on the calendar this month.</p>}
      </section>
    </div>
  );
}

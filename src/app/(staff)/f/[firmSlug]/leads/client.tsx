"use client";

import * as Popover from "@radix-ui/react-popover";
import { Bookmark, CalendarDays, ChevronLeft, ChevronRight, Columns3, Rows3, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Checkbox, cn, EmptyState, Field, Input, Select, tableClass as t } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { fullName, PRIORITY_LABELS, PRIORITY_TONE, SOURCE_LABELS, STAGE_TONE } from "@/lib/labels";
import { assignLeadsAction, changeStageAction, deleteLeadsAction, deleteViewAction, saveViewAction } from "../actions";

export type LeadRow = {
  id: string;
  ref: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  currentCountry: string | null;
  destinationCountry: string | null;
  immigrationCategory: string | null;
  source: string;
  priority: string;
  followUpAt: string | null;
  tags: string[];
  createdAt: string;
  stageId: string;
  stageName: string;
  stageCategory: string;
  assigneeId: string | null;
  assigneeName: string | null;
};

type Person = { id: string; name: string };

/* ───────── URL state ───────── */

function useQueryUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return { params, set, pending };
}

export function ViewSwitcher({ current }: { current: string }) {
  const { set } = useQueryUpdater();
  const views = [
    { key: "table", label: "Table", icon: Rows3 },
    { key: "board", label: "Board", icon: Columns3 },
    { key: "calendar", label: "Follow-ups calendar", icon: CalendarDays },
  ];
  return (
    <div role="tablist" aria-label="Lead views" className="flex rounded-md border border-hairline bg-surface p-0.5">
      {views.map((v) => (
        <button
          key={v.key}
          role="tab"
          aria-selected={current === v.key}
          onClick={() => set({ view: v.key === "table" ? null : v.key }, true)}
          className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[13px]", current === v.key ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink")}
        >
          <v.icon className="size-3.5" /> {v.label}
        </button>
      ))}
    </div>
  );
}

export function LeadFilterBar({
  stages, people, tags, views, firmSlug, canSeeAll, canShare, view,
}: {
  stages: { id: string; name: string; category: string }[];
  people: Person[];
  tags: string[];
  views: { id: string; name: string; query: string; mine: boolean; shared: boolean }[];
  firmSlug: string;
  canSeeAll: boolean;
  canShare: boolean;
  view: string;
}) {
  const { params, set, pending } = useQueryUpdater();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set({ q });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["stage", "assignee", "priority", "source", "tag", "followUp", "status", "q"].filter((k) => params.get(k));
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending}>
      <label className="relative w-full sm:w-64">
        <span className="sr-only">Search leads</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, phone, reference" className="h-8 pl-8 text-[13px]" />
      </label>
      {view !== "board" ? (
        <FilterSelect label="Status" value={params.get("status") ?? "open"} onChange={(v) => set({ status: v === "open" ? null : v })} options={[["open", "Open"], ["won", "Converted"], ["lost", "Lost"], ["closed", "Closed"], ["all", "All"]]} />
      ) : null}
      <FilterSelect label="Stage" value={params.get("stage") ?? ""} onChange={(v) => set({ stage: v })} options={[["", "Any stage"], ...stages.map((s) => [s.id, s.name] as [string, string])]} />
      {canSeeAll ? (
        <FilterSelect label="Assigned to" value={params.get("assignee") ?? ""} onChange={(v) => set({ assignee: v })} options={[["", "Anyone"], ["me", "Me"], ["unassigned", "Unassigned"], ...people.map((p) => [p.id, p.name] as [string, string])]} />
      ) : null}
      <FilterSelect label="Priority" value={params.get("priority") ?? ""} onChange={(v) => set({ priority: v })} options={[["", "Any priority"], ...Object.entries(PRIORITY_LABELS)]} />
      <FilterSelect label="Source" value={params.get("source") ?? ""} onChange={(v) => set({ source: v })} options={[["", "Any source"], ...Object.entries(SOURCE_LABELS)]} />
      {view !== "calendar" ? (
        <FilterSelect label="Follow-up" value={params.get("followUp") ?? ""} onChange={(v) => set({ followUp: v })} options={[["", "Any follow-up"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Due in 7 days"], ["none", "No follow-up set"]]} />
      ) : null}
      {tags.length ? <FilterSelect label="Tag" value={params.get("tag") ?? ""} onChange={(v) => set({ tag: v })} options={[["", "Any tag"], ...tags.map((x) => [x, x] as [string, string])]} /> : null}
      {active.length ? (
        <Button size="sm" variant="ghost" onClick={() => router.replace(`${pathname}${params.get("view") ? `?view=${params.get("view")}` : ""}`)}>
          <X /> Clear
        </Button>
      ) : null}
      <SavedViews views={views} firmSlug={firmSlug} canShare={canShare} currentQuery={params.toString()} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col">
      <span className="sr-only">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-8 w-auto max-w-[200px] text-[13px]", value && "border-accent/50 bg-accent-soft/40")}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

function SavedViews({ views, firmSlug, canShare, currentQuery }: { views: { id: string; name: string; query: string; mine: boolean; shared: boolean }[]; firmSlug: string; canShare: boolean; currentQuery: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveViewAction.bind(null, firmSlug, currentQuery), null);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const base = `/f/${firmSlug}/leads`;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" className="ml-auto"><Bookmark /> Saved views{views.length ? ` (${views.length})` : ""}</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-40 w-72 rounded-lg border border-hairline bg-surface p-1.5 shadow-[0_8px_30px_-10px_rgba(36,34,31,.3)]">
          {views.length === 0 ? <p className="px-2 py-2 text-[13px] text-muted">No saved views yet. Set some filters, then save them here.</p> : null}
          <ul>
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1 rounded-md hover:bg-sunken">
                <Link href={`${base}?${v.query}`} className="flex-1 truncate px-2 py-1.5 text-[13px] text-ink">
                  {v.name}{v.shared ? <span className="ml-1.5 text-xs text-muted">shared</span> : null}
                </Link>
                {v.mine ? (
                  <button
                    aria-label={`Delete view ${v.name}`}
                    className="rounded p-1 text-muted hover:text-danger"
                    onClick={async () => {
                      const r = await deleteViewAction(firmSlug, v.id);
                      if (!r.ok) toast.error(r.error);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-hairline pt-1">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <button className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-accent hover:bg-sunken">Save the current filters…</button>
              </DialogTrigger>
              <DialogContent title="Save view" description="Keeps the current filters and view so you can return to them in one click.">
                <form action={action} className="flex flex-col gap-3">
                  <ActionFeedback state={state} />
                  <Field label="Name" name="name"><Input required maxLength={60} placeholder="e.g. My overdue follow-ups" /></Field>
                  {canShare ? <Checkbox name="shared" label="Share with everyone in this firm" /> : null}
                  <div><SubmitButton>Save view</SubmitButton></div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ───────── Table ───────── */

export function LeadsTable({
  firmSlug, rows, total, page, pageSize, stages, people, perms, hasFilters,
}: {
  firmSlug: string;
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  stages: { id: string; name: string }[];
  people: Person[];
  perms: { create: boolean; edit: boolean; assign: boolean; remove: boolean };
  hasFilters: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();
  const { params, set } = useQueryUpdater();
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  useEffect(() => setSelected(new Set()), [ids]);
  const base = `/f/${firmSlug}/leads`;
  const canBulk = perms.edit || perms.assign || perms.remove;
  const allChecked = selected.size > 0 && selected.size === rows.length;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done.");
      else toast.error(r.error);
    });

  const sortHeader = (key: string, label: string) => {
    const activeSort = params.get("sort") ?? "created";
    const dir = params.get("dir") ?? (key === "follow_up" ? "asc" : "desc");
    const isActive = activeSort === key;
    return (
      <button className={cn("inline-flex items-center gap-1 hover:text-ink", isActive && "text-ink")} onClick={() => set({ sort: key, dir: isActive && dir === "desc" ? "asc" : "desc" })} aria-label={`Sort by ${label}`}>
        {label}{isActive ? <span aria-hidden="true">{dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    );
  };

  if (rows.length === 0) {
    return hasFilters ? (
      <EmptyState title="No leads match these filters">Try clearing a filter, or search by email or reference instead.</EmptyState>
    ) : (
      <EmptyState title="No open leads yet" action={perms.create ? <Button asChild variant="primary"><Link href={`${base}/new`}>Add the first lead</Link></Button> : undefined}>
        Leads arrive from the Hub intake queue once an enquiry is routed to this firm, or your team can add them directly.
      </EmptyState>
    );
  }

  return (
    <div>
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-accent-soft/50 px-3 py-2 text-[13px]" role="region" aria-label="Bulk actions">
          <span className="font-medium text-ink">{selected.size} selected</span>
          {perms.assign ? (
            <Select aria-label="Assign selected" className="h-7 w-auto text-[13px]" disabled={busy} value="" onChange={(e) => { const v = e.target.value; if (v) run(() => assignLeadsAction(firmSlug, [...selected], v === "__none" ? null : v)); }}>
              <option value="">Assign to…</option>
              <option value="__none">Nobody (unassign)</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          ) : null}
          {perms.edit ? (
            <Select aria-label="Move selected to stage" className="h-7 w-auto text-[13px]" disabled={busy} value="" onChange={(e) => { const v = e.target.value; if (v) run(() => changeStageAction(firmSlug, [...selected], v)); }}>
              <option value="">Move to stage…</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          ) : null}
          {perms.remove ? (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (confirm(`Delete ${selected.size} lead(s)? They will be removed from lists; the audit trail is kept.`)) run(() => deleteLeadsAction(firmSlug, [...selected])); }}>
              Delete
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      ) : null}
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              {canBulk ? (
                <th className={cn(t.th, "w-9")}>
                  <input type="checkbox" aria-label="Select all on this page" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(ids) : new Set())} className="size-4 accent-[var(--accent)]" />
                </th>
              ) : null}
              <th className={t.th}>{sortHeader("name", "Name")}</th>
              <th className={t.th}>Stage</th>
              <th className={t.th}>Matter</th>
              <th className={t.th}>Assigned to</th>
              <th className={t.th}>{sortHeader("priority", "Priority")}</th>
              <th className={t.th}>{sortHeader("follow_up", "Follow-up")}</th>
              <th className={t.th}>{sortHeader("created", "Received")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.followUpAt && new Date(r.followUpAt) < new Date() && r.stageCategory === "open";
              return (
                <tr key={r.id} className={cn(t.row, selected.has(r.id) && "bg-accent-soft/40")}>
                  {canBulk ? (
                    <td className={t.td}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${fullName(r.firstName, r.lastName)}`}
                        checked={selected.has(r.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })}
                        className="size-4 accent-[var(--accent)]"
                      />
                    </td>
                  ) : null}
                  <td className={t.td}>
                    <Link href={`${base}/${r.id}`} className="font-medium text-ink hover:underline">{fullName(r.firstName, r.lastName)}</Link>
                    <div className="num text-xs text-muted">{r.ref}{r.email ? `, ${r.email}` : r.phone ? `, ${r.phone}` : ""}</div>
                  </td>
                  <td className={t.td}><Badge tone={STAGE_TONE[r.stageCategory]}>{r.stageName}</Badge></td>
                  <td className={cn(t.td, "max-w-[220px]")}>
                    <div className="truncate">{r.immigrationCategory ?? <span className="text-muted/70">Not set</span>}</div>
                    <div className="truncate text-xs text-muted">
                      {[r.currentCountry ? `In ${countryName(r.currentCountry)}` : null, r.destinationCountry ? `to ${countryName(r.destinationCountry)}` : null].filter(Boolean).join(", ")}
                    </div>
                  </td>
                  <td className={t.td}>{r.assigneeName ?? <span className="text-muted/70">Unassigned</span>}</td>
                  <td className={t.td}><Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge></td>
                  <td className={cn(t.td, overdue && "font-medium text-danger")}>{r.followUpAt ? <LocalTime value={r.followUpAt} mode="relative" /> : <span className="text-muted/70">None</span>}</td>
                  <td className={cn(t.td, "text-ink-2")}><LocalTime value={r.createdAt} mode="date" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination total={total} page={page} pageSize={pageSize} onPage={(p) => set({ page: String(p) }, false)} />
    </div>
  );
}

function Pagination({ total, page, pageSize, onPage }: { total: number; page: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-3 py-2.5 text-[13px] text-muted">
      <span className="num">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-ZA")}</span>
      <div className="flex gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /> Previous</Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight /></Button>
      </div>
    </div>
  );
}

/* ───────── Board ───────── */

export function LeadBoard({ firmSlug, stages, rows, canEdit }: { firmSlug: string; stages: { id: string; name: string }[]; rows: LeadRow[]; canEdit: boolean }) {
  const [local, setLocal] = useState(rows);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => setLocal(rows), [rows]);

  const move = async (leadId: string, stageId: string) => {
    const lead = local.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const previous = local;
    setLocal((ls) => ls.map((l) => (l.id === leadId ? { ...l, stageId, stageName: stages.find((s) => s.id === stageId)?.name ?? l.stageName } : l)));
    const r = await changeStageAction(firmSlug, [leadId], stageId);
    if (!r.ok) {
      setLocal(previous);
      toast.error(r.error);
    } else toast.success(r.message);
  };

  if (rows.length === 0) return <EmptyState title="No open leads match these filters" />;

  return (
    <div className="flex gap-3 overflow-x-auto p-3" aria-label="Pipeline board">
      {stages.map((s) => {
        const cards = local.filter((l) => l.stageId === s.id);
        return (
          <section
            key={s.id}
            aria-label={`${s.name}, ${cards.length} leads`}
            onDragOver={(e) => { if (canEdit && dragging) { e.preventDefault(); setOver(s.id); } }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) void move(dragging, s.id); setDragging(null); }}
            className={cn("flex w-64 shrink-0 flex-col rounded-md bg-sunken/70", over === s.id && "ring-2 ring-accent/40")}
          >
            <header className="flex items-center justify-between px-3 py-2 text-[13px]">
              <h3 className="font-medium text-ink">{s.name}</h3>
              <span className="num text-xs text-muted">{cards.length}</span>
            </header>
            <ul className="flex min-h-16 flex-col gap-2 px-2 pb-2">
              {cards.map((c) => (
                <li
                  key={c.id}
                  draggable={canEdit}
                  onDragStart={() => setDragging(c.id)}
                  onDragEnd={() => setDragging(null)}
                  className={cn("rounded-md border border-hairline bg-surface p-2.5 text-[13px]", canEdit && "cursor-grab active:cursor-grabbing", dragging === c.id && "opacity-50")}
                >
                  <Link href={`/f/${firmSlug}/leads/${c.id}`} className="block font-medium text-ink hover:underline">{fullName(c.firstName, c.lastName)}</Link>
                  <p className="mt-0.5 truncate text-xs text-muted">{c.immigrationCategory ?? c.ref}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-ink-2">{c.assigneeName ?? "Unassigned"}</span>
                    {c.priority === "urgent" || c.priority === "high" ? <Badge tone={PRIORITY_TONE[c.priority]}>{PRIORITY_LABELS[c.priority]}</Badge> : null}
                  </div>
                  {canEdit ? (
                    <label className="mt-2 block">
                      <span className="sr-only">Move {fullName(c.firstName, c.lastName)} to stage</span>
                      <Select value={c.stageId} onChange={(e) => void move(c.id, e.target.value)} className="h-7 text-xs">
                        {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </Select>
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ───────── Calendar ───────── */

export function LeadCalendar({ firmSlug, month, rows }: { firmSlug: string; month: string; rows: LeadRow[] }) {
  const { set } = useQueryUpdater();
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // weeks start on Monday
  const gridStart = new Date(y, m - 1, 1 - startOffset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map<string, LeadRow[]>();
  for (const r of rows) {
    if (!r.followUpAt) continue;
    const k = key(new Date(r.followUpAt));
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    set({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` });
  };
  const today = key(new Date());

  return (
    <div>
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">{first.toLocaleDateString("en-ZA", { month: "long", year: "numeric" })}</h2>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft /></Button>
          <Button size="sm" variant="ghost" onClick={() => set({ month: null })}>This month</Button>
          <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month"><ChevronRight /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-hairline text-xs text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const items = byDay.get(key(d)) ?? [];
          const inMonth = d.getMonth() === m - 1;
          return (
            <div key={key(d)} className={cn("min-h-24 border-r border-b border-hairline p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-sunken/40")}>
              <div className={cn("num mb-1 text-xs", inMonth ? "text-ink-2" : "text-muted/60", key(d) === today && "font-semibold text-accent")}>{d.getDate()}</div>
              <ul className="flex flex-col gap-0.5">
                {items.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link href={`/f/${firmSlug}/leads/${r.id}`} className="block truncate rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent hover:text-white">
                      {fullName(r.firstName, r.lastName)}
                    </Link>
                  </li>
                ))}
                {items.length > 4 ? <li className="px-1 text-[11px] text-muted">{items.length - 4} more</li> : null}
              </ul>
            </div>
          );
        })}
      </div>
      {rows.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted">No follow-ups this month for these filters.</p> : null}
    </div>
  );
}

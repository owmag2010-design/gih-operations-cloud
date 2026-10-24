import type { Metadata } from "next";
import Link from "next/link";
import { TaskDialog, TaskList, type TaskRow } from "@/components/work/tasks";
import { cn, PageHeader, Panel } from "@/components/ui/primitives";
import { listTasks, taskCounts, taskFormOptions, type TaskFilters, type TaskView } from "@/server/modules/tasks/tasks";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Tasks" };

const VIEWS: [TaskView, string][] = [["mine", "My tasks"], ["team", "Team tasks"], ["created", "I created"]];
const DUE: [string, string][] = [["", "Any time"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["none", "No date"]];

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const { ctx } = await requireStaff();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const view = (VIEWS.find(([v]) => v === one(sp.view))?.[0] ?? "mine") as TaskView;
  const filters: TaskFilters = { view, status: one(sp.status) === "done" ? "done" : "open", due: (one(sp.due) ?? "") as TaskFilters["due"], firmId: one(sp.practice), q: one(sp.q) };
  const [rows, options, counts] = await Promise.all([listTasks(ctx, filters), taskFormOptions(ctx), taskCounts(ctx)]);
  const tasks: TaskRow[] = rows.map((t) => ({ ...t, dueAt: t.dueAt?.toISOString() ?? null, reminderAt: t.reminderAt?.toISOString() ?? null, completedAt: t.completedAt?.toISOString() ?? null }));
  const qs = (over: Record<string, string | undefined>) => {
    const base = { view: view === "mine" ? undefined : view, status: filters.status === "done" ? "done" : undefined, due: filters.due || undefined, practice: filters.firmId, ...over };
    const p = new URLSearchParams(Object.entries(base).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return p.toString() ? `/tasks?${p}` : "/tasks";
  };
  const pill = (active: boolean) => cn("rounded-full px-3.5 py-1.5 text-[13px]", active ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-sunken");

  return (
    <>
      <PageHeader
        title="Tasks"
        description={counts.open ? `${counts.open} open task${counts.open === 1 ? "" : "s"} assigned to you${counts.overdue ? `, ${counts.overdue} overdue` : ""}.` : "Nothing assigned to you right now."}
        actions={<><Link href="/calendar" className="text-[13px] font-medium text-ink-2 hover:text-ink">Calendar →</Link><TaskDialog options={options} meId={ctx.user.id} /></>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Whose tasks" className="flex gap-1 rounded-full border border-hairline bg-surface p-1">
          {VIEWS.map(([v, l]) => <Link key={v} href={qs({ view: v === "mine" ? undefined : v })} aria-current={view === v ? "page" : undefined} className={pill(view === v)}>{l}</Link>)}
        </nav>
        <nav aria-label="When due" className="flex flex-wrap gap-1">
          {DUE.map(([v, l]) => <Link key={l} href={qs({ due: v || undefined })} aria-current={(filters.due ?? "") === v ? "true" : undefined} className={pill((filters.due ?? "") === v)}>{l}</Link>)}
        </nav>
        {options.practices.length > 1 ? (
          <nav aria-label="Practice" className="flex flex-wrap gap-1">
            {[["", "All practices"], ["personal", "Personal"], ...options.practices.map((p) => [p.id, p.name])].map(([v, l]) => <Link key={l} href={qs({ practice: v || undefined })} aria-current={(filters.firmId ?? "") === v ? "true" : undefined} className={pill((filters.firmId ?? "") === v)}>{l}</Link>)}
          </nav>
        ) : null}
        <Link href={qs({ status: filters.status === "done" ? undefined : "done" })} className={cn("ml-auto", pill(filters.status === "done"))}>{filters.status === "done" ? "Showing done" : "Show done"}</Link>
      </div>
      <Panel>
        <TaskList
          tasks={tasks}
          options={options}
          meId={ctx.user.id}
          empty={view === "team" ? "No team tasks. Unassigned practice tasks appear here for anyone to take." : view === "mine" ? "Nothing assigned to you in this view." : "Nothing here."}
        />
      </Panel>
      <p className="mt-3 text-xs text-muted">Reminders show on My day and here when they fall due. Email and phone reminders aren&apos;t sent yet.</p>
    </>
  );
}

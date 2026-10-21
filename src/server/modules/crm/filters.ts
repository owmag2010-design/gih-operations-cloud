import type { LeadFilters } from "./leads";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(",") : []).filter(Boolean);

/** Turn URL search params into lead filters (unknown values are ignored downstream). */
export function parseLeadFilters(sp: SP): LeadFilters & { view: "table" | "board" | "calendar"; month?: string } {
  const view = one(sp.view);
  const followUp = one(sp.followUp);
  const status = one(sp.status);
  const sort = one(sp.sort);
  return {
    q: one(sp.q)?.slice(0, 80),
    stage: many(sp.stage).slice(0, 20),
    assignee: one(sp.assignee),
    priority: one(sp.priority),
    source: one(sp.source),
    tag: one(sp.tag)?.slice(0, 32),
    followUp: (["overdue", "today", "week", "none"] as const).find((x) => x === followUp),
    status: (["open", "all", "won", "lost", "closed"] as const).find((x) => x === status),
    sort: (["created", "updated", "name", "follow_up", "priority"] as const).find((x) => x === sort),
    dir: one(sp.dir) === "asc" ? "asc" : one(sp.dir) === "desc" ? "desc" : undefined,
    page: Number(one(sp.page)) || 1,
    view: view === "board" ? "board" : view === "calendar" ? "calendar" : "table",
    month: one(sp.month)?.match(/^\d{4}-\d{2}$/)?.[0],
  };
}

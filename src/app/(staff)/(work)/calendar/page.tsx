import type { Metadata } from "next";
import Link from "next/link";
import { CalendarView, EventDialog } from "@/components/work/calendar";
import { cn, Notice, PageHeader } from "@/components/ui/primitives";
import { calendarPractices, listCalendar } from "@/server/modules/calendar/calendar";
import { requireStaff } from "@/server/next/session";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { ctx } = await requireStaff();
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(one(sp.m) ?? "") ? one(sp.m)! : now.toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  // A little either side of the month so every time zone's days are covered.
  const from = new Date(Date.UTC(y, m - 1, 1) - 8 * 864e5);
  const to = new Date(Date.UTC(y, m, 1) + 15 * 864e5);
  const practice = one(sp.practice);
  const mine = one(sp.mine) === "1";
  const practices = calendarPractices(ctx);
  const items = await listCalendar(ctx, { from, to, firmId: practice, mine });
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ practice, mine: mine ? "1" : undefined, ...over }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return p.toString() ? `/calendar?${p}` : "/calendar";
  };
  const pill = (active: boolean) => cn("rounded-full px-3.5 py-1.5 text-[13px]", active ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-sunken");

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Events, task due dates, matter deadlines, expiry and submission dates, and lead follow-ups, in your own time zone."
        actions={<><Link href="/tasks" className="text-[13px] font-medium text-ink-2 hover:text-ink">Tasks →</Link><EventDialog practices={practices.map((p) => ({ id: p.id, name: p.name }))} /></>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <Link href={qs({ mine: undefined })} className={pill(!mine)}>Everything I can see</Link>
        <Link href={qs({ mine: "1" })} className={pill(mine)}>Only mine</Link>
        {practices.length > 1 ? <span className="mx-2 h-5 w-px bg-hairline" aria-hidden="true" /> : null}
        {practices.length > 1
          ? [["", "All practices"], ["personal", "Personal"], ...practices.map((p) => [p.id, p.name])].map(([v, l]) => <Link key={l} href={qs({ practice: v || undefined })} className={pill((practice ?? "") === v)}>{l}</Link>)
          : null}
      </div>
      <CalendarView month={month} items={items} baseHref={qs({})} />
      <Notice className="mt-5">Connected calendars (Microsoft 365, Google) aren&apos;t linked yet, so events created elsewhere don&apos;t appear here. See Settings › Email for mailbox connections.</Notice>
    </>
  );
}

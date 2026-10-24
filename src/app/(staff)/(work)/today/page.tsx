import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { practicePalette } from "@/components/shell/theme";
import { LocalTime } from "@/components/ui/forms";
import { cn } from "@/components/ui/primitives";
import { myDay, type MyDay } from "@/server/modules/today/today";
import { requireStaff } from "@/server/next/session";
import { DayOfMonth, Greeting } from "./greeting";

export const metadata: Metadata = { title: "My day" };

const HUB_RED = "#b3141f";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function highlights(d: MyDay): string[] {
  const parts: string[] = [];
  if (d.inbox?.mine.length) parts.push(plural(d.inbox.mine.length, "conversation") + " assigned to you");
  const overdue = d.tasks.filter((t) => t.overdue).length;
  if (overdue) parts.push(plural(overdue, "overdue task"));
  if (d.deadlines?.length) parts.push(plural(d.deadlines.length, "matter date") + " in the next two weeks");
  if (d.reviews?.length) parts.push(plural(d.reviews.length, "proposal") + " to approve");
  if (d.changes?.length) parts.push(plural(d.changes.length, "proposal") + " sent back to you");
  if (d.followUps?.length) parts.push(plural(d.followUps.length, "follow-up") + " due by tomorrow");
  if (d.intake && d.intake.waiting + d.intake.held > 0) parts.push(plural(d.intake.waiting + d.intake.held, "enquiry", "enquiries") + " to route");
  return parts;
}

/** Text colours for a practice label (light and dark themes). */
const ink = (slug: string | null, color: string | null) =>
  ({ "--c-l": slug ? practicePalette(slug, color).light.base : HUB_RED, "--c-d": slug ? practicePalette(slug, color).dark.hover : "#ff8f96" }) as React.CSSProperties;
/** Accent bar colour for a practice. */
const bar = (slug: string | null, color: string | null) => (slug ? practicePalette(slug, color).tile.mark : "#dd1929");

type Need = { key: string; href: string; eyebrow: string; title: string; detail: string | null; slug: string | null; color: string | null; time?: Date | null };

function needs(d: MyDay): Need[] {
  const out: Need[] = [];
  for (const t of d.tasks.filter((x) => x.overdue || x.reminded))
    out.push({ key: `task-${t.id}`, href: t.matterId && t.firm ? `/f/${t.firm.slug}/matters/${t.matterId}#tasks` : "/tasks", eyebrow: `${t.firm?.name ?? "Personal"} · ${t.overdue ? "overdue task" : "reminder"}`, title: t.title, detail: t.matterRef ? `Matter ${t.matterRef}` : null, slug: t.firm?.slug ?? null, color: t.firm?.brandColor ?? null, time: t.dueAt });
  for (const p of d.reviews ?? [])
    out.push({ key: `r-${p.id}`, href: `/f/${p.firm.slug}/proposals/${p.id}`, eyebrow: `${p.firm.name} · waiting for approval`, title: p.title, detail: `${p.ref} for ${p.recipient}. Approve to release the client link.`, slug: p.firm.slug, color: p.firm.brandColor });
  for (const p of d.changes ?? [])
    out.push({ key: `c-${p.id}`, href: `/f/${p.firm.slug}/proposals/${p.id}`, eyebrow: `${p.firm.name} · changes requested`, title: p.title, detail: p.note ? `“${p.note}”` : p.ref, slug: p.firm.slug, color: p.firm.brandColor });
  if (d.intake && d.intake.waiting + d.intake.held > 0)
    out.push({ key: "intake", href: "/hq/intake", eyebrow: `Hub intake · ${d.intake.waiting} new`, title: `Route ${plural(d.intake.waiting + d.intake.held, "enquiry", "enquiries")} to a practice`, detail: d.intake.held ? `${d.intake.held} held for review.` : null, slug: null, color: null, time: d.intake.oldest });
  for (const t of d.inbox?.mine ?? [])
    out.push({ key: `t-${t.id}`, href: `/inbox?t=${t.id}`, eyebrow: `${t.practice ?? "Inbox"}${t.unread ? " · unread" : ""}`, title: `${t.who}: ${t.subject || "(no subject)"}`, detail: t.preview?.replace(/\s+/g, " ").trim() || null, slug: t.practiceSlug, color: t.practiceColor, time: t.lastMessageAt });
  return out;
}

export default async function TodayPage() {
  const { ctx } = await requireStaff();
  const d = await myDay(ctx);
  const firstName = ctx.user.name.split(/\s+/)[0] || ctx.user.name;
  const parts = highlights(d);
  const list = needs(d);
  const todayIso = new Date().toISOString().slice(0, 10);
  type Up = { key: string; when: Date | string; title: string; sub: string; href: string; overdue: boolean };
  const upcoming: Up[] = [
    ...(d.deadlines ?? []).map((x) => ({ key: `d-${x.id}`, when: x.dueOn, title: `${x.label}`, sub: `${x.firm.name} · ${x.matterRef}`, href: `/f/${x.firm.slug}/matters/${x.matterId}`, overdue: x.dueOn < todayIso })),
    ...d.tasks.filter((t) => t.dueAt && !t.overdue).map((t) => ({ key: `t-${t.id}`, when: t.dueAt!, title: t.title, sub: t.firm?.name ?? "Personal task", href: t.matterId && t.firm ? `/f/${t.firm.slug}/matters/${t.matterId}#tasks` : "/tasks", overdue: false })),
    ...(d.followUps ?? []).map((l) => ({ key: `f-${l.id}`, when: l.followUpAt, title: `Follow up ${l.name}`, sub: l.firm.name, href: `/f/${l.firm.slug}/leads/${l.id}`, overdue: l.overdue })),
  ].sort((a, b) => (typeof a.when === "string" ? a.when : a.when.toISOString()).localeCompare(typeof b.when === "string" ? b.when : b.when.toISOString()));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-[#0e1524] lg:col-span-12">
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(700px 360px at 88% 120%, color-mix(in srgb, var(--a-dark, #dd1929) 55%, transparent), transparent 70%), radial-gradient(900px 400px at 0% -20%, #24324c, transparent 70%), linear-gradient(120deg, #0e1524, #1b263b)",
          }}
        />
        <div className="relative flex min-h-[260px] flex-wrap items-end justify-between gap-6 px-7 py-9 sm:px-11 sm:py-10">
          <div className="max-w-[680px]">
            <Greeting firstName={firstName} />
            <p className="mt-4 text-[17px] leading-relaxed text-[#dfe4ee]">
              {parts.length ? (
                <>
                  Today:{" "}
                  {parts.map((p, i) => (
                    <span key={p}>
                      <strong className="font-semibold text-white">{p}</strong>
                      {i < parts.length - 2 ? ", " : i === parts.length - 2 ? " and " : "."}
                    </span>
                  ))}
                </>
              ) : (
                "Nothing is waiting on you right now."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {d.inbox ? (
              <Link href="/inbox" className="flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#1b263b] hover:bg-[#f4f1ec]">
                Open inbox{d.inbox.unread ? ` · ${d.inbox.unread} unread` : ""}
              </Link>
            ) : null}
            {ctx.has("intake:create") ? (
              <Link href="/hq/intake/new" className="flex h-11 items-center gap-2 rounded-full bg-hub-red px-5 text-sm font-semibold text-white hover:bg-hub-red-deep">
                Capture an enquiry
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* Needs you */}
      <section className="flex flex-col gap-1 lg:col-span-5" aria-labelledby="needs-h">
        <SectionTitle id="needs-h" title="Needs you" action={d.inbox ? { href: "/inbox", label: "Inbox" } : undefined} />
        {list.length ? (
          <ul className="flex flex-col">
            {list.slice(0, 7).map((n, i) => (
              <li key={n.key} className={cn(i < Math.min(list.length, 7) - 1 && "border-b border-hairline")}>
                <Link href={n.href} className="group flex gap-3.5 py-3.5">
                  <span className="w-1 shrink-0 rounded-full" style={{ background: bar(n.slug, n.color) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="practice-ink truncate text-[11px] font-medium tracking-[0.08em] uppercase" style={ink(n.slug, n.color)}>{n.eyebrow}</span>
                      {n.time ? <span className="shrink-0 text-xs text-muted"><LocalTime value={n.time} mode="relative" /></span> : null}
                    </span>
                    <span className="mt-1 block truncate text-[16px] font-semibold text-ink group-hover:underline group-hover:underline-offset-2">{n.title}</span>
                    {n.detail ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{n.detail}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-5 text-sm text-muted">
            Nothing needs you right now.
            {d.inbox?.unassignedOpen ? <> {plural(d.inbox.unassignedOpen, "conversation")} in the inbox {d.inbox.unassignedOpen === 1 ? "has" : "have"} no owner — <Link href="/inbox?assignee=unassigned" className="text-ink underline underline-offset-2">pick some up</Link>.</> : null}
          </p>
        )}
      </section>

      {/* Practices */}
      <section className="flex flex-col gap-3.5 lg:col-span-4" aria-labelledby="practices-h">
        <SectionTitle id="practices-h" title="Your practices" />
        {d.practices.length ? (
          <ul className="flex flex-col gap-3">
            {d.practices.map((p) => {
              const t = practicePalette(p.slug, p.brandColor).tile;
              const facts = [
                p.openMatters !== null ? plural(p.openMatters, "matter") : null,
                p.openLeads !== null ? `${p.openLeads} leads` : null,
                p.proposalsOut !== null ? `${plural(p.proposalsOut, "proposal")} out` : null,
                p.followUpsDue ? `${p.followUpsDue} follow-up${p.followUpsDue === 1 ? "" : "s"} due` : null,
              ].filter(Boolean);
              return (
                <li key={p.firmId}>
                  <Link
                    href={`/f/${p.slug}`}
                    className="flex items-center gap-3.5 rounded-[18px] p-4 transition-transform hover:-translate-y-0.5"
                    style={{ background: t.bg, color: t.fg, border: t.border ? `1px solid ${t.border}` : undefined }}
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl font-display text-xl" style={{ background: t.mark, color: t.markInk }} aria-hidden="true">
                      {p.name[0]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                      <span className="block truncate text-xs" style={{ color: t.sub }}>{facts.length ? facts.join(" · ") : "Open the practice"}</span>
                    </span>
                    <ArrowRight className="size-[18px] shrink-0" style={{ color: t.arrow }} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-5 text-sm text-muted">You aren&apos;t a member of a practice yet.</p>
        )}
      </section>

      {/* Coming up */}
      <section className="flex flex-col gap-3.5 rounded-[22px] border border-hairline bg-surface p-5 lg:col-span-3" aria-labelledby="coming-h">
        <h2 id="coming-h" className="font-display text-2xl text-ink">Coming up</h2>
        {upcoming.length ? (
          <ul className="flex flex-col gap-3.5">
            {upcoming.slice(0, 8).map((u) => (
              <li key={u.key}>
                <Link href={u.href} className="group flex items-start gap-3">
                  {typeof u.when === "string" ? (
                    <span className={cn("w-9 shrink-0 font-display text-[30px] leading-none", u.overdue ? "text-danger" : "text-hub-red-deep")} aria-hidden="true">{Number(u.when.slice(8))}</span>
                  ) : (
                    <DayNumber value={u.when} overdue={u.overdue} />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink group-hover:underline">{u.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {u.overdue ? "Overdue · " : ""}{u.sub} · {typeof u.when === "string" ? u.when : <LocalTime value={u.when} mode="relative" />}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing due on your matters, tasks or leads in the next few days.</p>
        )}
        <Link href="/calendar" className="mt-auto border-t border-hairline pt-3 text-[13px] font-medium text-ink-2 hover:text-ink">Open the calendar →</Link>
      </section>
    </div>
  );
}

function SectionTitle({ id, title, action }: { id: string; title: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
      <h2 id={id} className="font-display text-[28px] leading-tight text-ink">{title}</h2>
      {action ? <Link href={action.href} className="text-[13px] font-medium text-ink hover:text-hub-red">{action.label} →</Link> : null}
    </div>
  );
}

function DayNumber({ value, overdue }: { value: Date; overdue: boolean }) {
  return (
    <span className={cn("w-9 shrink-0 font-display text-[30px] leading-none", overdue ? "text-danger" : "text-hub-red-deep")} aria-hidden="true">
      <DayOfMonth value={value} />
    </span>
  );
}


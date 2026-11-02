import type { Metadata } from "next";
import { ArrowRight, CalendarClock, CircleAlert, Inbox, Stamp } from "lucide-react";
import Image from "next/image";
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

  const overdueTasks = d.tasks.filter((t) => t.overdue).length;
  const approvals = (d.reviews?.length ?? 0) + (d.changes?.length ?? 0);
  const stats: { key: string; label: string; value: number; hint: string; href: string; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
    { key: "needs", label: "Needs you", value: list.length, hint: list.length ? "Items waiting on you" : "All clear", href: "#needs-h", icon: CircleAlert, tone: "bg-hub-red-tint text-hub-red-deep" },
    ...(d.inbox ? [{ key: "inbox", label: "Unread in the inbox", value: d.inbox.unread, hint: d.inbox.unassignedOpen ? `${d.inbox.unassignedOpen} without an owner` : "Everything has an owner", href: "/inbox", icon: Inbox, tone: "bg-sky text-ink" }] : []),
    { key: "tasks", label: "Overdue tasks", value: overdueTasks, hint: `${d.tasks.length} open on your list`, href: "/tasks", icon: CalendarClock, tone: overdueTasks ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok" },
    { key: "approve", label: "Proposals to review", value: approvals, hint: d.intake ? `${d.intake.waiting + d.intake.held} enquiries to route` : `${upcoming.length} dates coming up`, href: d.intake ? "/hq/intake" : "/calendar", icon: Stamp, tone: "bg-accent-soft text-accent" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Banner: the Hub website's Cape Town photograph under a navy wash */}
      <section className="relative isolate overflow-hidden rounded-3xl bg-navy shadow-lift">
        <Image src="/brand/dash-cape-town.jpg" alt="" aria-hidden="true" fill priority sizes="(min-width: 1024px) 1100px, 100vw" className="-z-10 object-cover object-[center_60%]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,rgba(14,21,36,.94)_0%,rgba(27,38,59,.82)_45%,rgba(27,38,59,.25)_100%)]" aria-hidden="true" />
        <div className="flex min-h-[230px] flex-wrap items-end justify-between gap-6 px-6 py-8 sm:px-10 sm:py-9">
          <div className="max-w-[640px]">
            <Greeting firstName={firstName} />
            <p className="mt-3 text-[16px] leading-relaxed text-[#dfe4ee]">
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
              <Link href="/inbox" className="flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-navy hover:bg-sunken">
                Open inbox{d.inbox.unread ? ` · ${d.inbox.unread} unread` : ""}
              </Link>
            ) : null}
            {ctx.has("intake:create") ? (
              <Link href="/hq/intake/new" className="flex h-11 items-center gap-2 rounded-xl bg-hub-red px-5 text-sm font-semibold text-white hover:bg-hub-red-deep">
                Capture an enquiry
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* At a glance */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.key} href={s.href} className="group flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-card transition-shadow hover:shadow-lift sm:p-5">
            <span className="flex items-center justify-between">
              <span className={cn("flex size-9 items-center justify-center rounded-xl", s.tone)} aria-hidden="true"><s.icon className="size-[18px]" /></span>
              <ArrowRight className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </span>
            <span>
              <span className="num block font-display text-[34px] leading-none text-ink">{s.value}</span>
              <span className="mt-1.5 block text-[13px] font-semibold text-ink">{s.label}</span>
              <span className="block truncate text-xs text-muted">{s.hint}</span>
            </span>
          </Link>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Needs you */}
        <section className="rounded-2xl border border-hairline bg-surface shadow-card lg:col-span-7 xl:col-span-8" aria-labelledby="needs-h">
          <CardTitle id="needs-h" title="Needs you" count={list.length} action={d.inbox ? { href: "/inbox", label: "Open inbox" } : undefined} />
          {list.length ? (
            <ul className="divide-y divide-hairline">
              {list.slice(0, 8).map((n) => (
                <li key={n.key}>
                  <Link href={n.href} className="group flex gap-3.5 px-5 py-3.5 transition-colors hover:bg-sunken/60">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white" style={{ background: bar(n.slug, n.color) }} aria-hidden="true">
                      {(n.title.trim()[0] ?? "•").toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="practice-ink truncate text-[11px] font-semibold tracking-[0.06em] uppercase" style={ink(n.slug, n.color)}>{n.eyebrow}</span>
                        {n.time ? <span className="shrink-0 text-xs text-muted"><LocalTime value={n.time} mode="relative" /></span> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[15px] font-semibold text-ink">{n.title}</span>
                      {n.detail ? <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted">{n.detail}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-sm text-muted">
              Nothing needs you right now.
              {d.inbox?.unassignedOpen ? <> {plural(d.inbox.unassignedOpen, "conversation")} in the inbox {d.inbox.unassignedOpen === 1 ? "has" : "have"} no owner — <Link href="/inbox?assignee=unassigned" className="text-ink underline underline-offset-2">pick some up</Link>.</> : null}
            </p>
          )}
        </section>

        <div className="flex flex-col gap-6 lg:col-span-5 xl:col-span-4">
          {/* Practices */}
          <section className="rounded-2xl border border-hairline bg-surface shadow-card" aria-labelledby="practices-h">
            <CardTitle id="practices-h" title="Your practices" />
            {d.practices.length ? (
              <ul className="flex flex-col gap-2.5 p-4 pt-1">
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
                        className="flex items-center gap-3 rounded-xl p-3 transition-transform hover:-translate-y-0.5"
                        style={{ background: t.bg, color: t.fg, border: t.border ? `1px solid ${t.border}` : undefined }}
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg font-display text-lg" style={{ background: t.mark, color: t.markInk }} aria-hidden="true">
                          {p.name[0]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                          <span className="block truncate text-xs" style={{ color: t.sub }}>{facts.length ? facts.join(" · ") : "Open the practice"}</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0" style={{ color: t.arrow }} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">You aren&apos;t a member of a practice yet.</p>
            )}
          </section>

          {/* Coming up */}
          <section className="rounded-2xl border border-hairline bg-surface shadow-card" aria-labelledby="coming-h">
            <CardTitle id="coming-h" title="Coming up" action={{ href: "/calendar", label: "Calendar" }} />
            {upcoming.length ? (
              <ul className="flex flex-col gap-1 px-3 pb-3">
                {upcoming.slice(0, 6).map((u) => (
                  <li key={u.key}>
                    <Link href={u.href} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-sunken/60">
                      <span className={cn("flex size-11 shrink-0 flex-col items-center justify-center rounded-xl font-display text-[20px] leading-none", u.overdue ? "bg-danger-soft text-danger" : "bg-hub-red-tint text-hub-red-deep")} aria-hidden="true">
                        {typeof u.when === "string" ? Number(u.when.slice(8)) : <DayOfMonth value={u.when} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{u.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {u.overdue ? "Overdue · " : ""}{u.sub} · {typeof u.when === "string" ? u.when : <LocalTime value={u.when} mode="relative" />}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">Nothing due on your matters, tasks or leads in the next few days.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CardTitle({ id, title, count, action }: { id: string; title: string; count?: number; action?: { href: string; label: string } }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
      <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        {title}
        {count ? <span className="rounded-full bg-sunken px-2 text-xs font-semibold text-ink-2">{count}</span> : null}
      </h2>
      {action ? <Link href={action.href} className="text-[13px] font-medium text-ink-2 hover:text-hub-red">{action.label} →</Link> : null}
    </div>
  );
}


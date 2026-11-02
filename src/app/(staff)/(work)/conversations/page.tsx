import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, Notice, cn } from "@/components/ui/primitives";
import {
  QUEUES,
  canViewConversations,
  conversationReach,
  getConversation,
  listConversations,
  queueCounts,
  type ConversationDetail,
  type Queue,
} from "@/server/modules/conversations/conversations";
import { requireStaff } from "@/server/next/session";
import { AutoRefresh, SearchBox } from "./client";

export const metadata: Metadata = { title: "Conversations" };

/** The engine dashboard, where replies are still sent from until replying moves here. */
const ENGINE_DASHBOARD = "https://proposals.thegih.com/ops/";

const QUEUE_LABEL: Record<Queue, string> = {
  all: "All", needs_reply: "Client waiting", handling: "Team handling", proposal: "Proposal out", paid: "Paid",
  whatsapp: "WhatsApp", email: "Email", forms: "Forms", chat: "Website chat", hub: "Hub, no practice yet",
};
const STATUS: Record<string, [string, "neutral" | "accent" | "ok" | "warn" | "danger" | "outline"]> = {
  new: ["New", "accent"], waiting_details: ["Waiting for details", "accent"], proposal_sent: ["Proposal sent", "accent"],
  awaiting_approval: ["Needs approval", "warn"], triage: ["Unclassified", "warn"], urgent_call: ["Urgent call", "danger"],
  accepted: ["Accepted", "ok"], paid: ["Paid", "ok"], existing_client: ["Existing client", "ok"], closed: ["Closed", "neutral"],
};
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", tally: "Form", website: "Website form", webchat: "Website chat" };
const SITE: Record<string, string> = { "hub-site": "Hub website", "veritas-site": "Veritas website", "mimshac-site": "Mimshac website", "nextmove-site": "Nextmove website" };
const money = (n: number, c: string) => `${c === "usd" ? "US$" : "R"}${Math.round(n).toLocaleString("en-ZA").replace(/[\s ]/g, ",")}`;

type SP = { c?: string; queue?: string; practice?: string; q?: string; tests?: string };

export default async function ConversationsPage({ searchParams }: PageProps<"/conversations">) {
  const { ctx } = await requireStaff();
  if (!canViewConversations(ctx)) notFound();
  const sp = (await searchParams) as SP;
  const reach = conversationReach(ctx);
  const queue = (QUEUES as readonly string[]).includes(sp.queue ?? "") ? (sp.queue as Queue) : "all";
  const practice = sp.practice && reach.firmIds.includes(sp.practice) ? sp.practice : undefined;
  const tests = sp.tests === "1";
  const [rows, counts, detail] = await Promise.all([
    listConversations(ctx, { queue, firmId: practice, q: sp.q, tests }),
    queueCounts(ctx, { firmId: practice, tests }),
    sp.c ? getConversation(ctx, sp.c) : Promise.resolve(null),
  ]);
  const keep = (extra: Partial<SP>) => {
    const base: SP = { queue: queue === "all" ? undefined : queue, practice, q: sp.q, tests: tests ? "1" : undefined, c: sp.c };
    const p = new URLSearchParams(Object.entries({ ...base, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/conversations${p.size ? `?${p}` : ""}`;
  };
  const queues: Queue[] = reach.hub ? [...QUEUES] : QUEUES.filter((q) => q !== "hub");
  const selected = detail?.conversation.id;

  return (
    <div data-full-bleed className="flex h-[calc(100dvh-56px)] min-h-[560px] flex-col lg:h-[calc(100dvh-72px)]">
      <AutoRefresh seconds={20} />
      <div className="border-b border-hairline bg-paper px-4 py-2 lg:px-6">
        <Notice>
          Read-only for now. The engine still answers clients; to reply, use{" "}
          <a className="underline" href={selected ? `${ENGINE_DASHBOARD}#lead=${selected}` : ENGINE_DASHBOARD} target="_blank" rel="noreferrer">the engine dashboard</a>.
          Replying from here comes next.
        </Notice>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)_300px]">
        {/* Queues and list */}
        <aside className={cn("flex min-h-0 flex-col border-r border-hairline bg-surface", selected && "hidden lg:flex")} aria-label="Conversation list">
          <div className="px-4 pt-4 pb-2">
            <h1 className="font-display text-2xl text-ink">Conversations</h1>
            <p className="text-xs text-muted">WhatsApp, email, forms and website chat from the enquiry engine</p>
          </div>
          <div className="px-4 pb-2"><SearchBox defaultValue={sp.q ?? ""} /></div>
          <nav aria-label="Queues" className="flex flex-wrap gap-1 px-3 pb-2">
            {queues.map((q) => (
              <Link key={q} href={keep({ queue: q === "all" ? undefined : q, c: undefined })} aria-current={queue === q ? "page" : undefined}
                className={cn("rounded-full px-2.5 py-1 text-[12.5px]", queue === q ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-sunken")}>
                {QUEUE_LABEL[q]} <span className={queue === q ? "opacity-80" : "text-muted"}>{counts[q]}</span>
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-3 pb-2 text-[12.5px]">
            {reach.firmIds.length > 1 ? (
              <>
                <Link href={keep({ practice: undefined, c: undefined })} className={cn("rounded-full px-2.5 py-1", !practice ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink")}>All practices</Link>
                {reach.firmIds.map((id) => (
                  <Link key={id} href={keep({ practice: id, c: undefined })} className={cn("rounded-full px-2.5 py-1", practice === id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink")}>{ctx.firms.get(id)?.tradingName}</Link>
                ))}
              </>
            ) : null}
            <Link href={keep({ tests: tests ? undefined : "1" })} className="ml-auto text-muted underline-offset-2 hover:text-ink hover:underline">{tests ? "Hide tests" : "Show tests"}</Link>
          </div>
          {rows.length === 0 ? (
            <EmptyState title={sp.q ? "No conversations match" : "Nothing in this queue"}>
              {sp.q ? "Search looks at names, email, phone, matter and proposal reference." : "New enquiries appear here as soon as the engine receives them."}
            </EmptyState>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
              {rows.map((r) => {
                const firm = r.firmId ? ctx.firms.get(r.firmId) : undefined;
                const waiting = r.lastDirection === "in";
                return (
                  <li key={r.id}>
                    <Link href={keep({ c: r.id })} aria-current={r.id === selected ? "true" : undefined} className={cn("relative block px-4 py-3 hover:bg-sunken", r.id === selected && "bg-sky hover:bg-sky")}>
                      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r" style={{ background: firm?.brandColor ?? "var(--hub-red)" }} aria-hidden="true" />
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[13px]", waiting ? "font-semibold text-ink" : "text-ink-2")}>
                          {waiting ? <span className="mr-1.5 inline-block size-1.5 rounded-full bg-hub-red align-middle" aria-label="Client waiting" /> : null}
                          {r.name ?? r.email ?? (r.phone ? `+${r.phone}` : "Website visitor")}
                          {r.isTest ? <span className="ml-1.5 rounded bg-warn-soft px-1 text-[10px] font-semibold text-warn">TEST</span> : null}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted"><LocalTime value={r.lastAt ?? r.createdAt} mode="relative" /></span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{r.lastDirection === "out" ? "Sent: " : ""}{(r.lastBody ?? "").replace(/\s+/g, " ")}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <span className="truncate">{r.firmName ?? "Hub"} · {CHANNEL[r.firstChannel] ?? r.firstChannel}{r.matter ? ` · ${r.matter}` : ""}</span>
                        {STATUS[r.status] ? <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge> : null}
                        {r.teamHandling ? <Badge tone="warn">{r.paused ? "Engine paused" : "Team handling"}</Badge> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Thread */}
        <section className={cn("flex min-h-0 min-w-0 flex-col bg-paper", !selected && "hidden lg:flex")} aria-label="Conversation">
          {detail ? <Thread detail={detail} backHref={keep({ c: undefined })} /> : (
            <div className="m-auto max-w-sm p-6 text-center text-sm text-muted">Choose a conversation to read the whole thread across WhatsApp, email, forms and website chat.</div>
          )}
        </section>

        {/* Client */}
        <aside className="hidden min-h-0 overflow-y-auto border-l border-hairline bg-surface xl:block" aria-label="Client">
          {detail ? <ClientPanel detail={detail} /> : null}
        </aside>
      </div>
    </div>
  );
}

function Thread({ detail, backHref }: { detail: ConversationDetail; backHref: string }) {
  const c = detail.conversation;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-3 lg:px-6">
        <Link href={backHref} className="text-[13px] text-muted hover:text-ink lg:hidden">← Back</Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl text-ink">{c.name ?? c.email ?? (c.phone ? `+${c.phone}` : "Website visitor")}</h2>
          <p className="truncate text-xs text-muted">{[c.firmName ?? "Hub", c.siteSource ? SITE[c.siteSource] : null, c.email, c.phone ? `+${c.phone}` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <a className="shrink-0 rounded-full border border-hairline-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sunken" href={`${ENGINE_DASHBOARD}#lead=${c.id}`} target="_blank" rel="noreferrer">Reply in engine dashboard</a>
      </header>
      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4 lg:px-6" aria-label="Messages">
        {detail.messages.length === 0 ? <li className="text-sm text-muted">No messages yet.</li> : null}
        {detail.messages.map((m) => (
          <li key={m.id} className={cn("max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words",
            m.author === "client" ? "self-start rounded-bl-sm border border-hairline bg-surface text-ink"
              : m.author === "team" ? "self-end rounded-br-sm bg-warn-soft text-ink" : "self-end rounded-br-sm bg-navy text-white")}>
            {m.body}
            <span className={cn("mt-1 block text-[11px]", m.author === "engine" ? "text-white/70" : "text-muted")}>
              {CHANNEL[m.channel] ?? m.channel} · {m.author === "client" ? "Client" : m.author === "team" ? "Team" : "Engine"} · <LocalTime value={m.createdAt} />
              {m.failed ? " · not delivered" : ""}{m.skippedReason ? " · recorded only" : ""}
            </span>
          </li>
        ))}
      </ol>
      <footer className="border-t border-hairline bg-surface px-4 py-3 text-xs text-muted lg:px-6">
        {detail.whatsappOpenUntil ? <>WhatsApp is open until <LocalTime value={detail.whatsappOpenUntil} />. </> : c.phone ? "WhatsApp needs the approved reopen message (no client message in 24 hours). " : null}
        Replies, instructions and Ask Claude are in the engine dashboard for now.
      </footer>
    </>
  );
}

function ClientPanel({ detail }: { detail: ConversationDetail }) {
  const c = detail.conversation;
  const ins = detail.instructions as Record<string, unknown>;
  const insLines = [
    ins.pause ? "Engine paused for this client" : null,
    ins.hold ? "Proposals held for approval" : null,
    typeof ins.firm === "string" ? `Firm: ${ins.firm}` : null,
    ins.fee != null ? `Professional fee: ${money(Number(ins.fee), "zar")}` : null,
    ins.discount ? `Discount: ${money(Number(ins.discount), "zar")}` : null,
    ins.deposit_pct ? `Deposit: ${ins.deposit_pct}%` : null,
    ...(Array.isArray(ins.extra) ? (ins.extra as { label?: string; amount?: number }[]).map((x) => `Extra: ${x.label} ${money(Number(x.amount ?? 0), "zar")}`) : []),
    typeof ins.note === "string" ? `Note to client: ${ins.note}` : null,
    typeof ins.private === "string" ? `Private: ${ins.private}` : null,
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-5 p-4 text-[13px]">
      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted">Client</h3>
        <dl className="space-y-1">
          <Row k="Status" v={STATUS[c.status]?.[0] ?? c.status} />
          <Row k="Practice" v={c.firmName ?? "Hub (no practice yet)"} />
          <Row k="First contact" v={CHANNEL[c.firstChannel] ?? c.firstChannel} />
          {c.siteSource ? <Row k="Came from" v={SITE[c.siteSource] ?? c.siteSource} /> : null}
          {c.matter ? <Row k="Matter" v={c.matter} /> : null}
          <Row k="Since" v={<LocalTime value={c.createdAt} mode="date" />} />
          {c.chatLastSeen ? <Row k="On website" v={c.onWebsiteNow ? "Now" : <LocalTime value={c.chatLastSeen} mode="relative" />} /> : null}
        </dl>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted">Proposal</h3>
        {detail.proposals.length ? detail.proposals.slice(0, 3).map((p) => (
          <div key={p.slug} className="mb-2 rounded-xl border border-hairline p-3">
            <a className="font-medium text-ink underline-offset-2 hover:underline" href={`https://proposals.thegih.com/p/${p.slug}/`} target="_blank" rel="noreferrer">{p.matter ?? "Proposal"}</a>
            <p className="text-xs text-muted">{p.ref} · {p.firm ?? "Hub"} · {p.status}</p>
            <p className="mt-1">{money(p.core, p.currency)} core · deposit {p.depositPct}% ({money(p.core * p.depositPct / 100, p.currency)})</p>
            {p.note ? <p className="mt-1 text-xs text-ink-2">Note: {p.note}</p> : null}
          </div>
        )) : <p className="text-muted">No proposal yet.</p>}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold text-muted">Instructions to the engine</h3>
        {insLines.length ? <ul className="space-y-1">{insLines.map((l) => <li key={l} className="text-ink-2">{l}</li>)}</ul> : <p className="text-muted">None. The engine follows its standard rules.</p>}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right text-ink">{v}</dd></div>;
}

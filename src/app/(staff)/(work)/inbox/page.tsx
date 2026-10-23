import type { Metadata } from "next";
import { Paperclip } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, Notice, cn } from "@/components/ui/primitives";
import { NotFoundError } from "@/server/errors";
import { providerConfigured } from "@/server/integrations/mail/oauth";
import { resendConfigured } from "@/server/integrations/resend";
import { inboxReach, visibleMailboxes } from "@/server/modules/email/access";
import { getConversation, inboxAssignees, listInbox, listMyDrafts, type InboxFilters } from "@/server/modules/email/mail";
import { requireStaff } from "@/server/next/session";
import { ConversationView, DraftOpener, InboxFilterBar, NewEmailButton } from "./client";

export const metadata: Metadata = { title: "Inbox" };

type SP = { t?: string; q?: string; status?: string; practice?: string; mailbox?: string; assignee?: string; linked?: string; unread?: string; lead?: string; client?: string; view?: string; draft?: string };

const initials = (n: string | null) => (n ?? "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const { ctx } = await requireStaff();
  const reach = inboxReach(ctx);
  if (!reach.hub && !reach.firmIds.length) notFound();
  const sp = (await searchParams) as SP;
  const status = sp.status === "closed" || sp.status === "all" ? sp.status : "open";
  const filters: InboxFilters = {
    q: sp.q, status, practice: sp.practice, mailboxId: sp.mailbox, assignee: sp.assignee, linked: sp.linked === "linked" || sp.linked === "unlinked" ? sp.linked : undefined,
    unread: sp.unread === "1", leadId: sp.lead, clientId: sp.client,
  };
  const drafts = sp.view === "drafts";
  const [threads, myDrafts, mailboxes] = await Promise.all([drafts ? Promise.resolve([]) : listInbox(ctx, filters), listMyDrafts(ctx), visibleMailboxes(ctx)]);
  const selectedId = drafts ? undefined : (sp.t ?? undefined);
  const conversation = selectedId ? await getConversation(ctx, selectedId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null;
  const assignees = conversation ? await inboxAssignees(ctx, conversation.thread.firmId).catch(() => []) : [];

  const practices = [
    ...(reach.hub ? [{ id: "hub", name: "Global Immigration Hub" }] : []),
    ...reach.firmIds.map((id) => ({ id, name: ctx.firms.get(id)!.tradingName })),
  ];
  const keep = (extra: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = { q: sp.q, status: status === "open" ? undefined : status, practice: sp.practice, mailbox: sp.mailbox, assignee: sp.assignee, linked: sp.linked, unread: sp.unread, lead: sp.lead, client: sp.client, view: sp.view };
    const p = new URLSearchParams(Object.entries({ ...base, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/inbox${p.size ? `?${p}` : ""}`;
  };
  const sendingReady = resendConfigured() || mailboxes.some((m) => m.provider !== "forwarding" && m.connectionStatus === "connected");
  const attention = mailboxes.filter((m) => m.connectionStatus === "needs_reconnect" || m.connectionStatus === "error");
  const practiceForCompose = sp.practice === "hub" ? null : sp.practice && reach.firmIds.includes(sp.practice) ? sp.practice : undefined;

  return (
    <div data-full-bleed className="flex h-[calc(100dvh-56px)] min-h-[560px] flex-col">
      {(!sendingReady || attention.length || (!providerConfigured("microsoft") && !providerConfigured("google"))) ? (
        <div className="flex flex-col gap-1 border-b border-hairline bg-paper px-4 py-2 lg:px-6">
          {!sendingReady ? <Notice tone="warn">Sending isn&apos;t connected: add the Resend key or connect a mailbox in <Link className="underline" href="/settings/email">Settings › Email</Link>. Messages are saved but not sent.</Notice> : null}
          {attention.map((m) => <Notice key={m.id} tone="danger">{m.accountEmail ?? m.fromAddress} needs attention ({m.lastError ?? "sign-in expired"}). <Link className="underline" href="/settings/email">Reconnect</Link></Notice>)}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        {/* Conversation list */}
        <aside className={cn("flex min-h-0 flex-col border-r border-hairline bg-surface", selectedId && "hidden lg:flex")} aria-label="Conversations">
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h1 className="font-display text-2xl text-ink">Inbox</h1>
            <NewEmailButton practice={practiceForCompose} />
          </div>
          <InboxFilterBar practices={practices} mailboxes={mailboxes.map((m) => ({ id: m.id, label: `${m.label}${m.kind === "personal" ? " (yours)" : ""}`, firmId: m.firmId }))} values={{ q: sp.q ?? "", status, practice: sp.practice ?? "", mailbox: sp.mailbox ?? "", assignee: sp.assignee ?? "", linked: sp.linked ?? "", unread: sp.unread === "1" }} />
          <nav className="flex gap-1 border-b border-hairline px-3 text-[13px]" aria-label="Folders">
            <Link href={keep({ view: undefined, t: undefined })} aria-current={!drafts ? "page" : undefined} className={cn("border-b-2 px-2 py-2", !drafts ? "border-hub-red font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>Conversations</Link>
            <Link href={keep({ view: "drafts", t: undefined })} aria-current={drafts ? "page" : undefined} className={cn("border-b-2 px-2 py-2", drafts ? "border-hub-red font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>Drafts{myDrafts.length ? <span className="ml-1 text-muted">{myDrafts.length}</span> : null}</Link>
            {(sp.lead || sp.client) ? <Link href={keep({ lead: undefined, client: undefined })} className="ml-auto self-center rounded bg-sky px-2 py-0.5 text-xs text-ink-2">Linked record only · clear</Link> : null}
          </nav>
          {drafts ? (
            myDrafts.length ? (
              <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
                {myDrafts.map(({ d, mailboxLabel, firmName }) => (
                  <li key={d.id}>
                    <DraftOpener draft={{ id: d.id, mailboxId: d.mailboxId, practice: d.firmId, to: d.toAddresses, cc: d.ccAddresses, bcc: d.bccAddresses, subject: d.subject, body: d.body, threadId: d.threadId, mode: d.mode, replyToMessageId: d.replyToMessageId, leadId: d.leadId, clientId: d.clientId, templateId: d.templateId, slots: d.slotValues, fields: d.fieldValues }}>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{d.toAddresses.join(", ") || "No recipient yet"}</span>
                        <span className="shrink-0 text-[11px] text-muted"><LocalTime value={d.updatedAt} mode="relative" /></span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-2">{d.subject || "(no subject)"}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{d.mode === "new" ? "New email" : d.mode === "forward" ? "Forward" : "Reply"} · {mailboxLabel ?? "No mailbox"} · {firmName ?? "Hub"}</span>
                    </DraftOpener>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No drafts">Emails you start and don&apos;t send are saved here automatically. Only you can see them.</EmptyState>
            )
          ) : threads.length === 0 ? (
            <EmptyState title={sp.q ? "No conversations match" : "Nothing here"}>
              {sp.q ? "Try fewer words, or search all statuses." : "Mail sent to your connected mailboxes and forwarding addresses appears here, along with everything you send."}
            </EmptyState>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={keep({ t: t.id })} aria-current={t.id === selectedId ? "true" : undefined} className={cn("relative block px-4 py-3 hover:bg-sunken", t.id === selectedId && "bg-sky hover:bg-sky")}>
                    <span className="absolute inset-y-3 left-0 w-[3px] rounded-r" style={{ background: t.firmColor ?? "var(--hub-red)" }} aria-hidden="true" />
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-[13px]", t.unread ? "font-semibold text-ink" : "text-ink-2")}>
                        {t.unread ? <span className="mr-1.5 inline-block size-1.5 rounded-full bg-hub-red align-middle" aria-label="Unread" /> : null}
                        {t.counterpartName ?? t.counterpartEmail}
                        {t.messageCount > 1 ? <span className="ml-1 font-normal text-muted">{t.messageCount}</span> : null}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted"><LocalTime value={t.lastMessageAt} mode="relative" /></span>
                    </span>
                    <span className={cn("mt-0.5 block truncate text-[13px]", t.unread ? "text-ink" : "text-ink-2")}>{t.subject}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{t.lastDirection === "outbound" ? "You: " : ""}{t.preview}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span className="truncate">{t.firmName ?? "Hub"} · {t.mailboxLabel ?? "No mailbox"}</span>
                      {t.unverified ? <Badge tone="danger">Unverified sender</Badge> : null}
                      {t.lastStatus === "failed" || t.lastStatus === "bounced" ? <Badge tone="danger">Not delivered</Badge> : null}
                      {t.hasAttachments ? <Paperclip className="size-3" aria-label="Has attachments" /> : null}
                      {t.noteCount ? <span className="rounded bg-warn-soft px-1 text-warn" title="Internal notes">{t.noteCount} note{t.noteCount > 1 ? "s" : ""}</span> : null}
                      {t.leadId || t.clientId || t.intakeItemId ? <span className="rounded bg-ok-soft px-1 text-ok">Linked</span> : null}
                      {t.assigneeName ? <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-navy text-[9px] font-semibold text-white" title={`Assigned to ${t.assigneeName}`}>{initials(t.assigneeName)}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Conversation */}
        <section className={cn("min-h-0 min-w-0 bg-paper", !selectedId && "hidden lg:block")} aria-label="Conversation">
          {conversation ? (
            <ConversationView
              key={conversation.thread.id}
              backHref={keep({ t: undefined })}
              data={{
                thread: { id: conversation.thread.id, subject: conversation.thread.subject, status: conversation.thread.status, counterpartEmail: conversation.thread.counterpartEmail, counterpartName: conversation.thread.counterpartName, firmId: conversation.thread.firmId, mailboxId: conversation.thread.mailboxId },
                firm: conversation.firm,
                mailbox: conversation.mailbox,
                assignee: conversation.assignee,
                lead: conversation.lead,
                client: conversation.client,
                intake: conversation.intake,
                related: conversation.related,
                canSend: conversation.canSend,
                canCreateEnquiry: conversation.thread.firmId ? ctx.has("leads:create", conversation.thread.firmId) : ctx.has("intake:create"),
                assignees,
                notes: conversation.notes.map((n) => ({ id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString() })),
                messages: conversation.messages.map((m) => ({
                  id: m.id, direction: m.direction, status: m.status, via: m.via, fromAddress: m.fromAddress, fromName: m.fromName, senderName: m.senderName, toAddresses: m.toAddresses, ccAddresses: m.ccAddresses, bccAddresses: m.bccAddresses,
                  subject: m.subject, textBody: m.textBody, htmlBody: m.htmlBody, attachments: m.attachments, error: m.error, authResult: m.authResult,
                  at: (m.providerDate ?? m.createdAt).toISOString(), acceptedAt: m.acceptedAt?.toISOString() ?? null, templated: Boolean(m.templateId),
                })),
                drafts: conversation.drafts.map((d) => ({ id: d.id, mode: d.mode, mailboxId: d.mailboxId, to: d.toAddresses, cc: d.ccAddresses, bcc: d.bccAddresses, subject: d.subject, body: d.body, replyToMessageId: d.replyToMessageId, templateId: d.templateId, slots: d.slotValues, fields: d.fieldValues })),
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="font-display text-xl text-ink">Choose a conversation</p>
              <p className="max-w-[46ch] text-[13px] text-muted">Read the full thread, reply from the right mailbox, leave internal notes for the team, and link it to the client&apos;s record.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

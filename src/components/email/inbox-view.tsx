import Link from "next/link";
import { LocalTime } from "@/components/ui/forms";
import { Badge, EmptyState, Panel, PanelHeader, cn } from "@/components/ui/primitives";
import { fullName } from "@/lib/labels";
import type { AccessContext } from "@/server/access/context";
import { NotFoundError } from "@/server/errors";
import { resendConfigured } from "@/server/integrations/resend";
import { getThread, listTemplates, listThreads, type EmailScope } from "@/server/modules/email/mail";
import { MessageBody, NotConnectedNotice, ReplyForm, ThreadActions, type TemplateOption } from "./client";

const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "outline"> = { received: "outline", queued: "outline", sent: "ok", delivered: "ok", bounced: "danger", complained: "danger", failed: "danger", not_configured: "warn" };
const STATUS_LABEL: Record<string, string> = { received: "Received", queued: "Sending", sent: "Sent", delivered: "Delivered", bounced: "Bounced", complained: "Marked as spam", failed: "Failed", not_configured: "Not sent" };

/** Two-pane inbox shared by the Hub and each firm. */
export async function InboxView({ ctx, where, scopeKey, base, sp, canSend, canCreateLead }: { ctx: AccessContext; where: EmailScope; scopeKey: string; base: string; sp: { t?: string; q?: string; status?: string }; canSend: boolean; canCreateLead: boolean }) {
  const status = sp.status === "closed" || sp.status === "all" ? sp.status : "open";
  const threads = await listThreads(ctx, where, { q: sp.q, status });
  const selectedId = sp.t ?? threads[0]?.id;
  const detail = selectedId ? await getThread(ctx, where, selectedId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null;
  const templates: TemplateOption[] = (await listTemplates(ctx, where, { includeHub: true, activeOnly: true })).map((t) => ({ id: t.id, name: t.name, category: t.category, subject: t.subject, hub: t.firmId === null && where.kind === "firm" }));
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, status: status === "open" ? undefined : status, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `${base}/inbox${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {!resendConfigured() ? <NotConnectedNotice /> : null}
      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel className="flex flex-col overflow-hidden">
          <form className="flex gap-2 border-b border-hairline p-3" action={`${base}/inbox`}>
            <input name="q" defaultValue={sp.q} placeholder="Search name, email or subject" className="h-8 min-w-0 flex-1 rounded-md border border-hairline-strong bg-surface px-2.5 text-[13px]" aria-label="Search conversations" />
            {status !== "open" ? <input type="hidden" name="status" value={status} /> : null}
          </form>
          <nav className="flex gap-1 border-b border-hairline px-3 py-2 text-xs" aria-label="Conversation status">
            {(["open", "closed", "all"] as const).map((s) => (
              <Link key={s} href={href({ status: s === "open" ? undefined : s, t: undefined })} className={cn("rounded px-2 py-1", status === s ? "bg-sky font-medium text-ink" : "text-muted hover:text-ink")}>{s === "open" ? "Open" : s === "closed" ? "Closed" : "All"}</Link>
            ))}
          </nav>
          {threads.length === 0 ? (
            <EmptyState title={sp.q ? "No conversations match" : "No conversations yet"}>Emails sent to this inbox, and emails you send to leads and clients, appear here.</EmptyState>
          ) : (
            <ul className="flex-1 divide-y divide-hairline overflow-y-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={href({ t: t.id })} aria-current={t.id === selectedId ? "true" : undefined} className={cn("block px-3.5 py-3 hover:bg-sunken", t.id === selectedId && "bg-sky")}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-[13px]", t.unread ? "font-semibold text-ink" : "text-ink-2")}>{t.counterpartName ?? t.counterpartEmail}</span>
                      <span className="shrink-0 text-[11px] text-muted"><LocalTime value={t.lastMessageAt} mode="relative" /></span>
                    </span>
                    <span className={cn("mt-0.5 block truncate text-[13px]", t.unread ? "text-ink" : "text-ink-2")}>{t.unread ? <span className="mr-1.5 inline-block size-1.5 rounded-full bg-hub-red align-middle" aria-label="Unread" /> : null}{t.subject}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{t.lastDirection === "outbound" ? "You: " : ""}{t.preview}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="flex min-w-0 flex-col">
          {!detail ? (
            <EmptyState title="Choose a conversation" />
          ) : (
            <>
              <PanelHeader
                title={detail.thread.subject}
                description={
                  <>
                    {detail.thread.counterpartName ? `${detail.thread.counterpartName} · ` : ""}{detail.thread.counterpartEmail}
                    {detail.lead ? <> · Lead <Link className="underline-offset-2 hover:underline" href={`${base}/leads/${detail.lead.id}`}>{detail.lead.ref}</Link></> : null}
                    {detail.client ? <> · Client <Link className="underline-offset-2 hover:underline" href={`${base}/clients/${detail.client.id}`}>{detail.client.ref}</Link></> : null}
                    {detail.thread.intakeItemId ? <> · <Link className="underline-offset-2 hover:underline" href={`/hq/intake/${detail.thread.intakeItemId}`}>Hub enquiry</Link></> : null}
                  </>
                }
                actions={canSend ? <ThreadActions scopeKey={scopeKey} threadId={detail.thread.id} status={detail.thread.status} canCreateLead={canCreateLead && where.kind === "firm" && !detail.lead && !detail.client} /> : undefined}
              />
              <ol className="flex-1 divide-y divide-hairline">
                {detail.messages.map((m) => (
                  <li key={m.id} className={cn("px-4 py-4", m.direction === "outbound" && "bg-paper")}>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-medium text-ink">{m.direction === "outbound" ? (m.senderName ?? m.fromName ?? "You") : fullName(m.fromName ?? m.fromAddress, null)}</span>
                      <span>{m.direction === "outbound" ? `to ${m.toAddresses.join(", ")}` : `<${m.fromAddress}>`}</span>
                      <LocalTime value={m.createdAt} />
                      <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                      {m.attachments.length ? <Badge tone="outline">{m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}</Badge> : null}
                      {m.authResult?.includes("dmarc=fail") ? <Badge tone="danger">Sender not verified</Badge> : null}
                    </div>
                    {m.error ? <p className="mb-2 text-xs text-danger">{m.error}</p> : null}
                    <MessageBody id={m.id} text={m.textBody} html={m.htmlBody} />
                    {m.attachments.length ? <p className="mt-2 text-xs text-muted">Attachments: {m.attachments.map((a) => a.filename).join(", ")} (kept in Resend; download arrives with document storage).</p> : null}
                  </li>
                ))}
              </ol>
              <div className="border-t border-hairline">
                <ReplyForm scopeKey={scopeKey} threadId={detail.thread.id} templates={templates} canSend={canSend} />
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

"use client";

import {
  ArrowLeft, CircleCheck, Forward, Link2, Loader2, MailOpen, Paperclip, PenLine, RefreshCw, Reply, ReplyAll, Search, StickyNote, Unlink, UserPlus,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addNoteAction,
  assignAction,
  conversationStatusAction,
  createEnquiryFromThreadAction,
  linkAction,
  markUnreadAction,
  searchLinkTargetsAction,
  syncNowAction,
} from "@/app/(staff)/inbox-actions";
import { MessageBody } from "@/components/email/client";
import { Composer, type ComposeMode, type ComposerInitial } from "@/components/email/composer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ActionFeedback, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Select, Textarea, cn } from "@/components/ui/primitives";

/* ───────────── list header ───────────── */

export function NewEmailButton({ practice }: { practice: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}><PenLine /> New email</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent title="New email" wide className="max-w-3xl">
            <Composer initial={{ practice, mode: "new" }} onDone={(id) => { setOpen(false); router.push(`/inbox?t=${id}`); }} onCancel={() => setOpen(false)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function DraftOpener({ draft, children }: { draft: ComposerInitial & { id: string; practice: string | null; mode: ComposeMode }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full px-4 py-3 text-left hover:bg-sunken">{children}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent title="Draft" wide className="max-w-3xl">
            <Composer initial={{ ...draft, draftId: draft.id }} onDone={(id) => { setOpen(false); router.push(`/inbox?t=${id}`); }} onCancel={() => { setOpen(false); router.refresh(); }} />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

type FilterValues = { q: string; status: string; practice: string; mailbox: string; assignee: string; linked: string; unread: boolean };

export function InboxFilterBar({ practices, mailboxes, values }: { practices: { id: string; name: string }[]; mailboxes: { id: string; label: string; firmId: string | null }[]; values: FilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(values.q);
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    p.delete("t");
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    router.push(`${pathname}${p.size ? `?${p}` : ""}`);
  };
  const boxes = mailboxes.filter((m) => !values.practice || (values.practice === "hub" ? m.firmId === null : m.firmId === values.practice));
  const sel = "h-7 w-auto rounded-md border border-hairline-strong bg-surface px-1.5 text-xs text-ink-2";
  return (
    <div className="flex flex-col gap-2 border-b border-hairline px-4 pb-3">
      <form role="search" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null }); }} className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, subjects and message text" aria-label="Search conversations" className="h-8 w-full rounded-md border border-hairline-strong bg-surface pr-2.5 pl-8 text-[13px] outline-none focus:border-navy" />
      </form>
      <div className="flex flex-wrap gap-1.5">
        {practices.length > 1 ? (
          <select aria-label="Practice" className={sel} value={values.practice} onChange={(e) => set({ practice: e.target.value || null, mailbox: null })}>
            <option value="">All practices</option>
            {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <select aria-label="Mailbox" className={sel} value={values.mailbox} onChange={(e) => set({ mailbox: e.target.value || null })}>
          <option value="">All mailboxes</option>
          {boxes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select aria-label="Assigned" className={sel} value={values.assignee} onChange={(e) => set({ assignee: e.target.value || null })}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select aria-label="Status" className={sel} value={values.status} onChange={(e) => set({ status: e.target.value === "open" ? null : e.target.value })}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <select aria-label="Linked to a record" className={sel} value={values.linked} onChange={(e) => set({ linked: e.target.value || null })}>
          <option value="">Linked or not</option>
          <option value="linked">Linked to a record</option>
          <option value="unlinked">Not linked</option>
        </select>
        <label className="inline-flex h-7 items-center gap-1 rounded-md border border-hairline-strong px-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={values.unread} onChange={(e) => set({ unread: e.target.checked ? "1" : null })} /> Unread
        </label>
      </div>
    </div>
  );
}

/* ───────────── conversation ───────────── */

type Attachment = { id: string; filename: string; contentType: string; size: number | null; fileId?: string | null; inline?: boolean };
type Msg = {
  id: string; direction: "inbound" | "outbound"; status: string; via: string | null; fromAddress: string; fromName: string | null; senderName: string | null;
  toAddresses: string[]; ccAddresses: string[]; bccAddresses: string[]; subject: string; textBody: string | null; htmlBody: string | null; attachments: Attachment[];
  error: string | null; authResult: string | null; at: string; acceptedAt: string | null; templated: boolean;
};
type Note = { id: string; body: string; authorName: string | null; createdAt: string };
type Data = {
  thread: { id: string; subject: string; status: "open" | "closed"; counterpartEmail: string; counterpartName: string | null; firmId: string | null; mailboxId: string | null };
  firm: { id: string; slug: string; tradingName: string; brandColor: string } | null;
  mailbox: { id: string; label: string; provider: string; kind: string; fromAddress: string } | null;
  assignee: { id: string; name: string } | null;
  lead: { id: string; ref: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; category: string | null } | null;
  client: { id: string; ref: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; status: string } | null;
  intake: { id: string; firstName: string; status: string } | null;
  related: { id: string; subject: string; lastMessageAt: Date | string; status: string }[];
  canSend: boolean;
  canCreateEnquiry: boolean;
  assignees: { id: string; name: string }[];
  notes: Note[];
  messages: Msg[];
  drafts: { id: string; mode: ComposeMode; mailboxId: string | null; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; replyToMessageId: string | null; templateId: string | null; slots: Record<string, string>; fields: Record<string, string> }[];
};

const PROVIDER: Record<string, string> = { microsoft: "Microsoft 365", google: "Gmail", resend: "Resend", forwarding: "forwarding" };

function statusInfo(m: Msg): { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "outline"; title: string } {
  const via = PROVIDER[m.via ?? ""] ?? "the provider";
  switch (m.status) {
    case "received": return { label: "Received", tone: "outline", title: m.authResult ? `Sender checks: ${m.authResult}` : "Received" };
    case "queued": return { label: "Sending…", tone: "outline", title: "Handed to the server, waiting for the provider" };
    case "sent": return { label: m.direction === "outbound" && m.via !== "resend" ? `Sent via ${via}` : "Accepted", tone: "ok", title: `${via} accepted this message${m.acceptedAt ? ` at ${new Date(m.acceptedAt).toLocaleString()}` : ""}. ${m.via === "resend" ? "Delivery is reported when the receiving server confirms it." : "This provider doesn't report delivery."}` };
    case "delivered": return { label: "Delivered", tone: "ok", title: "The recipient's mail server confirmed delivery" };
    case "bounced": return { label: "Bounced", tone: "danger", title: m.error ?? "The recipient's server rejected it" };
    case "complained": return { label: "Marked as spam", tone: "danger", title: "The recipient reported it as spam" };
    case "failed": return { label: "Not sent", tone: "danger", title: m.error ?? "The provider refused it" };
    case "not_configured": return { label: "Not sent", tone: "warn", title: "Sending wasn't connected when this was written" };
    default: return { label: m.status, tone: "neutral", title: m.status };
  }
}

const initials = (n: string) => n.split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function ConversationView({ data, backHref }: { data: Data; backHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const lastInbound = [...data.messages].reverse().find((m) => m.direction === "inbound") ?? data.messages.at(-1) ?? null;
  const existingDraft = data.drafts[0] ?? null;
  const [compose, setCompose] = useState<ComposerInitial | null>(
    existingDraft
      ? { draftId: existingDraft.id, mode: existingDraft.mode, mailboxId: existingDraft.mailboxId, to: existingDraft.to, cc: existingDraft.cc, bcc: existingDraft.bcc, subject: existingDraft.subject, body: existingDraft.body, replyToMessageId: existingDraft.replyToMessageId, templateId: existingDraft.templateId, slots: existingDraft.slots, fields: existingDraft.fields, threadId: data.thread.id, practice: data.thread.firmId }
      : null,
  );
  const composerRef = useRef<HTMLDivElement>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Done.");
        router.refresh();
      } else toast.error(r.error ?? "Something went wrong.");
    });

  function startCompose(mode: ComposeMode, m: Msg | null = lastInbound) {
    const own = (data.mailbox?.fromAddress ?? "").toLowerCase();
    let to: string[] = [];
    let cc: string[] = [];
    if (m && mode !== "forward") {
      to = m.direction === "inbound" ? [m.fromAddress] : m.toAddresses;
      if (mode === "reply_all") {
        const everyone = [...m.toAddresses, ...m.ccAddresses].map((a) => a.toLowerCase()).filter((a) => a !== own && !to.includes(a) && !a.includes("+t"));
        cc = [...new Set(everyone)];
      }
    }
    setTab("reply");
    setCompose({ mode, to, cc, threadId: data.thread.id, replyToMessageId: m?.id ?? null, practice: data.thread.firmId, mailboxId: data.thread.mailboxId, leadId: null, clientId: null });
    setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const timeline = useMemo(() => {
    const items: ({ kind: "msg"; at: string; m: Msg } | { kind: "note"; at: string; n: Note })[] = [
      ...data.messages.map((m) => ({ kind: "msg" as const, at: m.at, m })),
      ...data.notes.map((n) => ({ kind: "note" as const, at: n.createdAt, n })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [data.messages, data.notes]);

  return (
    <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-h-0 flex-col">
        {/* Header */}
        <header className="border-b border-hairline bg-surface px-4 py-3 lg:px-6">
          <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink lg:hidden"><ArrowLeft className="size-3.5" /> All conversations</Link>
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <h2 className="min-w-0 flex-1 font-display text-[22px] leading-tight text-ink">{data.thread.subject}</h2>
            {data.thread.status === "closed" ? <Badge tone="neutral">Closed</Badge> : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: data.firm?.brandColor ?? "var(--hub-red)" }} aria-hidden="true" />{data.firm?.tradingName ?? "Global Immigration Hub"}</span>
            <span>·</span>
            <span>{data.mailbox ? `${data.mailbox.label}${data.mailbox.kind === "personal" ? " (personal)" : ""} · ${PROVIDER[data.mailbox.provider] ?? data.mailbox.provider}` : "No mailbox"}</span>
            <span>·</span>
            <span>{data.thread.counterpartName ? `${data.thread.counterpartName} <${data.thread.counterpartEmail}>` : data.thread.counterpartEmail}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {data.canSend ? (
              <>
                <Button size="sm" variant="primary" onClick={() => startCompose("reply")}><Reply /> Reply</Button>
                <Button size="sm" onClick={() => startCompose("reply_all")}><ReplyAll /> Reply all</Button>
                <Button size="sm" onClick={() => startCompose("forward")}><Forward /> Forward</Button>
                <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />
                <Select aria-label="Assigned to" className="h-7 w-auto text-xs" value={data.assignee?.id ?? ""} disabled={pending} onChange={(e) => run(() => assignAction(data.thread.id, e.target.value))}>
                  <option value="">Unassigned</option>
                  {data.assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => conversationStatusAction(data.thread.id, data.thread.status === "open" ? "closed" : "open"))}><CircleCheck /> {data.thread.status === "open" ? "Close" : "Reopen"}</Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => markUnreadAction(data.thread.id))}><MailOpen /> Mark unread</Button>
            <Button size="sm" variant="ghost" onClick={() => { setTab("note"); setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }}><StickyNote /> Internal note</Button>
          </div>
        </header>

        {/* Timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ol className="flex flex-col gap-3 px-4 py-4 lg:px-6">
            {timeline.map((item) =>
              item.kind === "note" ? (
                <li key={`n-${item.n.id}`} className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3">
                  <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-warn">
                    <StickyNote className="size-3.5" />
                    <span className="font-semibold">Internal note</span>
                    <span>· {item.n.authorName ?? "Someone"} · <LocalTime value={item.n.createdAt} /></span>
                    <span className="ml-auto">Only your team sees this</span>
                  </p>
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{item.n.body}</p>
                </li>
              ) : (
                <MessageCard key={item.m.id} m={item.m} canSend={data.canSend} onReply={(mode) => startCompose(mode, item.m)} />
              ),
            )}
          </ol>

          {/* Reply or note */}
          <div ref={composerRef} className="border-t border-hairline bg-surface px-4 py-4 lg:px-6">
            <div className="mb-3 flex gap-1 text-[13px]" role="tablist">
              {data.canSend ? <button type="button" role="tab" aria-selected={tab === "reply"} onClick={() => setTab("reply")} className={cn("rounded-md px-3 py-1.5", tab === "reply" ? "bg-navy text-white" : "text-ink-2 hover:bg-sunken")}>Email the client</button> : null}
              <button type="button" role="tab" aria-selected={tab === "note"} onClick={() => setTab("note")} className={cn("rounded-md px-3 py-1.5", tab === "note" ? "bg-warn text-white" : "text-ink-2 hover:bg-sunken")}>Internal note</button>
            </div>
            {tab === "note" ? (
              <NoteForm threadId={data.thread.id} onSaved={() => router.refresh()} />
            ) : !data.canSend ? (
              <p className="text-[13px] text-muted">You can read this conversation but not reply from this inbox.</p>
            ) : compose ? (
              <Composer key={`${compose.mode}-${compose.replyToMessageId}-${compose.draftId ?? ""}`} initial={compose} autoFocus={false} onDone={() => { setCompose(null); router.refresh(); }} onCancel={() => { setCompose(null); router.refresh(); }} />
            ) : (
              <button type="button" onClick={() => startCompose("reply")} className="w-full rounded-md border border-dashed border-hairline-strong px-4 py-4 text-left text-[13px] text-muted hover:border-navy hover:text-ink">
                Reply to {data.thread.counterpartName ?? data.thread.counterpartEmail}…
              </button>
            )}
          </div>
        </div>
      </div>

      <SidePanel data={data} onRun={run} pending={pending} />
    </div>
  );
}

function MessageCard({ m, canSend, onReply }: { m: Msg; canSend: boolean; onReply: (mode: ComposeMode) => void }) {
  const s = statusInfo(m);
  const name = m.direction === "outbound" ? (m.senderName ?? m.fromName ?? m.fromAddress) : (m.fromName ?? m.fromAddress);
  const forged = m.authResult?.includes("dmarc=fail");
  return (
    <li className={cn("rounded-lg border bg-surface", m.direction === "outbound" ? "border-navy/15" : "border-hairline", forged && "border-danger/40")}>
      <div className="flex flex-wrap items-start gap-3 border-b border-hairline px-4 py-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", m.direction === "outbound" ? "bg-navy text-white" : "bg-sky text-ink")} aria-hidden="true">{initials(name)}</span>
        <div className="min-w-0 flex-1 text-xs text-muted">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-medium text-ink">{name}</span>
            <span>&lt;{m.fromAddress}&gt;</span>
          </p>
          <p className="mt-0.5 break-words">
            to {m.toAddresses.join(", ") || "—"}
            {m.ccAddresses.length ? <> · cc {m.ccAddresses.join(", ")}</> : null}
            {m.bccAddresses.length ? <> · bcc {m.bccAddresses.join(", ")}</> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
          <LocalTime value={m.at} />
          <Badge tone={s.tone} title={s.title}>{s.label}</Badge>
        </div>
      </div>
      {forged ? <p className="border-b border-danger/20 bg-danger-soft px-4 py-2 text-xs text-danger">This sender failed verification and may be forged. Don&apos;t act on payment or bank-detail changes in it.</p> : null}
      {m.error && (m.status === "failed" || m.status === "bounced") ? <p className="border-b border-danger/20 bg-danger-soft px-4 py-2 text-xs text-danger">{m.error}</p> : null}
      <div className="px-4 py-3">
        <MessageBody id={m.id} text={m.textBody} html={m.htmlBody} preferFormatted={m.direction === "outbound" && m.templated} />
        {m.attachments.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {m.attachments.filter((a) => !a.inline).map((a) => (
              <li key={a.id}>
                <a href={a.fileId ? `/api/email/files/${a.fileId}` : `/api/email/messages/${m.id}/attachments/${encodeURIComponent(a.id)}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline bg-paper px-2 text-xs text-ink hover:border-navy">
                  <Paperclip className="size-3.5 text-muted" /> {a.filename}{a.size ? <span className="text-muted">{a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {canSend ? (
          <div className="mt-3 flex gap-1">
            <button type="button" onClick={() => onReply("reply")} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-sunken hover:text-ink"><Reply className="size-3.5" /> Reply</button>
            <button type="button" onClick={() => onReply("reply_all")} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-sunken hover:text-ink"><ReplyAll className="size-3.5" /> Reply all</button>
            <button type="button" onClick={() => onReply("forward")} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-sunken hover:text-ink"><Forward className="size-3.5" /> Forward</button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function NoteForm({ threadId, onSaved }: { threadId: string; onSaved: () => void }) {
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof addNoteAction>> | null, form: FormData) => {
    const r = await addNoteAction(threadId, prev, form);
    if (r.ok) onSaved();
    return r;
  }, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn-soft p-3">
      <ActionFeedback state={state} />
      <Textarea name="body" rows={3} required maxLength={5000} placeholder="Note for the team: never sent to the client" className="bg-surface" />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…"><StickyNote /> Add note</SubmitButton>
        <span className="text-xs text-warn">Visible to staff with access to this inbox. Also logged on the linked record.</span>
      </div>
    </form>
  );
}

/* ───────────── side panel ───────────── */

function SidePanel({ data, onRun, pending }: { data: Data; onRun: (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => void; pending: boolean }) {
  const firmSlug = data.firm?.slug;
  return (
    <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto border-l border-hairline bg-surface p-4 xl:flex" aria-label="Linked records">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Linked record</h3>
        {data.client && firmSlug ? (
          <RecordCard href={`/f/${firmSlug}/clients/${data.client.id}`} kind="Client" title={[data.client.firstName, data.client.lastName].filter(Boolean).join(" ")} refText={data.client.ref} lines={[data.client.email, data.client.phone, `Status: ${data.client.status}`]} />
        ) : data.lead && firmSlug ? (
          <RecordCard href={`/f/${firmSlug}/leads/${data.lead.id}`} kind="Enquiry" title={[data.lead.firstName, data.lead.lastName].filter(Boolean).join(" ")} refText={data.lead.ref} lines={[data.lead.email, data.lead.phone, data.lead.category]} />
        ) : data.intake ? (
          <RecordCard href={`/hq/intake/${data.intake.id}`} kind="Hub enquiry" title={data.intake.firstName} refText={data.intake.status} lines={["Route it to a practice from Hub intake."]} />
        ) : (
          <p className="text-[13px] text-muted">Not linked yet.</p>
        )}
        {data.canSend && data.thread.firmId && (data.lead || data.client) ? (
          <button type="button" disabled={pending} onClick={() => onRun(() => linkAction(data.thread.id, {}))} className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"><Unlink className="size-3.5" /> Unlink</button>
        ) : null}
        {data.canSend && data.thread.firmId && !data.lead && !data.client ? <LinkSearch firmId={data.thread.firmId} threadId={data.thread.id} onRun={onRun} /> : null}
        {data.canCreateEnquiry && !data.lead && !data.client && !data.intake ? (
          <Button size="sm" className="mt-2 w-full" disabled={pending} onClick={() => onRun(() => createEnquiryFromThreadAction(data.thread.id, data.thread.firmId))}>
            <UserPlus /> {data.thread.firmId ? "Create enquiry from this email" : "Open a Hub enquiry"}
          </Button>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">Tasks from email arrive with Tasks &amp; Calendar (milestone 2).</p>
      </section>

      {data.related.length ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Other conversations with this person</h3>
          <ul className="flex flex-col gap-1">
            {data.related.map((r) => (
              <li key={r.id}>
                <Link href={`/inbox?t=${r.id}&status=all`} className="block rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-sunken hover:text-ink">
                  <span className="block truncate">{r.subject}</span>
                  <span className="text-[11px] text-muted"><LocalTime value={r.lastMessageAt} mode="date" /> · {r.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.mailbox && data.mailbox.provider !== "forwarding" ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Mailbox</h3>
          <p className="text-[13px] text-ink-2">{data.mailbox.label}</p>
          <Button size="sm" variant="ghost" className="mt-1 -ml-2" disabled={pending} onClick={() => onRun(() => syncNowAction(data.mailbox!.id))}>{pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now</Button>
        </section>
      ) : null}
    </aside>
  );
}

function RecordCard({ href, kind, title, refText, lines }: { href: string; kind: string; title: string; refText: string; lines: (string | null)[] }) {
  return (
    <Link href={href} className="block rounded-lg border border-hairline bg-paper p-3 hover:border-navy">
      <p className="text-[11px] font-medium tracking-wide text-hub-red uppercase">{kind} · {refText}</p>
      <p className="mt-0.5 text-[14px] font-medium text-ink">{title}</p>
      {lines.filter(Boolean).map((l) => <p key={l} className="truncate text-xs text-muted">{l}</p>)}
    </Link>
  );
}

function LinkSearch({ firmId, threadId, onRun }: { firmId: string; threadId: string; onRun: (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ leads: { id: string; ref: string; firstName: string; lastName: string | null; email: string | null }[]; clients: { id: string; ref: string; firstName: string; lastName: string | null; email: string | null }[] } | null>(null);
  const [searching, start] = useTransition();
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => start(async () => {
      const r = await searchLinkTargetsAction(firmId, q);
      if (r.ok) setResults(r.data);
    }), 250);
    return () => clearTimeout(t);
  }, [q, firmId]);
  const shown = q.trim().length < 2 ? null : results;
  return (
    <div className="mt-2">
      <label className="relative block">
        <Link2 className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link to a client or enquiry…" aria-label="Find a record to link" className="h-8 w-full rounded-md border border-hairline-strong bg-surface pr-2 pl-7 text-[13px] outline-none focus:border-navy" />
      </label>
      {searching ? <p className="mt-1 text-xs text-muted">Searching…</p> : null}
      {shown ? (
        <ul className="mt-1 flex flex-col rounded-md border border-hairline">
          {[...shown.clients.map((c) => ({ ...c, kind: "Client" as const })), ...shown.leads.map((l) => ({ ...l, kind: "Enquiry" as const }))].map((r) => (
            <li key={r.id}>
              <button type="button" className="block w-full px-2 py-1.5 text-left text-[13px] hover:bg-sunken" onClick={() => onRun(() => linkAction(threadId, r.kind === "Client" ? { clientId: r.id } : { leadId: r.id }))}>
                <span className="text-ink">{[r.firstName, r.lastName].filter(Boolean).join(" ")}</span> <span className="text-xs text-muted">{r.kind} {r.ref}</span>
                {r.email ? <span className="block truncate text-[11px] text-muted">{r.email}</span> : null}
              </button>
            </li>
          ))}
          {!shown.clients.length && !shown.leads.length ? <li className="px-2 py-1.5 text-xs text-muted">No matches in this practice.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

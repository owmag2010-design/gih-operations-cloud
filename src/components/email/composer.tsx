"use client";

import { Eye, EyeOff, FileText, Loader2, Monitor, Paperclip, Send, Smartphone, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  composeOptionsAction,
  deleteDraftAction,
  previewMessageAction,
  saveDraftAction,
  sendMessageAction,
  type MailboxOption,
  type PreviewData,
  type TemplateChoice,
} from "@/app/(staff)/inbox-actions";
import { Button, Input, Notice, Select, Textarea, cn } from "@/components/ui/primitives";
import { MERGE_FIELDS } from "@/server/modules/email/render";
import { EmailFrame } from "./frame";

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export type ComposerInitial = {
  mailboxId?: string | null;
  /** Restrict to one practice's mailboxes: a firm id, null for the Hub, undefined for any. */
  practice?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  threadId?: string | null;
  mode?: ComposeMode;
  replyToMessageId?: string | null;
  leadId?: string | null;
  clientId?: string | null;
  draftId?: string | null;
  templateId?: string | null;
  slots?: Record<string, string>;
  fields?: Record<string, string>;
  attachments?: { id: string; filename: string; size: number }[];
};

const PROVIDER_LABEL: Record<string, string> = { microsoft: "Microsoft 365", google: "Gmail", forwarding: "Resend" };
const list = (v: string) => v.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Compose, reply, reply all and forward. The sending address is always shown;
 * a preview checks merge fields and template sections before anything is sent.
 * Drafts save automatically and are private to their author.
 */
export function Composer({ initial, onDone, onCancel, autoFocus = true }: { initial: ComposerInitial; onDone?: (threadId: string) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const mode = initial.mode ?? "new";
  const [options, setOptions] = useState<{ mailboxes: MailboxOption[]; templates: TemplateChoice[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosenMailboxId, setMailboxId] = useState(initial.mailboxId ?? "");
  const [to, setTo] = useState((initial.to ?? []).join(", "));
  const [cc, setCc] = useState((initial.cc ?? []).join(", "));
  const [bcc, setBcc] = useState((initial.bcc ?? []).join(", "));
  const [showCopies, setShowCopies] = useState(Boolean(initial.cc?.length || initial.bcc?.length));
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [templateId, setTemplateId] = useState(initial.templateId ?? "");
  const [slots, setSlots] = useState<Record<string, string>>(initial.slots ?? {});
  const [fields, setFields] = useState<Record<string, string>>(initial.fields ?? {});
  const [format, setFormat] = useState<"branded" | "plain">(mode === "new" ? "branded" : "plain");
  const [attachments, setAttachments] = useState(initial.attachments ?? []);
  const [uploading, setUploading] = useState(0);
  const [draftId, setDraftId] = useState(initial.draftId ?? null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile" | "text">("desktop");
  const [sending, startSend] = useTransition();
  const [previewing, startPreview] = useTransition();
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    composeOptionsAction().then((r) => {
      if (!live) return;
      if (!r.ok || !r.data) return setLoadError(r.ok ? "Couldn't load mailboxes." : r.error);
      setOptions(r.data);
    });
    return () => {
      live = false;
    };
  }, []);

  const mailboxes = useMemo(() => (options?.mailboxes ?? []).filter((m) => initial.practice === undefined || m.firmId === initial.practice), [options, initial.practice]);
  // The chosen mailbox, or a sensible default: your own connected mailbox first, then the practice inbox.
  const mailboxId = mailboxes.some((m) => m.id === chosenMailboxId) ? chosenMailboxId : ((mailboxes.find((m) => m.kind === "personal" && m.provider !== "forwarding") ?? mailboxes[0])?.id ?? "");
  const mailbox = mailboxes.find((m) => m.id === mailboxId) ?? null;
  const templates = useMemo(() => (options?.templates ?? []).filter((t) => !mailbox || t.firmId === null || t.firmId === mailbox.firmId), [options, mailbox]);
  const template = templates.find((t) => t.id === templateId) ?? null;

  const payload = useCallback(
    () => ({
      mailboxId, to: list(to), cc: list(cc), bcc: list(bcc), subject: subject || undefined, body: body || undefined, templateId: templateId || null,
      slots, fields, format, attachmentIds: attachments.map((a) => a.id), threadId: initial.threadId ?? null, mode, replyToMessageId: initial.replyToMessageId ?? null,
      leadId: initial.leadId ?? null, clientId: initial.clientId ?? null, draftId,
    }),
    [mailboxId, to, cc, bcc, subject, body, templateId, slots, fields, format, attachments, initial.threadId, mode, initial.replyToMessageId, initial.leadId, initial.clientId, draftId],
  );

  const touch = () => {
    dirty.current = true;
    setPreview(null);
  };

  // Draft autosave every 10 seconds while something has changed.
  useEffect(() => {
    const t = setInterval(async () => {
      if (!dirty.current || !mailboxId || sending) return;
      dirty.current = false;
      const p = payload();
      const r = await saveDraftAction({ id: draftId, mailboxId, threadId: p.threadId, replyToMessageId: p.replyToMessageId, mode, to, cc, bcc, subject, body, templateId: templateId || null, slots, fields, attachmentIds: p.attachmentIds, leadId: p.leadId, clientId: p.clientId });
      if (r.ok && r.data) {
        setDraftId(r.data.id);
        setSavedAt(new Date());
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [payload, draftId, mailboxId, mode, to, cc, bcc, subject, body, templateId, slots, fields, sending]);

  async function upload(files: FileList | null) {
    if (!files?.length || !mailbox) return;
    for (const f of Array.from(files)) {
      if (f.size > 4 * 1024 * 1024) {
        toast.error(`${f.name} is over 4 MB. Share large files as a link instead.`);
        continue;
      }
      setUploading((n) => n + 1);
      const fd = new FormData();
      fd.set("file", f);
      fd.set("practice", mailbox.firmId ?? "hub");
      try {
        const res = await fetch("/api/email/upload", { method: "POST", body: fd });
        const j = (await res.json()) as { ok: boolean; error?: string; file?: { id: string; filename: string; size: number } };
        if (j.ok && j.file) {
          setAttachments((a) => [...a, { id: j.file!.id, filename: j.file!.filename, size: j.file!.size }]);
          touch();
        } else toast.error(j.error ?? `Couldn't attach ${f.name}.`);
      } catch {
        toast.error(`Couldn't attach ${f.name}.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function runPreview(show = true) {
    startPreview(async () => {
      const r = await previewMessageAction(payload());
      if (r.ok && r.data) {
        setPreview(r.data);
        if (show) setShowPreview(true);
      } else if (!r.ok) toast.error(r.error);
    });
  }

  function send() {
    startSend(async () => {
      const check = await previewMessageAction(payload());
      if (!check.ok) return void toast.error(check.error);
      if (check.data && (check.data.missingFields.length || check.data.emptySlots.length)) {
        setPreview(check.data);
        setShowPreview(true);
        return void toast.error("Some details are missing. Fill them in below, then send.");
      }
      const r = await sendMessageAction(payload());
      if (r.ok && r.data) {
        toast.success(r.message ?? "Sent.");
        dirty.current = false;
        onDone?.(r.data.threadId);
      } else if (!r.ok) toast.error(r.error);
    });
  }

  async function discard() {
    if (draftId) await deleteDraftAction(draftId);
    dirty.current = false;
    onCancel?.();
  }

  if (loadError) return <Notice tone="danger">{loadError}</Notice>;
  if (!options) return <p className="flex items-center gap-2 p-4 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> Loading mailboxes…</p>;
  if (!mailboxes.length) return <Notice tone="warn">You don&apos;t have a mailbox you can send from{initial.practice !== undefined ? " in this practice" : ""}. Connect one under Settings › Email, or ask an administrator to give you access.</Notice>;

  const missing = preview?.missingFields ?? [];
  const empty = preview?.emptySlots ?? [];

  return (
    <div className="flex flex-col gap-3" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}>
      {/* Sender */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-hairline bg-paper px-3 py-2">
        <span className="w-14 shrink-0 text-xs font-medium text-muted">From</span>
        <Select aria-label="Send from" value={mailboxId} onChange={(e) => { setMailboxId(e.target.value); touch(); }} className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-[13px] font-medium shadow-none focus-visible:ring-0">
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fromName} &lt;{m.fromAddress}&gt; · {m.firmName}{m.kind === "personal" ? " · personal" : ""}
            </option>
          ))}
        </Select>
        {mailbox ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", mailbox.status === "needs_reconnect" || mailbox.status === "error" ? "bg-danger/10 text-danger" : "bg-sky text-ink-2")}>
            {mailbox.status === "needs_reconnect" ? "Needs reconnecting" : `via ${PROVIDER_LABEL[mailbox.provider] ?? mailbox.provider}`}
          </span>
        ) : null}
      </div>

      {/* Recipients */}
      <div className="flex flex-col divide-y divide-hairline rounded-md border border-hairline-strong bg-surface">
        <RecipientRow label="To" value={to} onChange={(v) => { setTo(v); touch(); }} autoFocus={autoFocus && mode !== "reply"} action={!showCopies ? <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setShowCopies(true)}>Cc / Bcc</button> : null} />
        {showCopies ? <RecipientRow label="Cc" value={cc} onChange={(v) => { setCc(v); touch(); }} /> : null}
        {showCopies ? <RecipientRow label="Bcc" value={bcc} onChange={(v) => { setBcc(v); touch(); }} hint="Hidden from other recipients" /> : null}
        <div className="flex items-center gap-3 px-3">
          <span className="w-14 shrink-0 text-xs font-medium text-muted">Subject</span>
          <input aria-label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} placeholder={template ? `Template: ${template.subject}` : mode === "new" ? "Subject" : "Keeps the conversation's subject if empty"} maxLength={250} className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
        </div>
      </div>

      {/* Template and format */}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); touch(); }} className="h-8 w-auto min-w-[220px] text-[13px]">
          <option value="">No template</option>
          {[...new Set(templates.map((t) => t.category))].map((g) => (
            <optgroup key={g} label={g}>
              {templates.filter((t) => t.category === g).map((t) => <option key={t.id} value={t.id}>{t.name}{t.firmId === null && mailbox?.firmId ? " · Hub" : ""}</option>)}
            </optgroup>
          ))}
        </Select>
        {!template ? (
          <div className="inline-flex rounded-md border border-hairline-strong p-0.5 text-xs" role="radiogroup" aria-label="Look">
            {(["plain", "branded"] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => { setFormat(f); touch(); }} className={cn("rounded px-2.5 py-1", format === f ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}>
                {f === "plain" ? "Plain message" : "Branded letter"}
              </button>
            ))}
          </div>
        ) : null}
        <span className="ml-auto text-[11px] text-muted" aria-live="polite">{savedAt ? `Draft saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
      </div>

      {/* Content */}
      {template?.format === "html" ? (
        <div className="flex flex-col gap-3 rounded-md border border-hairline bg-paper p-3">
          <p className="text-xs text-muted">Fill in the template&apos;s sections. The design, greeting and signature are added for you.</p>
          {template.slots.map((s) => (
            <label key={s.key} className="flex flex-col gap-1">
              <span className={cn("text-xs font-medium", empty.includes(s.key) ? "text-danger" : "text-ink-2")}>{s.label}{empty.includes(s.key) ? " · required" : ""}</span>
              {s.multiline ? (
                <Textarea rows={4} value={slots[s.key] ?? ""} placeholder={s.default} onChange={(e) => { setSlots((v) => ({ ...v, [s.key]: e.target.value })); touch(); }} />
              ) : (
                <Input value={slots[s.key] ?? ""} placeholder={s.default} onChange={(e) => { setSlots((v) => ({ ...v, [s.key]: e.target.value })); touch(); }} />
              )}
            </label>
          ))}
        </div>
      ) : (
        <Textarea
          aria-label={template ? "Personal note" : "Message"}
          rows={template ? 3 : mode === "new" ? 10 : 7}
          value={body}
          onChange={(e) => { setBody(e.target.value); touch(); }}
          placeholder={template ? "Optional personal note, added under the heading" : mode === "forward" ? "Add a note above the forwarded message (optional)" : "Write your message. Use {{first_name}} or {{reference}} to fill in details."}
          maxLength={50000}
          autoFocus={autoFocus && mode === "reply"}
        />
      )}

      {missing.length ? (
        <div className="flex flex-col gap-2 rounded-md border border-warn/40 bg-warn/5 p-3">
          <p className="text-xs font-medium text-ink">Fill in before sending</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {missing.map((k) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-xs text-ink-2">{MERGE_FIELDS[k as keyof typeof MERGE_FIELDS] ?? k}</span>
                <Input value={fields[k] ?? ""} onChange={(e) => { setFields((v) => ({ ...v, [k]: e.target.value })); dirty.current = true; }} placeholder={k.endsWith("_link") ? "https://…" : ""} />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* Attachments */}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" multiple className="sr-only" id={`att-${initial.threadId ?? "new"}`} onChange={(e) => upload(e.target.files)} />
        <label htmlFor={`att-${initial.threadId ?? "new"}`} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-hairline-strong px-2.5 text-xs text-ink-2 hover:bg-sunken">
          <Paperclip className="size-3.5" /> Attach files
        </label>
        {uploading ? <span className="flex items-center gap-1 text-xs text-muted"><Loader2 className="size-3 animate-spin" /> Uploading…</span> : null}
        {attachments.map((a) => (
          <span key={a.id} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-sunken pr-1 pl-2 text-xs text-ink">
            <FileText className="size-3.5 text-muted" /> {a.filename} <span className="text-muted">{kb(a.size)}</span>
            <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => { setAttachments((x) => x.filter((y) => y.id !== a.id)); touch(); }} className="rounded p-0.5 hover:bg-hairline"><X className="size-3" /></button>
          </span>
        ))}
      </div>

      {/* Preview */}
      {showPreview && preview ? (
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-paper p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>From <span className="text-ink">{preview.from}</span></span>
            <span>To <span className="text-ink">{[...preview.to, ...preview.cc.map((c) => `cc ${c}`), ...preview.bcc.map((c) => `bcc ${c}`)].join(", ")}</span></span>
            <div className="ml-auto inline-flex rounded-md border border-hairline-strong p-0.5" role="radiogroup" aria-label="Preview size">
              {([["desktop", Monitor, "Desktop"], ["mobile", Smartphone, "Mobile"], ["text", FileText, "Plain text"]] as const).map(([k, Icon, label]) => (
                <button key={k} type="button" role="radio" aria-checked={device === k} aria-label={label} title={label} onClick={() => setDevice(k)} className={cn("rounded px-2 py-1", device === k ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}><Icon className="size-3.5" /></button>
              ))}
            </div>
          </div>
          <p className="text-[13px] font-medium text-ink">{preview.subject}</p>
          {device === "text" ? (
            <pre className="max-h-[480px] overflow-auto rounded-md border border-hairline bg-white p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink">{preview.text}</pre>
          ) : (
            <div className={cn("mx-auto w-full transition-[max-width]", device === "mobile" ? "max-w-[390px]" : "max-w-none")}>
              <EmailFrame html={preview.html} title="Email preview" height={520} allowSameSiteImages />
            </div>
          )}
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <Button variant="primary" onClick={send} disabled={sending || uploading > 0 || !mailbox}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />} {sending ? "Sending…" : mode === "forward" ? "Forward" : mode === "new" ? "Send" : "Send reply"}
        </Button>
        <Button variant="secondary" onClick={() => (showPreview ? setShowPreview(false) : runPreview(true))} disabled={previewing}>
          {showPreview ? <EyeOff /> : <Eye />} {previewing ? "Preparing…" : showPreview ? "Hide preview" : "Preview"}
        </Button>
        <span className="hidden text-[11px] text-muted sm:inline">Ctrl/⌘ + Enter to send</span>
        <Button variant="ghost" className="ml-auto" onClick={discard}><Trash2 /> {draftId ? "Discard draft" : "Cancel"}</Button>
      </div>
    </div>
  );
}

function RecipientRow({ label, value, onChange, hint, action, autoFocus }: { label: string; value: string; onChange: (v: string) => void; hint?: string; action?: React.ReactNode; autoFocus?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3">
      <span className="w-14 shrink-0 text-xs font-medium text-muted">{label}</span>
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={hint ?? "name@example.com, another@example.com"} className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" autoFocus={autoFocus} />
      {action}
    </div>
  );
}

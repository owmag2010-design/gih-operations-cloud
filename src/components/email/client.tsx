"use client";

import { Eye, Mail, Send } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { createLeadFromThreadAction, previewComposeAction, replyAction, sendToRecordAction, setThreadStatusAction } from "@/app/(staff)/email-actions";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";

export type TemplateOption = { id: string; name: string; category: string; subject: string; hub: boolean };

/** Sandboxed preview of an email's HTML: no scripts, no same-origin, no remote images (CSP). */
/** Inside the frame nothing may load from the internet (tracking pixels, remote CSS): only inline and embedded content. */
const FRAME_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:">`;

export function EmailFrame({ html, title, height = 520, allowSameSiteImages = false }: { html: string; title: string; height?: number; allowSameSiteImages?: boolean }) {
  const csp = allowSameSiteImages ? FRAME_CSP.replace("img-src data: cid:", "img-src data: cid: https: http:") : FRAME_CSP;
  const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${csp}`) : `${csp}${html}`;
  return <iframe title={title} sandbox="" srcDoc={doc} className="w-full rounded-md border border-hairline bg-white" style={{ height }} />;
}

function TemplateSelect({ templates, value, onChange }: { templates: TemplateOption[]; value: string; onChange: (v: string) => void }) {
  const groups = [...new Set(templates.map((t) => t.category))];
  return (
    <Select name="templateId" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No template: write a message</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {templates.filter((t) => t.category === g).map((t) => <option key={t.id} value={t.id}>{t.name}{t.hub ? " (Hub)" : ""}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

/** "Email" button on a lead or client: choose a template or write, preview, send. */
export function ComposeDialog({ firmSlug, target, to, templates, disabled }: { firmSlug: string; target: { leadId?: string; clientId?: string }; to: string | null; templates: TemplateOption[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ html: string; subject: string; from: string } | null>(null);
  const [previewing, startPreview] = useTransition();
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof sendToRecordAction>> | null, form: FormData) => {
    const r = await sendToRecordAction(firmSlug, target, prev, form);
    if (r.ok) {
      setOpen(false);
      setPreview(null);
      setBody("");
      setSubject("");
      setTemplateId("");
    }
    return r;
  }, null);
  const chosen = templates.find((t) => t.id === templateId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled || !to} title={to ? undefined : "Add an email address first"}><Mail /> Email</Button>
      </DialogTrigger>
      <DialogContent title="Send an email" description={to ? `To ${to}. Replies come back to this firm's inbox.` : undefined} wide>
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <Field label="Template" name="templateId"><TemplateSelect templates={templates} value={templateId} onChange={(v) => { setTemplateId(v); setPreview(null); }} /></Field>
          <Field label="Subject" name="subject" hint={chosen ? `Leave empty to use “${chosen.subject}”.` : undefined} error={fieldError(state, "subject")}>
            <Input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} maxLength={200} required={!templateId} />
          </Field>
          <Field label={templateId ? "Personal note (optional)" : "Message"} name="body" hint="Use {{first_name}}, {{reference}} or {{sender_name}} to fill in details." error={fieldError(state, "body")}>
            <Textarea value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} rows={templateId ? 3 : 8} required={!templateId} maxLength={20000} />
          </Field>
          <Field label="Copy to (optional)" name="cc"><Input placeholder="name@example.com" /></Field>
          {preview ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">From {preview.from} · Subject: <span className="text-ink">{preview.subject}</span></p>
              <EmailFrame html={preview.html} title="Email preview" height={420} allowSameSiteImages />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={previewing}
              onClick={() =>
                startPreview(async () => {
                  const r = await previewComposeAction(firmSlug, target, { templateId, subject, body });
                  if (r.ok && r.data) setPreview(r.data);
                  else if (!r.ok) toast.error(r.error);
                })
              }
            >
              <Eye /> {previewing ? "Preparing…" : "Preview"}
            </Button>
            <SubmitButton pendingText="Sending…"><Send /> Send</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReplyForm({ scopeKey, threadId, templates, canSend }: { scopeKey: string; threadId: string; templates: TemplateOption[]; canSend: boolean }) {
  const [templateId, setTemplateId] = useState("");
  const [state, action] = useActionState(replyAction.bind(null, scopeKey, threadId), null);
  if (!canSend) return <p className="px-4 py-3 text-[13px] text-muted">You can read this conversation but not reply.</p>;
  return (
    <form action={action} className="flex flex-col gap-3 p-4">
      <ActionFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Field label="Reply" name="body" error={fieldError(state, "body")}><Textarea rows={5} required={!templateId} maxLength={20000} placeholder="Write your reply…" /></Field>
        <Field label="Template" name="templateId"><TemplateSelect templates={templates} value={templateId} onChange={setTemplateId} /></Field>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton pendingText="Sending…"><Send /> Send reply</SubmitButton>
        <span className="text-xs text-muted">Sent in your firm&apos;s branding. Replies come back here.</span>
      </div>
    </form>
  );
}

export function ThreadActions({ scopeKey, threadId, status, canCreateLead }: { scopeKey: string; threadId: string; status: "open" | "closed"; canCreateLead: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done.");
      else toast.error(r.error ?? "Something went wrong.");
    });
  return (
    <div className="flex flex-wrap gap-2">
      {canCreateLead ? <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => createLeadFromThreadAction(scopeKey, threadId))}>Create lead from this email</Button> : null}
      <Button size="sm" disabled={pending} onClick={() => run(() => setThreadStatusAction(scopeKey, threadId, status === "open" ? "closed" : "open"))}>{status === "open" ? "Close conversation" : "Reopen"}</Button>
    </div>
  );
}

export function MessageBody({ text, html, id }: { text: string | null; html: string | null; id: string }) {
  const [formatted, setFormatted] = useState(false);
  return (
    <div>
      {formatted && html ? <EmailFrame html={html} title={`Message ${id}`} height={460} /> : <p className="max-w-[80ch] text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{text?.trim() || "(No plain-text version. Show the formatted email.)"}</p>}
      {html ? (
        <button type="button" onClick={() => setFormatted((v) => !v)} className="mt-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          {formatted ? "Show plain text" : "Show formatted email"}
        </button>
      ) : null}
    </div>
  );
}

export function NotConnectedNotice() {
  return <Notice tone="warn">Email sending isn&apos;t connected on this server yet. Messages are saved but not delivered until a Resend key is added.</Notice>;
}

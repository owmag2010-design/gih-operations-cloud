"use client";

import { Check, Copy, FileUp, RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { DocEditor, type DocJson } from "@/components/documents/editor";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, cn, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import {
  aiDraftAction, approveAction, autosaveAction, commentAction, createDocumentAction, detailsAction, duplicateAction, finaliseAction, reopenAction, requestChangesAction, rerunOcrAction,
  resolveCommentAction, restoreVersionAction, saveTemplateAction, saveVersionAction, submitAction, templateActiveAction,
} from "./actions";

function useAct() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult | void>) =>
    start(async () => {
      const r = await fn();
      if (!r) return;
      if (r.ok) toast.success(r.message); else toast.error(r.error);
    });
  return [pending, run] as const;
}

/* ───────── New document ───────── */

type NewOptions = {
  templates: { id: string; name: string; kind: string; isStarter: boolean }[];
  clients: { id: string; ref: string; firstName: string; lastName: string | null }[];
  matters: { id: string; ref: string; title: string; clientId: string }[];
};

export function NewDocumentForm({ slug, options, kinds, defaults }: { slug: string; options: NewOptions; kinds: [string, string][]; defaults: { matterId?: string; clientId?: string; templateId?: string } }) {
  const [state, action] = useActionState(createDocumentAction.bind(null, slug), null);
  const fromMatter = options.matters.find((m) => m.id === defaults.matterId);
  const [clientId, setClientId] = useState(fromMatter?.clientId ?? defaults.clientId ?? "");
  const [templateId, setTemplateId] = useState(defaults.templateId ?? "");
  const [kind, setKind] = useState(options.templates.find((t) => t.id === defaults.templateId)?.kind ?? "letter");
  const [title, setTitle] = useState("");
  const own = options.matters.filter((m) => !clientId || m.clientId === clientId);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <Field label="Template" name="templateId" idPrefix="nd" hint="Merge fields are filled from the client and matter you link." error={fieldError(state, "templateId")}>
        <Select value={templateId} onChange={(e) => {
          setTemplateId(e.target.value);
          const t = options.templates.find((x) => x.id === e.target.value);
          if (t) { setKind(t.kind); if (!title) setTitle(t.name); }
        }}>
          <option value="">Blank document</option>
          {options.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isStarter ? " (starter)" : ""}</option>)}
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-[1fr_14rem]">
        <Field label="Title" name="title" idPrefix="nd" error={fieldError(state, "title")}><Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></Field>
        <Field label="Type" name="kind" idPrefix="nd" error={fieldError(state, "kind")}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Client" name="clientId" idPrefix="nd" hint="Optional for precedents and practice documents." error={fieldError(state, "clientId")}>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">No client</option>
            {options.clients.map((c) => <option key={c.id} value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(" ")} ({c.ref})</option>)}
          </Select>
        </Field>
        <Field label="Matter" name="matterId" idPrefix="nd" hint="Linking a matter also links its client." error={fieldError(state, "matterId")}>
          <Select key={clientId} defaultValue={fromMatter?.id ?? ""}>
            <option value="">No matter</option>
            {own.map((m) => <option key={m.id} value={m.id}>{m.ref}: {m.title}</option>)}
          </Select>
        </Field>
      </div>
      <div><SubmitButton variant="primary" pendingText="Creating…">Create document</SubmitButton></div>
    </form>
  );
}

/* ───────── Workspace: title + editor with autosave ───────── */

type SaveState = { kind: "idle" | "dirty" | "saving" | "saved" | "error"; at?: string; message?: string };

export function DocumentWorkspace({ slug, id, title: initialTitle, content, updatedAt, editable, fields, gaps }: { slug: string; id: string; title: string; content: DocJson; updatedAt: string; editable: boolean; fields: [string, string][]; gaps: number }) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const latest = useRef<{ title: string; content: DocJson | null }>({ title: initialTitle, content: null });
  const base = useRef(updatedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const lastGaps = useRef(gaps);

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 1200);
  }, []);
  useEffect(() => {
    flushRef.current = async () => {
      if (inflight.current) return;
      const snapshot = latest.current;
      if (!snapshot.content && snapshot.title === initialTitle) return;
      inflight.current = true;
      setSave({ kind: "saving" });
      const r = await autosaveAction(slug, id, { title: snapshot.title, content: snapshot.content ?? content, baseUpdatedAt: base.current });
      inflight.current = false;
      if (r.ok && r.data) {
        base.current = r.data.savedAt;
        setSave({ kind: "saved", at: new Date(r.data.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
        if (latest.current !== snapshot) schedule();
        // Keep the "still to complete" list and the review buttons in step with the text.
        if (r.data.gaps !== lastGaps.current) {
          lastGaps.current = r.data.gaps;
          router.refresh();
        }
      } else if (!r.ok) setSave({ kind: "error", message: r.error });
    };
  }, [slug, id, content, initialTitle, schedule, router]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.kind === "dirty" || save.kind === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.kind]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = useCallback((doc: DocJson) => {
    latest.current = { title: latest.current.title, content: doc };
    setSave({ kind: "dirty" });
    schedule();
  }, [schedule]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="doc-title" className="sr-only">Title</label>
        <input
          id="doc-title"
          value={title}
          readOnly={!editable}
          maxLength={200}
          onChange={(e) => { setTitle(e.target.value); latest.current = { ...latest.current, title: e.target.value }; setSave({ kind: "dirty" }); if (e.target.value.trim().length >= 3) schedule(); }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 font-display text-2xl text-ink hover:border-hairline focus:border-hairline-strong focus:outline-none read-only:hover:border-transparent"
        />
        {editable ? (
          <span role="status" aria-live="polite" className={cn("text-xs", save.kind === "error" ? "text-danger" : save.kind === "dirty" ? "text-warn" : "text-muted")}>
            {save.kind === "saving" ? "Saving…" : save.kind === "dirty" ? "Unsaved changes" : save.kind === "saved" ? `Saved ${save.at}` : save.kind === "error" ? `Not saved: ${save.message}` : "All changes saved"}
          </span>
        ) : null}
        {save.kind === "error" ? <Button size="sm" onClick={() => router.refresh()}>Reload</Button> : null}
      </div>
      <DocEditor initial={content} editable={editable} onChange={editable ? onChange : undefined} fields={fields} label="Document text" />
    </div>
  );
}

/* ───────── Workflow ───────── */

export function SaveVersionDialog({ slug, id }: { slug: string; id: string }) {
  return (
    <FormDialog trigger="Save version" title="Save a version" description="Keeps the current text as a numbered version you can go back to." action={saveVersionAction.bind(null, slug, id)} submit="Save version">
      {(s) => <Field label="Note (optional)" name="note" idPrefix="sv" error={fieldError(s, "note")}><Input maxLength={300} placeholder="e.g. After call with client" /></Field>}
    </FormDialog>
  );
}

export function SubmitDialog({ slug, id, reviewers, gaps }: { slug: string; id: string; reviewers: { id: string; name: string }[]; gaps: number }) {
  return (
    <FormDialog trigger="Send for review" triggerVariant="primary" title="Send for review" description={gaps ? `It still has ${gaps} gap${gaps === 1 ? "" : "s"}; the reviewer can't approve it until they're completed.` : "The reviewer checks it and approves it or asks for changes."} action={submitAction.bind(null, slug, id)} submit="Send for review">
      {(s) => (
        <>
          <Field label="Reviewer" name="reviewerId" idPrefix="sub" error={fieldError(s, "reviewerId")}>
            <Select defaultValue=""><option value="">Anyone who reviews documents</option>{reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          </Field>
          <Field label="Note for the reviewer" name="note" idPrefix="sub" error={fieldError(s, "note")}><Textarea rows={2} maxLength={1000} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function ReviewActions({ slug, id }: { slug: string; id: string }) {
  return (
    <>
      <FormDialog trigger="Ask for changes" title="Ask for changes" description="It goes back to the author as a draft with your comment." action={requestChangesAction.bind(null, slug, id)} submit="Send back">
        {(s) => <Field label="What needs to change" name="body" idPrefix="rc" error={fieldError(s, "body")}><Textarea rows={4} required maxLength={4000} /></Field>}
      </FormDialog>
      <FormDialog trigger={<><Check className="size-4" /> Approve</>} triggerVariant="primary" title="Approve this version" description="Confirms you have reviewed it professionally. It can then be made final." action={approveAction.bind(null, slug, id)} submit="Approve">
        {(s) => <Field label="Note (optional)" name="note" idPrefix="ap" error={fieldError(s, "note")}><Textarea rows={2} maxLength={4000} /></Field>}
      </FormDialog>
    </>
  );
}

export function SimpleAction({ label, confirm, variant = "secondary", act }: { label: string; confirm?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; act: () => Promise<ActionResult> }) {
  const [pending, run] = useAct();
  const [open, setOpen] = useState(false);
  if (!confirm) return <Button variant={variant} disabled={pending} onClick={() => run(act)}>{label}</Button>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={variant}>{label}</Button></DialogTrigger>
      <DialogContent title={label} description={confirm}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} disabled={pending} onClick={() => run(async () => { const r = await act(); if (r.ok) setOpen(false); return r; })}>{pending ? "Working…" : label}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenButton({ slug, id, approved }: { slug: string; id: string; approved: boolean }) {
  return <SimpleAction label="Edit again" confirm={approved ? "Editing clears the approval; it will need reviewing again." : "Takes it back from review so you can edit it."} act={() => reopenAction(slug, id)} />;
}
export function FinaliseButton({ slug, id }: { slug: string; id: string }) {
  return <SimpleAction label="Make final" variant="primary" confirm="The final PDF is generated now and kept exactly as it is. The document can't be changed afterwards; to revise it you start a new document from it." act={() => finaliseAction(slug, id)} />;
}
export function DuplicateButton({ slug, id, label = "Start a new version from this" }: { slug: string; id: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending} onClick={() => start(async () => { const r = await duplicateAction(slug, id); if (r && !r.ok) toast.error(r.error); })}>
      <Copy className="size-4" /> {pending ? "Copying…" : label}
    </Button>
  );
}

export function DetailsDialog({ slug, id, kind, letterhead, kinds }: { slug: string; id: string; kind: string; letterhead: boolean; kinds: [string, string][] }) {
  return (
    <FormDialog trigger="Details" triggerVariant="ghost" title="Document details" action={detailsAction.bind(null, slug, id)} submit="Save">
      {(s) => (
        <>
          <Field label="Type" name="kind" idPrefix="det" error={fieldError(s, "kind")}><Select defaultValue={kind}>{kinds.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Checkbox name="letterhead" defaultChecked={letterhead} label="Print on the practice letterhead" />
        </>
      )}
    </FormDialog>
  );
}

export function RestoreVersionButton({ slug, id, version }: { slug: string; id: string; version: number }) {
  const [pending, run] = useAct();
  return (
    <button type="button" disabled={pending} onClick={() => run(() => restoreVersionAction(slug, id, version))} className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
      <RotateCcw className="size-3" /> Restore
    </button>
  );
}

/* ───────── Comments ───────── */

export function CommentForm({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState(commentAction.bind(null, slug, id), null);
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      ref.current?.reset();
    }
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} successToast={false} />
      <label htmlFor="doc-comment" className="sr-only">Comment</label>
      <Textarea id="doc-comment" name="body" rows={2} placeholder="Add a comment for the team" required maxLength={4000} />
      <div><SubmitButton size="sm" pendingText="Adding…">Add comment</SubmitButton></div>
    </form>
  );
}

export function ResolveCommentButton({ slug, id, commentId }: { slug: string; id: string; commentId: string }) {
  const [pending, run] = useAct();
  return <button type="button" disabled={pending} onClick={() => run(() => resolveCommentAction(slug, id, commentId))} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">Resolve</button>;
}

/* ───────── AI drafting ───────── */

export function AiDraftDialog({ slug, id, available }: { slug: string; id: string; available: boolean }) {
  const router = useRouter();
  if (!available) {
    return <Button variant="ghost" disabled title="Needs an Anthropic API key in the hosting settings"><Sparkles className="size-4" /> Draft with AI (not set up)</Button>;
  }
  return (
    <FormDialog
      trigger={<><Sparkles className="size-4" /> Draft with AI</>}
      triggerVariant="ghost"
      title="Draft with AI"
      description="Uses only the linked client and matter records that you can see. Missing facts come back marked [[GAP: …]]. Your current text is saved as a version first. A professional must review the draft before use."
      action={async (prev, form) => { const r = await aiDraftAction(slug, id, prev, form); if (r.ok) router.refresh(); return r; }}
      submit="Draft"
      pendingText="Drafting… this can take a minute"
      wide
    >
      {(s) => <Field label="What should the draft cover?" name="instructions" idPrefix="ai" error={fieldError(s, "instructions")}><Textarea rows={5} required minLength={10} maxLength={4000} placeholder="e.g. A consultation report recommending the spousal visa route, with the documents still needed." /></Field>}
    </FormDialog>
  );
}

/* ───────── Files ───────── */

export function FileUpload({ slug, link }: { slug: string; link: { matterId?: string; clientId?: string; documentId?: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    for (const [k, v] of Object.entries(link)) if (v) fd.set(k, v);
    try {
      const res = await fetch(`/f/${slug}/documents/files`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({ ok: false, error: "Upload failed." }))) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "Upload failed.");
      else { toast.success(`${file.name} uploaded.`); router.refresh(); }
    } catch {
      setError("Upload failed. Check your connection.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label className={cn("inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-hairline-strong bg-surface px-3 py-1.5 text-[13px] text-ink hover:bg-sunken", busy && "pointer-events-none opacity-60")}>
        <FileUp className="size-4" aria-hidden /> {busy ? "Uploading and reading…" : "Upload a file"}
        <input ref={input} type="file" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      </label>
      <p className="text-xs text-muted">Up to 4 MB. Scans and photos are read with OCR; the original is kept unchanged.</p>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function OcrTextDialog({ filename, text, engine, confidence }: { filename: string; text: string; engine: string | null; confidence: number | null }) {
  return (
    <Dialog>
      <DialogTrigger asChild><button type="button" className="text-xs text-accent underline-offset-2 hover:underline">Read text</button></DialogTrigger>
      <DialogContent title={`Text read from ${filename}`} description={`Machine-generated by ${engine ?? "OCR"}${confidence !== null ? ` (confidence ${confidence}%)` : ""}. It can contain errors: check it against the original before relying on it.`} wide>
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-sunken p-3 text-[13px] whitespace-pre-wrap text-ink">{text || "No text was found."}</pre>
      </DialogContent>
    </Dialog>
  );
}

export function RerunOcrButton({ slug, fileId }: { slug: string; fileId: string }) {
  const [pending, run] = useAct();
  return <button type="button" disabled={pending} onClick={() => run(() => rerunOcrAction(slug, fileId))} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">{pending ? "Reading…" : "Read again"}</button>;
}

/* ───────── Templates ───────── */

export function TemplateEditor({ slug, id, initial, kinds, fields }: { slug: string; id: string | null; initial: { name: string; kind: string; description: string; letterhead: boolean; content: DocJson }; kinds: [string, string][]; fields: [string, string][] }) {
  const router = useRouter();
  const [meta, setMeta] = useState({ name: initial.name, kind: initial.kind, description: initial.description, letterhead: initial.letterhead });
  const content = useRef<DocJson>(initial.content);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveTemplateAction(slug, id, meta, content.current);
      if (r.ok) {
        toast.success(r.message);
        setErrors({});
        if (!id && r.data) router.push(`/f/${slug}/documents/templates/${r.data.id}`);
        else router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <Field label="Name" name="name" idPrefix="tpl" error={errors.name}><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={120} /></Field>
        <Field label="Type" name="kind" idPrefix="tpl" error={errors.kind}><Select value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value })}>{kinds.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      <Field label="Description" name="description" idPrefix="tpl" error={errors.description}><Input value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} maxLength={300} /></Field>
      <Checkbox checked={meta.letterhead} onChange={(e) => setMeta({ ...meta, letterhead: e.target.checked })} label="Print documents on the practice letterhead" />
      <p className="text-xs text-muted">Insert merge fields from the toolbar; they are filled from the client and matter when a document is created. Mark passages the author must write with [[…]]: a document can&apos;t be made final while any remain.</p>
      {errors.content ? <p role="alert" className="text-xs text-danger">{errors.content}</p> : null}
      <DocEditor initial={initial.content} editable onChange={(d) => { content.current = d; }} fields={fields} label="Template text" />
      <div><Button variant="primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save template"}</Button></div>
    </div>
  );
}

export function TemplateActiveToggle({ slug, id, active }: { slug: string; id: string; active: boolean }) {
  const [pending, run] = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => templateActiveAction(slug, id, !active))}>{active ? "Switch off" : "Switch on"}</Button>;
}

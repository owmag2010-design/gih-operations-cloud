"use client";

import { useActionState, useState } from "react";
import { ActionFeedback, fieldError, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { addDocumentRequestAction, applyChecklistAction, stepDocumentRequestAction } from "../actions";

type Status = "requested" | "received" | "under_review" | "accepted" | "rejected" | "waived";
export type RequestRow = {
  id: string; label: string; guidance: string | null; personName: string | null; required: boolean; tracksExpiry: boolean; clientVisible: boolean;
  status: Status; dueOn: string | null; filename: string | null; fileId: string | null; expiresOn: string | null; note: string | null; reviewer: string | null;
  history: { id: string; toStatus: Status; note: string | null; actor: string | null; createdAt: string }[];
};

const LABEL: Record<Status, string> = { requested: "Requested", received: "Received", under_review: "Under review", accepted: "Accepted", rejected: "Replacement requested", waived: "Waived" };
const TONE: Record<Status, "neutral" | "accent" | "warn" | "ok" | "danger" | "outline"> = { requested: "neutral", received: "accent", under_review: "warn", accepted: "ok", rejected: "danger", waived: "outline" };

export function ApplyChecklistForm({ slug, matterId, options }: { slug: string; matterId: string; options: { id: string; name: string; version: number }[] }) {
  const [state, action] = useActionState(applyChecklistAction.bind(null, slug, matterId), null);
  // Keep the result (and its toast, which lists anything not applied) after the last checklist has been applied.
  if (!options.length) return state ? <div className="px-4 pt-3"><ActionFeedback state={state} /></div> : null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-hairline p-4">
      <Field label="Apply a checklist" name="templateId" idPrefix="ac" error={fieldError(state, "templateId")}>
        <Select className="w-72">{options.map((o) => <option key={o.id} value={o.id}>{o.name} (v{o.version})</option>)}</Select>
      </Field>
      <Field label="Due by" name="dueOn" idPrefix="ac" error={fieldError(state, "dueOn")}><Input type="date" className="w-44" /></Field>
      <SubmitButton>Request documents</SubmitButton>
      <div className="basis-full"><ActionFeedback state={state} /></div>
    </form>
  );
}

export function AdHocRequestForm({ slug, matterId, people }: { slug: string; matterId: string; people: { id: string; name: string }[] }) {
  const [state, action] = useActionState(addDocumentRequestAction.bind(null, slug, matterId), null);
  return (
    <details className="border-t border-hairline">
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-2">Request another document</summary>
      <form action={action} className="grid gap-3 px-4 pb-4 sm:grid-cols-6">
        <div className="sm:col-span-6"><ActionFeedback state={state} /></div>
        <Field label="Document" name="label" idPrefix="ar" error={fieldError(state, "label")} className="sm:col-span-3"><Input required maxLength={160} /></Field>
        <Field label="For" name="personId" idPrefix="ar" className="sm:col-span-2"><Select defaultValue=""><option value="">The matter</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Due by" name="dueOn" idPrefix="ar"><Input type="date" /></Field>
        <div className="flex flex-wrap gap-4 sm:col-span-6">
          <Checkbox name="required" defaultChecked label="Required" />
          <Checkbox name="tracksExpiry" label="Record its expiry date" />
          <Checkbox name="clientVisible" defaultChecked label="Shown to the client" />
        </div>
        <div className="sm:col-span-6"><SubmitButton>Request document</SubmitButton></div>
      </form>
    </details>
  );
}

function StepForm({ slug, matterId, r, kind, children, submit }: { slug: string; matterId: string; r: RequestRow; kind: string; children?: React.ReactNode; submit: string }) {
  const [state, action] = useActionState(stepDocumentRequestAction.bind(null, slug, matterId, r.id), null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="kind" value={kind} />
      {children}
      <SubmitButton size="sm" variant={kind === "accept" ? "primary" : "secondary"}>{submit}</SubmitButton>
      {state && !state.ok ? <p role="alert" className="basis-full text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}

export function RequestItem({ slug, matterId, r, files, canEdit, canApprove }: { slug: string; matterId: string; r: RequestRow; files: { id: string; filename: string }[]; canEdit: boolean; canApprove: boolean }) {
  const [openFor, setOpenFor] = useState<{ status: Status; panel: "receive" | "accept" | "reject" | "waive" } | null>(null);
  // A panel belongs to the status it was opened in; once the request moves on, it closes.
  const open = openFor && openFor.status === r.status ? openFor.panel : null;
  const setOpen = (panel: "receive" | "accept" | "reject" | "waive" | null) => setOpenFor(panel ? { status: r.status, panel } : null);
  const canReceive = canEdit && ["requested", "rejected", "received"].includes(r.status);
  const reviewable = r.status === "received" || r.status === "under_review";
  const overdue = r.dueOn && !["accepted", "waived"].includes(r.status) && r.dueOn < new Date().toISOString().slice(0, 10);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {r.label}{r.personName ? <span className="font-normal text-muted"> · {r.personName}</span> : null}
            {!r.required ? <span className="ml-1.5 text-xs font-normal text-muted">optional</span> : null}
            {!r.clientVisible ? <span className="ml-1.5 text-xs font-normal text-muted">staff only</span> : null}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
            {r.filename ? <span>File: {r.filename}</span> : null}
            {r.dueOn ? <span className={overdue ? "text-danger" : undefined}>Due {r.dueOn}{overdue ? " (overdue)" : ""}</span> : null}
            {r.expiresOn ? <span>Expires {r.expiresOn}</span> : null}
            {r.reviewer && (r.status === "accepted" || r.status === "rejected") ? <span>Reviewed by {r.reviewer}</span> : null}
          </p>
          {r.note ? <p className="mt-1 text-[13px] text-ink-2">{r.note}</p> : null}
        </div>
        <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
      </div>
      {(canEdit || canApprove) && !["accepted", "waived"].includes(r.status) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {canReceive ? <Button size="sm" variant="ghost" onClick={() => setOpen(open === "receive" ? null : "receive")}>{r.status === "received" ? "Replace file" : "Mark received"}</Button> : null}
          {canEdit && r.status === "received" ? <StepForm slug={slug} matterId={matterId} r={r} kind="review" submit="Start review" /> : null}
          {canApprove && reviewable ? <Button size="sm" variant="ghost" onClick={() => setOpen(open === "accept" ? null : "accept")}>Accept</Button> : null}
          {canApprove && reviewable ? <Button size="sm" variant="ghost" onClick={() => setOpen(open === "reject" ? null : "reject")}>Ask for a replacement</Button> : null}
          {canEdit ? <Button size="sm" variant="ghost" onClick={() => setOpen(open === "waive" ? null : "waive")}>Waive</Button> : null}
        </div>
      ) : null}
      {open === "receive" ? (
        <div className="mt-2 rounded-xl bg-sunken p-3">
          {files.length ? (
            <StepForm slug={slug} matterId={matterId} r={r} kind="receive" submit="Mark received">
              <Field label="Uploaded file" name="fileId" idPrefix={`rf-${r.id}`}><Select className="w-72">{files.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}</Select></Field>
            </StepForm>
          ) : <p className="text-[13px] text-muted">Upload the file to this matter first (Documents and files, below).</p>}
        </div>
      ) : null}
      {open === "accept" ? (
        <div className="mt-2 rounded-xl bg-sunken p-3">
          <StepForm slug={slug} matterId={matterId} r={r} kind="accept" submit="Accept document">
            {r.tracksExpiry ? <Field label="Expiry date on the document" name="expiresOn" idPrefix={`ra-${r.id}`}><Input type="date" required /></Field> : null}
            <Field label="Note (optional)" name="note" idPrefix={`ra-${r.id}`}><Input className="w-72" maxLength={1000} /></Field>
          </StepForm>
          <p className="mt-2 text-xs text-muted">Accepting confirms you have checked the document and any details read from it.</p>
        </div>
      ) : null}
      {open === "reject" ? (
        <div className="mt-2 rounded-xl bg-sunken p-3">
          <StepForm slug={slug} matterId={matterId} r={r} kind="reject" submit="Ask for a replacement">
            <Field label="What's wrong" name="note" idPrefix={`rr-${r.id}`}><Input className="w-96" required maxLength={1000} /></Field>
          </StepForm>
        </div>
      ) : null}
      {open === "waive" ? (
        <div className="mt-2 rounded-xl bg-sunken p-3">
          <StepForm slug={slug} matterId={matterId} r={r} kind="waive" submit="Waive">
            <Field label="Why it isn't needed" name="note" idPrefix={`rw-${r.id}`}><Input className="w-96" required maxLength={1000} /></Field>
          </StepForm>
        </div>
      ) : null}
      {r.history.length > 1 ? (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer text-muted">History ({r.history.length})</summary>
          <ol className="mt-1 grid gap-0.5 text-muted">
            {r.history.map((h) => <li key={h.id}>{LABEL[h.toStatus]} · {h.actor ?? "System"} · <LocalTime value={h.createdAt} />{h.note ? ` · ${h.note}` : ""}</li>)}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

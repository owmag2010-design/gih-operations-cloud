"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import {
  addChecklistItemAction, createChecklistAction, newChecklistVersionAction, publishChecklistAction, removeChecklistItemAction, retireChecklistAction, updateChecklistAction,
} from "../../matters/actions";

const APPLIES = [["main_applicant", "Main applicant"], ["each_applicant", "Each applicant"], ["partner", "Partner"], ["dependants", "Each dependant"], ["sponsor", "Sponsor"], ["matter", "Once for the matter"]] as const;

function useRun() {
  const [pending, start] = useTransition();
  return {
    pending,
    run: (p: () => Promise<ActionResult>) => start(async () => {
      const r = await p();
      if (r.ok) toast.success(r.message ?? "Done.");
      else toast.error(r.error);
    }),
  };
}

export function NewChecklistForm({ slug, countries, services }: { slug: string; countries: { code: string; name: string; status: string }[]; services: { id: string; name: string; jurisdiction: string }[] }) {
  const [state, action] = useActionState(createChecklistAction.bind(null, slug), null);
  const [country, setCountry] = useState(countries[0]?.code ?? "");
  const svc = services.filter((s) => s.jurisdiction === country);
  return (
    <form action={action} className="grid gap-3 border-t border-hairline p-4 sm:grid-cols-6">
      <div className="sm:col-span-6"><ActionFeedback state={state} /></div>
      <Field label="Checklist name" name="name" idPrefix="cl" error={fieldError(state, "name")} className="sm:col-span-2"><Input required maxLength={120} placeholder="e.g. Partner visa: documents" /></Field>
      <Field label="Destination country" name="countryCode" idPrefix="cl" error={fieldError(state, "countryCode")} className="sm:col-span-2">
        <Select value={country} onChange={(e) => setCountry(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}{c.status === "verified" || c.status === "operational" ? "" : ` (${c.status.replace("_", " ")})`}</option>)}</Select>
      </Field>
      <Field label="Service" name="serviceId" idPrefix="cl" hint="Leave as 'Any' to offer it on every matter for this country." error={fieldError(state, "serviceId")} className="sm:col-span-2">
        <Select defaultValue="" key={country}><option value="">Any service</option>{svc.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <div className="flex items-end sm:col-span-6"><SubmitButton>Start checklist</SubmitButton></div>
    </form>
  );
}

export function ChecklistDetailsForm({ slug, t, services, sources }: { slug: string; t: { id: string; name: string; serviceId: string | null; sourceId: string | null; sourceNote: string | null; changeNote: string | null }; services: { id: string; name: string }[]; sources: { id: string; title: string; status: string }[] }) {
  const [state, action] = useActionState(updateChecklistAction.bind(null, slug, t.id), null);
  return (
    <form action={action} className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
      <Field label="Name" name="name" idPrefix="cd" error={fieldError(state, "name")}><Input defaultValue={t.name} required maxLength={120} /></Field>
      <Field label="Service" name="serviceId" idPrefix="cd" error={fieldError(state, "serviceId")}>
        <Select defaultValue={t.serviceId ?? ""}><option value="">Any service</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <Field label="Authoritative source" name="sourceId" idPrefix="cd" hint="From the country's source register (Hub › Countries)." error={fieldError(state, "sourceId")}>
        <Select defaultValue={t.sourceId ?? ""}><option value="">None chosen</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.title}{s.status === "verified" ? "" : ` (${s.status})`}</option>)}</Select>
      </Field>
      <Field label="Or describe the source" name="sourceNote" idPrefix="cd" error={fieldError(state, "sourceNote")}><Input defaultValue={t.sourceNote ?? ""} maxLength={500} placeholder="e.g. Department checklist, checked 21 Nov 2026" /></Field>
      <Field label="What changed in this version" name="changeNote" idPrefix="cd" className="sm:col-span-2" error={fieldError(state, "changeNote")}><Input defaultValue={t.changeNote ?? ""} maxLength={500} /></Field>
      <div><SubmitButton variant="secondary">Save details</SubmitButton></div>
    </form>
  );
}

export function AddItemForm({ slug, templateId }: { slug: string; templateId: string }) {
  const [state, action] = useActionState(addChecklistItemAction.bind(null, slug, templateId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 border-t border-hairline p-4 sm:grid-cols-6">
      <div className="sm:col-span-6"><ActionFeedback state={state} successToast={false} /></div>
      <Field label="Document" name="label" idPrefix="ci" error={fieldError(state, "label")} className="sm:col-span-3"><Input required maxLength={160} placeholder="e.g. Certified passport copy" /></Field>
      <Field label="Who it's for" name="appliesTo" idPrefix="ci" className="sm:col-span-3"><Select defaultValue="main_applicant">{APPLIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Guidance for the client" name="guidance" idPrefix="ci" className="sm:col-span-6" error={fieldError(state, "guidance")}><Textarea rows={2} maxLength={1000} placeholder="What counts, how to certify it, what to avoid" /></Field>
      <div className="flex flex-wrap gap-4 sm:col-span-6">
        <Checkbox name="required" defaultChecked label="Required" />
        <Checkbox name="tracksExpiry" label="Has an expiry date to record" />
        <Checkbox name="clientVisible" defaultChecked label="Shown to the client" />
      </div>
      <div className="sm:col-span-6"><SubmitButton>Add document</SubmitButton></div>
    </form>
  );
}

export function RemoveItemButton({ slug, templateId, itemId, label }: { slug: string; templateId: string; itemId: string; label: string }) {
  const { pending, run } = useRun();
  return <Button size="icon" variant="ghost" aria-label={`Remove ${label}`} disabled={pending} onClick={() => run(() => removeChecklistItemAction(slug, templateId, itemId))}><Trash2 /></Button>;
}

export function VersionActions({ slug, id, status, canPublish }: { slug: string; id: string; status: string; canPublish: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" ? (
        <Button variant="primary" disabled={pending || !canPublish} onClick={() => { if (window.confirm("Publish this version? It can't be edited afterwards; new matters will get it, existing matters keep their version.")) run(() => publishChecklistAction(slug, id)); }}>Publish version</Button>
      ) : (
        <Button disabled={pending} onClick={() => run(() => newChecklistVersionAction(slug, id))}>Start a new version</Button>
      )}
      {status === "published" ? <Button variant="ghost" disabled={pending} onClick={() => run(() => retireChecklistAction(slug, id))}>Retire</Button> : null}
    </div>
  );
}

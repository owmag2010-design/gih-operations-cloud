"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import { addLeadNoteAction, changeStageAction, convertLeadAction, markDuplicateAction, recordConsentAction } from "../../actions";

export function StageSelect({ firmSlug, leadId, current, stages }: { firmSlug: string; leadId: string; current: string; stages: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <label>
      <span className="sr-only">Stage</span>
      <Select
        defaultValue={current}
        disabled={pending}
        className="h-9 w-auto"
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            const r = await changeStageAction(firmSlug, [leadId], v);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          });
        }}
      >
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </label>
  );
}

export function ConvertButton({ firmSlug, leadId, name }: { firmSlug: string; leadId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="primary">Convert to client</Button></DialogTrigger>
      <DialogContent title={`Convert ${name} to a client?`} description="Creates a client record linked to this lead and moves the lead to Converted. Their consent records come across too.">
        <p className="mb-4 text-[13px] text-muted">Cases, proposals and the client portal arrive in later releases; for now the client record holds contact details, the consultant and notes.</p>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await convertLeadAction(firmSlug, leadId);
              if (r && !r.ok) toast.error(r.error);
            })
          }
        >
          {pending ? "Converting…" : "Convert to client"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function NoteForm({ firmSlug, leadId }: { firmSlug: string; leadId: string }) {
  const [state, action] = useActionState(addLeadNoteAction.bind(null, firmSlug, leadId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} />
      <label htmlFor="note-body" className="sr-only">Add an internal note</label>
      <Textarea id="note-body" name="body" rows={3} placeholder="Add an internal note: call outcome, documents mentioned, next step…" required maxLength={5000} />
      <div><SubmitButton size="sm" pendingText="Adding…">Add note</SubmitButton></div>
    </form>
  );
}

export function ConsentDialog({ firmSlug, leadId }: { firmSlug: string; leadId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await recordConsentAction(firmSlug, leadId, prev, form);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Record</Button></DialogTrigger>
      <DialogContent title="Record consent" description="Keep a record of what the person agreed to, and how.">
        <form action={action} className="flex flex-col gap-3">
          <ActionFeedback state={state} />
          <Field label="What for" name="purpose">
            <Select defaultValue="contact">
              <option value="contact">Contact about their enquiry</option>
              <option value="data_processing">Processing their personal information</option>
              <option value="marketing">Marketing</option>
            </Select>
          </Field>
          <Field label="Answer" name="granted">
            <Select defaultValue="yes"><option value="yes">Given</option><option value="no">Refused or withdrawn</option></Select>
          </Field>
          <Field label="How it was given" name="method" hint="For example: by email on 21 October, on a phone call, on the website form."><Input required maxLength={120} /></Field>
          <Field label="Reference (optional)" name="evidence" hint="Where the evidence is kept, such as an email subject."><Input maxLength={500} /></Field>
          <div><SubmitButton>Record consent</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateList({ firmSlug, leadId, items, canEdit }: { firmSlug: string; leadId: string; items: { id: string; ref: string; name: string; createdAt: string }[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <ul className="divide-y divide-hairline">
      {items.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
          <span className="min-w-0">
            <Link href={`/f/${firmSlug}/leads/${d.id}`} className="block truncate text-ink hover:underline">{d.name}</Link>
            <span className="num text-xs text-muted">{d.ref}, received <LocalTime value={d.createdAt} mode="date" /></span>
          </span>
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => start(async () => {
                const r = await markDuplicateAction(firmSlug, leadId, d.id);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })}
            >
              This is a duplicate of it
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

"use client";

import { Check, Plus, ShieldCheck, Trash2, UserMinus } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CountrySelect } from "@/components/country-select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, cn, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import {
  addCalculatedDeadlineAction, addFactAction, addMemberAction, addRecordedDateAction, adjustDateAction, changeMatterStageAction, completeDateAction,
  removeFactAction, removeMemberAction, removePersonAction, savePersonAction, updateMatterAction, verifyFactAction,
} from "../actions";

/** Close a dialog once per successful submission (not again when it is reopened). */
function useCloseOnOk(state: ActionResult | null, close: () => void) {
  const handled = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      close();
    }
  });
}

function useAct() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message); else toast.error(r.error);
    });
  return [pending, run] as const;
}

/* ───────── Stage ───────── */

export function StageBar({ slug, matterId, stages, currentId, canEdit }: { slug: string; matterId: string; stages: { id: string; name: string; category: string }[]; currentId: string; canEdit: boolean }) {
  const [pending, run] = useAct();
  const idx = stages.findIndex((s) => s.id === currentId);
  return (
    <nav aria-label="Matter stage" className="overflow-x-auto">
      <ol className="flex min-w-max items-stretch gap-1">
        {stages.map((s, i) => {
          const state = i < idx ? "done" : i === idx ? "current" : "next";
          const inner = (
            <>
              <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", state === "done" ? "bg-ok text-white" : state === "current" ? "bg-accent text-accent-ink" : "border border-hairline-strong text-muted")}>
                {state === "done" ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-[13px] whitespace-nowrap", state === "current" ? "font-semibold text-ink" : state === "done" ? "text-ink-2" : "text-muted")}>{s.name}</span>
            </>
          );
          return (
            <li key={s.id}>
              {canEdit && state !== "current" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => changeMatterStageAction(slug, matterId, s.id))}
                  className="flex h-10 items-center gap-2 rounded-full px-3 hover:bg-sunken"
                  title={`Move to ${s.name}`}
                >
                  {inner}
                </button>
              ) : (
                <span aria-current={state === "current" ? "step" : undefined} className={cn("flex h-10 items-center gap-2 rounded-full px-3", state === "current" && "bg-accent-soft")}>{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ───────── Edit matter ───────── */

type MatterLike = {
  id: string; title: string; legalCategory: string | null; jurisdiction: string | null; caseManagerId: string | null; consultantId: string | null; restricted: boolean;
  risk: "low" | "medium" | "high"; riskNote: string | null; submissionReference: string | null; submissionChannel: string | null; submittedOn: string | null; outcome: string | null;
};

export function EditMatterDialog({ slug, matter, team, canRestrict }: { slug: string; matter: MatterLike; team: { id: string; name: string }[]; canRestrict: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateMatterAction.bind(null, slug, matter.id), null);
  useCloseOnOk(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Edit</Button></DialogTrigger>
      <DialogContent title="Edit matter" wide>
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <Field label="Title" name="title" idPrefix="em" error={fieldError(state, "title")}><Input defaultValue={matter.title} required maxLength={160} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal category" name="legalCategory" idPrefix="em"><Input defaultValue={matter.legalCategory ?? ""} maxLength={120} /></Field>
            <Field label="Jurisdiction" name="jurisdiction" idPrefix="em" error={fieldError(state, "jurisdiction")}><CountrySelect defaultValue={matter.jurisdiction ?? ""} /></Field>
            <Field label="Case manager" name="caseManagerId" idPrefix="em" error={fieldError(state, "caseManagerId")}>
              <Select defaultValue={matter.caseManagerId ?? ""}><option value="">None</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            </Field>
            <Field label="Consultant" name="consultantId" idPrefix="em" error={fieldError(state, "consultantId")}>
              <Select defaultValue={matter.consultantId ?? ""}><option value="">None</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Risk" name="risk" idPrefix="em"><Select defaultValue={matter.risk}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></Field>
            <Field label="Risk note" name="riskNote" idPrefix="em"><Input defaultValue={matter.riskNote ?? ""} maxLength={2000} placeholder="What could go wrong, and why" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Submission reference" name="submissionReference" idPrefix="em"><Input defaultValue={matter.submissionReference ?? ""} maxLength={120} /></Field>
            <Field label="Submitted on" name="submittedOn" idPrefix="em" error={fieldError(state, "submittedOn")}><Input type="date" defaultValue={matter.submittedOn ?? ""} /></Field>
            <Field label="Submitted via" name="submissionChannel" idPrefix="em"><Input defaultValue={matter.submissionChannel ?? ""} maxLength={120} placeholder="e.g. VFS Pretoria, ImmiAccount" /></Field>
          </div>
          <Field label="Outcome" name="outcome" idPrefix="em"><Textarea rows={2} defaultValue={matter.outcome ?? ""} maxLength={2000} /></Field>
          {canRestrict ? (
            <Checkbox name="restricted" defaultChecked={matter.restricted} label="Restricted: only the team and practice administrators can see this matter." />
          ) : (
            <input type="hidden" name="restricted" value={matter.restricted ? "on" : ""} />
          )}
          <div className="flex justify-end"><SubmitButton>Save matter</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Team ───────── */

export function TeamControls({ slug, matterId, members, candidates }: { slug: string; matterId: string; members: { userId: string; name: string }[]; candidates: { id: string; name: string }[] }) {
  const [pending, run] = useAct();
  const [pick, setPick] = useState("");
  const available = candidates.filter((c) => !members.some((m) => m.userId === c.id));
  return (
    <div className="flex flex-col gap-2">
      {members.map((m) => (
        <div key={m.userId} className="flex items-center justify-between text-[13px]">
          <span className="text-ink">{m.name}</span>
          <Button size="icon" variant="ghost" aria-label={`Remove ${m.name} from the team`} disabled={pending} onClick={() => run(() => removeMemberAction(slug, matterId, m.userId))}><UserMinus /></Button>
        </div>
      ))}
      {available.length ? (
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="add-member">Add to the team</label>
          <Select id="add-member" value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 text-[13px]">
            <option value="">Add someone…</option>
            {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button size="sm" disabled={!pick || pending} onClick={() => run(async () => { const r = await addMemberAction(slug, matterId, pick); if (r.ok) setPick(""); return r; })}>Add</Button>
        </div>
      ) : null}
    </div>
  );
}

/* ───────── People ───────── */

type Person = { id: string; role: string; firstName: string; lastName: string | null; dateOfBirth: string | null; nationality: string | null; immigrationStatus: string | null; statusExpiresOn: string | null; passportExpiresOn: string | null };

export function PersonDialog({ slug, matterId, person, roles }: { slug: string; matterId: string; person?: Person; roles: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(savePersonAction.bind(null, slug, matterId, person?.id ?? null), null);
  useCloseOnOk(state, () => setOpen(false));
  const p = `pp-${person?.id ?? "new"}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{person ? <Button size="sm" variant="ghost">Edit</Button> : <Button size="sm"><Plus /> Add person</Button>}</DialogTrigger>
      <DialogContent title={person ? "Edit person" : "Add an applicant or dependant"} wide>
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Role" name="role" idPrefix={p}><Select defaultValue={person?.role ?? "spouse_partner"}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="First name" name="firstName" idPrefix={p} error={fieldError(state, "firstName")}><Input defaultValue={person?.firstName} required maxLength={80} /></Field>
            <Field label="Last name" name="lastName" idPrefix={p}><Input defaultValue={person?.lastName ?? ""} maxLength={80} /></Field>
            <Field label="Date of birth" name="dateOfBirth" idPrefix={p} error={fieldError(state, "dateOfBirth")}><Input type="date" defaultValue={person?.dateOfBirth ?? ""} /></Field>
            <Field label="Nationality" name="nationality" idPrefix={p} error={fieldError(state, "nationality")}><CountrySelect defaultValue={person?.nationality ?? ""} /></Field>
            <Field label="Passport expires" name="passportExpiresOn" idPrefix={p} error={fieldError(state, "passportExpiresOn")}><Input type="date" defaultValue={person?.passportExpiresOn ?? ""} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Current immigration status" name="immigrationStatus" idPrefix={p} hint="As recorded; add a fact below to say how it was verified."><Input defaultValue={person?.immigrationStatus ?? ""} maxLength={120} placeholder="e.g. Visitor's visa (s11)" /></Field>
            <Field label="Status expires" name="statusExpiresOn" idPrefix={p} error={fieldError(state, "statusExpiresOn")}><Input type="date" defaultValue={person?.statusExpiresOn ?? ""} /></Field>
          </div>
          <div className="flex justify-end"><SubmitButton>{person ? "Save" : "Add person"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemovePersonButton({ slug, matterId, personId, name }: { slug: string; matterId: string; personId: string; name: string }) {
  const [pending, run] = useAct();
  return <Button size="icon" variant="ghost" aria-label={`Remove ${name}`} disabled={pending} onClick={() => { if (window.confirm(`Remove ${name} from this matter?`)) run(() => removePersonAction(slug, matterId, personId)); }}><Trash2 /></Button>;
}

/* ───────── Facts ───────── */

export function FactDialog({ slug, matterId, people, basisLabels }: { slug: string; matterId: string; people: { id: string; name: string }[]; basisLabels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(addFactAction.bind(null, slug, matterId), null);
  const [basis, setBasis] = useState("client_statement");
  useCloseOnOk(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus /> Record a fact</Button></DialogTrigger>
      <DialogContent title="Record a fact" description="Say where it comes from: a verified document, what the client told you, or your own assessment." wide>
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="About" name="label" idPrefix="fact" error={fieldError(state, "label")}><Input required maxLength={120} placeholder="e.g. Date of marriage" /></Field>
            <Field label="Person" name="personId" idPrefix="fact"><Select defaultValue=""><option value="">The matter generally</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          </div>
          <Field label="Fact" name="value" idPrefix="fact" error={fieldError(state, "value")}><Textarea rows={2} required maxLength={2000} /></Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Basis</legend>
            {Object.entries(basisLabels).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="basis" value={k} checked={basis === k} onChange={() => setBasis(k)} className="accent-[var(--accent)]" /> {v}
              </label>
            ))}
          </fieldset>
          {basis === "verified" ? (
            <Field label="Verified against" name="evidence" idPrefix="fact" error={fieldError(state, "evidence")}><Input required maxLength={500} placeholder="e.g. Certified marriage certificate, received 24 Oct" /></Field>
          ) : (
            <Field label="Source (optional)" name="evidence" idPrefix="fact"><Input maxLength={500} placeholder="e.g. Consultation call, 21 Oct" /></Field>
          )}
          <div className="flex justify-end"><SubmitButton>Record fact</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VerifyFactDialog({ slug, matterId, factId, label }: { slug: string; matterId: string; factId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(verifyFactAction.bind(null, slug, matterId, factId), null);
  useCloseOnOk(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost"><ShieldCheck /> Verify</Button></DialogTrigger>
      <DialogContent title={`Verify “${label}”`} description="Name the document or official source you checked. Your name and the time are recorded.">
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <Field label="Verified against" name="evidence" idPrefix={`vf-${factId}`} error={fieldError(state, "evidence")}><Input required maxLength={500} /></Field>
          <div className="flex justify-end"><SubmitButton>Mark verified</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveFactButton({ slug, matterId, factId, label }: { slug: string; matterId: string; factId: string; label: string }) {
  const [pending, run] = useAct();
  return <Button size="icon" variant="ghost" aria-label={`Remove ${label}`} disabled={pending} onClick={() => { if (window.confirm("Remove this fact? The activity history keeps a record of it.")) run(() => removeFactAction(slug, matterId, factId)); }}><Trash2 /></Button>;
}

/* ───────── Dates ───────── */

type Rule = { id: string; name: string; offsetDays: number; businessDays: boolean; fromLabel: string; source: string; validated: boolean };

export function DateDialogs({ slug, matterId, people, rules, canManageRules, settingsHref }: { slug: string; matterId: string; people: { id: string; name: string }[]; rules: Rule[]; canManageRules: boolean; settingsHref: string }) {
  const [open, setOpen] = useState<"" | "recorded" | "calculated">("");
  const [recState, recAction] = useActionState(addRecordedDateAction.bind(null, slug, matterId), null);
  const [calcState, calcAction] = useActionState(addCalculatedDeadlineAction.bind(null, slug, matterId), null);
  useCloseOnOk(recState, () => setOpen(""));
  useCloseOnOk(calcState, () => setOpen(""));
  const validated = rules.filter((r) => r.validated);
  return (
    <div className="flex gap-2">
      <Dialog open={open === "recorded"} onOpenChange={(v) => setOpen(v ? "recorded" : "")}>
        <DialogTrigger asChild><Button size="sm"><Plus /> Add a date</Button></DialogTrigger>
        <DialogContent title="Add a date" description="A date taken from a document or record: an expiry, a submission date, or a deadline set in a letter." wide>
          <form action={recAction} className="flex flex-col gap-4">
            <ActionFeedback state={recState} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type" name="kind" idPrefix="rd"><Select defaultValue="expiry"><option value="expiry">Expiry</option><option value="deadline">Deadline</option><option value="submission">Submission</option><option value="other">Other</option></Select></Field>
              <Field label="Label" name="label" idPrefix="rd" error={fieldError(recState, "label")}><Input required maxLength={120} placeholder="e.g. Passport expires" /></Field>
              <Field label="Date" name="dueOn" idPrefix="rd" error={fieldError(recState, "dueOn")}><Input type="date" required /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Taken from" name="basis" idPrefix="rd" error={fieldError(recState, "basis")}><Input required maxLength={500} placeholder="e.g. Passport data page" /></Field>
              <Field label="Person" name="personId" idPrefix="rd"><Select defaultValue=""><option value="">The matter generally</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            </div>
            <div className="flex justify-end"><SubmitButton>Add date</SubmitButton></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={open === "calculated"} onOpenChange={(v) => setOpen(v ? "calculated" : "")}>
        <DialogTrigger asChild><Button size="sm">Calculate a deadline</Button></DialogTrigger>
        <DialogContent title="Calculate a deadline" description="Only rules your practice has checked and validated can be used. The rule, its source and the starting date are shown with the result." wide>
          {validated.length ? (
            <form action={calcAction} className="flex flex-col gap-4">
              <ActionFeedback state={calcState} />
              <Field label="Rule" name="ruleId" idPrefix="cd" error={fieldError(calcState, "ruleId")}>
                <Select defaultValue={validated[0].id}>{validated.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.offsetDays} {r.businessDays ? "business" : "calendar"} days from {r.fromLabel})</option>)}</Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Counting from" name="fromDate" idPrefix="cd" error={fieldError(calcState, "fromDate")}><Input type="date" required /></Field>
                <Field label="Label (optional)" name="label" idPrefix="cd"><Input maxLength={120} placeholder="Defaults to the rule name" /></Field>
                <Field label="Person" name="personId" idPrefix="cd"><Select defaultValue=""><option value="">The matter generally</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              </div>
              <p className="text-xs text-muted">Business days skip weekends only; public holidays are not excluded. Check the result and adjust it if needed; adjustments record the reason and reviewer.</p>
              <div className="flex justify-end"><SubmitButton>Calculate</SubmitButton></div>
            </form>
          ) : (
            <p className="text-sm text-ink-2">
              No validated deadline rules yet. {canManageRules ? <>Add one and validate it in <a href={settingsHref} className="font-medium text-ink underline">Settings › Matters</a>.</> : "Ask a practice administrator to add and validate the rules your practice relies on."} Until then, add deadlines as dates taken from the relevant letter or record.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AdjustDateDialog({ slug, matterId, dateId, current, label }: { slug: string; matterId: string; dateId: string; current: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(adjustDateAction.bind(null, slug, matterId, dateId), null);
  useCloseOnOk(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Adjust</Button></DialogTrigger>
      <DialogContent title={`Adjust “${label}”`} description="The new date, your reason and your name are recorded; the original basis stays in the activity history.">
        <form action={action} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          <Field label="New date" name="dueOn" idPrefix={`ad-${dateId}`} error={fieldError(state, "dueOn")}><Input type="date" defaultValue={current} required /></Field>
          <Field label="Reason" name="reason" idPrefix={`ad-${dateId}`} error={fieldError(state, "reason")}><Textarea rows={2} required maxLength={500} placeholder="e.g. Public holiday on 16 December; DHA letter received late" /></Field>
          <div className="flex justify-end"><SubmitButton>Save new date</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteDateButton({ slug, matterId, dateId, done }: { slug: string; matterId: string; dateId: string; done: boolean }) {
  const [pending, run] = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => completeDateAction(slug, matterId, dateId, !done))}>{done ? "Reopen" : "Mark done"}</Button>;
}

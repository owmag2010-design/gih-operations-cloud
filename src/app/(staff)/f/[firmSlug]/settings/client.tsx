"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useActionState, useTransition } from "react";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { addDepartmentAction, addStageAction, moveStageAction, saveRemindersAction, updatePoliciesAction, updateProfileAction, updateStageAction } from "../actions";

type Profile = { legalName: string; tradingName: string; brandColor: string; website: string | null; emailDomain: string | null; contactEmail: string | null; contactPhone: string | null; jurisdictions: string[] };

export function ProfileForm({ firmSlug, firm }: { firmSlug: string; firm: Profile }) {
  const [state, action] = useActionState(updateProfileAction.bind(null, firmSlug), null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
      <Field label="Legal name" name="legalName" error={err("legalName")}><Input defaultValue={firm.legalName} required /></Field>
      <Field label="Trading name" name="tradingName" error={err("tradingName")}><Input defaultValue={firm.tradingName} required /></Field>
      <Field label="Brand colour" name="brandColor" hint="Shown down the sidebar in this workspace." error={err("brandColor")}><Input defaultValue={firm.brandColor} pattern="#[0-9a-fA-F]{6}" required /></Field>
      <Field label="Website" name="website" error={err("website")}><Input type="url" defaultValue={firm.website ?? ""} placeholder="https://" /></Field>
      <Field label="Contact email" name="contactEmail" error={err("contactEmail")}><Input type="email" defaultValue={firm.contactEmail ?? ""} /></Field>
      <Field label="Contact phone" name="contactPhone" error={err("contactPhone")}><Input defaultValue={firm.contactPhone ?? ""} /></Field>
      <Field label="Email domain" name="emailDomain" error={err("emailDomain")}><Input defaultValue={firm.emailDomain ?? ""} placeholder="example.com" /></Field>
      <Field label="Jurisdictions" name="jurisdictions" hint="Two-letter country codes, separated by commas: ZA, ZW." error={err("jurisdictions")}><Input defaultValue={firm.jurisdictions.join(", ")} /></Field>
      <div className="sm:col-span-2"><SubmitButton>Save profile</SubmitButton></div>
    </form>
  );
}

export function PoliciesForm({ firmSlug, policies }: { firmSlug: string; policies: { shareAggregateMetrics: boolean; allowGroupAdminAccess: boolean; requireMfaForAll: boolean } }) {
  const [state, action] = useActionState(updatePoliciesAction.bind(null, firmSlug), null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionFeedback state={state} />
      <Checkbox name="shareAggregateMetrics" defaultChecked={policies.shareAggregateMetrics} label={<><span className="text-ink">Share counts with the Hub Command Centre.</span> Only totals (new leads, open leads, clients). No names or enquiry text.</>} />
      <Checkbox name="allowGroupAdminAccess" defaultChecked={policies.allowGroupAdminAccess} label={<><span className="text-ink">Let Hub super administrators add themselves to this firm.</span> Each time it happens it is recorded in the audit log.</>} />
      <Checkbox name="requireMfaForAll" defaultChecked={policies.requireMfaForAll} label={<><span className="text-ink">Require two-step sign-in for everyone in this firm.</span> Administrators always need it.</>} />
      <div><SubmitButton>Save policies</SubmitButton></div>
    </form>
  );
}

type Reminders = { clientNudges: boolean; nudgeEveryDays: number; staffDigest: boolean; deadlineWindowDays: number; expiryWindowDays: number };

export function RemindersForm({ firmSlug, settings }: { firmSlug: string; settings: Reminders }) {
  const [state, action] = useActionState(saveRemindersAction.bind(null, firmSlug), null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ActionFeedback state={state} />
      <div className="flex flex-col gap-2">
        <Checkbox name="clientNudges" defaultChecked={settings.clientNudges} label={<><span className="text-ink">Remind clients about documents they still owe.</span> Only clients with an open portal, only for required documents they can see, and only when one is due within three days, a new copy was asked for, or the request has waited the interval below.</>} />
        <Field label="Remind a client at most every" name="nudgeEveryDays" hint="Days, 3 to 30." error={err("nudgeEveryDays")}><Input type="number" min={3} max={30} defaultValue={settings.nudgeEveryDays} className="w-28" required /></Field>
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox name="staffDigest" defaultChecked={settings.staffDigest} label={<><span className="text-ink">Email each team member a daily digest.</span> Deadlines coming up, overdue client documents, documents waiting for their review, and accepted documents about to expire, on open matters they&apos;re on. Nobody gets an empty email.</>} />
        <div className="flex flex-wrap gap-4">
          <Field label="Deadlines within" name="deadlineWindowDays" hint="Days, 1 to 60." error={err("deadlineWindowDays")}><Input type="number" min={1} max={60} defaultValue={settings.deadlineWindowDays} className="w-28" required /></Field>
          <Field label="Documents expiring within" name="expiryWindowDays" hint="Days, 14 to 365." error={err("expiryWindowDays")}><Input type="number" min={14} max={365} defaultValue={settings.expiryWindowDays} className="w-28" required /></Field>
        </div>
      </div>
      <div><SubmitButton>Save reminders</SubmitButton></div>
    </form>
  );
}

type Stage = { id: string; name: string; category: string; isActive: boolean };

export function StageEditor({ firmSlug, stages, canManage }: { firmSlug: string; stages: Stage[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [addState, add] = useActionState(addStageAction.bind(null, firmSlug), null);
  const cat = { open: "Open", won: "Converted", lost: "Lost", closed: "Closed" } as Record<string, string>;
  return (
    <div>
      <ol className="divide-y divide-hairline">
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="num w-6 text-xs text-muted">{i + 1}</span>
            {canManage ? <StageRow firmSlug={firmSlug} stage={s} /> : <span className={`flex-1 text-[13px] ${s.isActive ? "text-ink" : "text-muted line-through"}`}>{s.name}</span>}
            <Badge tone="outline">{cat[s.category]}</Badge>
            {canManage ? (
              <span className="flex">
                <Button size="icon" variant="ghost" aria-label={`Move ${s.name} up`} disabled={pending || i === 0} onClick={() => start(async () => { await moveStageAction(firmSlug, s.id, "up"); })}><ArrowUp /></Button>
                <Button size="icon" variant="ghost" aria-label={`Move ${s.name} down`} disabled={pending || i === stages.length - 1} onClick={() => start(async () => { await moveStageAction(firmSlug, s.id, "down"); })}><ArrowDown /></Button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {canManage ? (
        <form action={add} className="flex flex-wrap items-end gap-2 border-t border-hairline p-4">
          <Field label="New stage" name="name" error={fieldError(addState, "name")}><Input required maxLength={60} className="w-56" /></Field>
          <Field label="Kind" name="category"><Select defaultValue="open" className="w-36"><option value="open">Open</option><option value="lost">Lost</option><option value="closed">Closed</option></Select></Field>
          <SubmitButton>Add stage</SubmitButton>
          <div className="basis-full"><ActionFeedback state={addState} /></div>
        </form>
      ) : null}
    </div>
  );
}

function StageRow({ firmSlug, stage }: { firmSlug: string; stage: Stage }) {
  const [state, action] = useActionState(updateStageAction.bind(null, firmSlug, stage.id), null);
  return (
    <form action={action} className="flex flex-1 flex-wrap items-center gap-2">
      <label className="flex-1"><span className="sr-only">Stage name</span><Input name="name" defaultValue={stage.name} className="h-8 max-w-xs text-[13px]" required /></label>
      <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" name="isActive" defaultChecked={stage.isActive} className="accent-[var(--accent)]" /> Active</label>
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
      {state && !state.ok ? <p role="alert" className="basis-full text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}

export function DepartmentForm({ firmSlug }: { firmSlug: string }) {
  const [state, action] = useActionState(addDepartmentAction.bind(null, firmSlug), null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Add a department" name="name" error={fieldError(state, "name")}><Input required maxLength={80} className="w-56" /></Field>
      <SubmitButton>Add</SubmitButton>
      <div className="basis-full"><ActionFeedback state={state} /></div>
    </form>
  );
}

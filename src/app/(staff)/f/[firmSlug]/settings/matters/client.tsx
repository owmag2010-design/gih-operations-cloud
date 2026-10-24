"use client";

import { ArrowDown, ArrowUp, ShieldCheck, ShieldOff } from "lucide-react";
import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import {
  addMatterStageAction, moveMatterStageAction, saveDeadlineRuleAction, saveTaskTemplateAction, setTaskTemplateActiveAction, updateMatterStageAction, validateDeadlineRuleAction,
} from "../../matters/actions";

const CATEGORY: Record<string, string> = { opening: "Opening", active: "In progress", submitted: "Submitted", closed: "Closed" };

function useAct() {
  const [pending, start] = useTransition();
  return [pending, (fn: () => Promise<ActionResult>) => start(async () => { const r = await fn(); if (r.ok) toast.success(r.message); else toast.error(r.error); })] as const;
}

type Stage = { id: string; name: string; category: string; isActive: boolean; serviceId: string | null };

export function MatterStageEditor({ slug, stages, serviceId, canManage }: { slug: string; stages: Stage[]; serviceId: string | null; canManage: boolean }) {
  const [pending, run] = useAct();
  const [addState, add] = useActionState(addMatterStageAction.bind(null, slug), null);
  return (
    <div>
      <ol className="divide-y divide-hairline">
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="num w-6 text-xs text-muted">{i + 1}</span>
            {canManage ? <StageRow slug={slug} stage={s} /> : <span className={`flex-1 text-[13px] ${s.isActive ? "text-ink" : "text-muted line-through"}`}>{s.name}</span>}
            {!canManage ? <Badge tone="outline">{CATEGORY[s.category]}</Badge> : null}
            {canManage ? (
              <span className="flex">
                <Button size="icon" variant="ghost" aria-label={`Move ${s.name} up`} disabled={pending || i === 0} onClick={() => run(() => moveMatterStageAction(slug, s.id, "up"))}><ArrowUp /></Button>
                <Button size="icon" variant="ghost" aria-label={`Move ${s.name} down`} disabled={pending || i === stages.length - 1} onClick={() => run(() => moveMatterStageAction(slug, s.id, "down"))}><ArrowDown /></Button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {canManage ? (
        <form action={add} className="flex flex-wrap items-end gap-2 border-t border-hairline p-4">
          <input type="hidden" name="serviceId" value={serviceId ?? ""} />
          <Field label="New stage" name="name" idPrefix={`ms-${serviceId ?? "d"}`} error={fieldError(addState, "name")}><Input required maxLength={60} className="w-56" /></Field>
          <Field label="Kind" name="category" idPrefix={`ms-${serviceId ?? "d"}`}><Select defaultValue="active" className="w-40">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <SubmitButton>Add stage</SubmitButton>
          <div className="basis-full"><ActionFeedback state={addState} /></div>
        </form>
      ) : null}
    </div>
  );
}

function StageRow({ slug, stage }: { slug: string; stage: Stage }) {
  const [state, action] = useActionState(updateMatterStageAction.bind(null, slug, stage.id), null);
  return (
    <form action={action} className="flex flex-1 flex-wrap items-center gap-2">
      <label className="flex-1"><span className="sr-only">Stage name</span><Input name="name" defaultValue={stage.name} className="h-8 max-w-xs text-[13px]" required /></label>
      <label><span className="sr-only">Kind</span><Select name="category" defaultValue={stage.category} className="h-8 w-36 text-[13px]">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
      <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" name="isActive" defaultChecked={stage.isActive} className="accent-[var(--accent)]" /> Active</label>
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
      {state && !state.ok ? <p role="alert" className="basis-full text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}

type Template = { id: string; title: string; serviceId: string | null; stageId: string | null; priority: string; dueOffsetDays: number | null; assignTo: string; isActive: boolean; serviceName: string | null; stageName: string | null };

export function TaskTemplateForm({ slug, stages, services }: { slug: string; stages: { id: string; name: string; serviceName: string | null }[]; services: { id: string; name: string }[] }) {
  const [state, action] = useActionState(saveTaskTemplateAction.bind(null, slug, null), null);
  return (
    <form action={action} className="grid gap-3 border-t border-hairline p-4 sm:grid-cols-6">
      <div className="sm:col-span-6"><ActionFeedback state={state} /></div>
      <Field label="Task" name="title" idPrefix="tt" error={fieldError(state, "title")} className="sm:col-span-2"><Input required maxLength={200} placeholder="e.g. Request police clearance" /></Field>
      <Field label="When" name="stageId" idPrefix="tt" className="sm:col-span-2">
        <Select defaultValue=""><option value="">When the matter opens</option>{stages.map((s) => <option key={s.id} value={s.id}>On reaching {s.name}{s.serviceName ? ` (${s.serviceName})` : ""}</option>)}</Select>
      </Field>
      <Field label="For service" name="serviceId" idPrefix="tt" className="sm:col-span-2">
        <Select defaultValue=""><option value="">Every service</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <Field label="Assign to" name="assignTo" idPrefix="tt" className="sm:col-span-2">
        <Select defaultValue="case_manager"><option value="case_manager">Case manager</option><option value="consultant">Consultant</option><option value="unassigned">Team (unassigned)</option></Select>
      </Field>
      <Field label="Due after (days)" name="dueOffsetDays" idPrefix="tt" error={fieldError(state, "dueOffsetDays")}><Input type="number" min={0} max={365} placeholder="None" /></Field>
      <Field label="Priority" name="priority" idPrefix="tt"><Select defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
      <div className="flex items-end sm:col-span-2"><SubmitButton>Add template</SubmitButton></div>
    </form>
  );
}

export function TemplateToggle({ slug, t }: { slug: string; t: Template }) {
  const [pending, run] = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTaskTemplateActiveAction(slug, t.id, !t.isActive))}>{t.isActive ? "Turn off" : "Turn on"}</Button>;
}

export function DeadlineRuleForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(saveDeadlineRuleAction.bind(null, slug, null), null);
  return (
    <form action={action} className="grid gap-3 border-t border-hairline p-4 sm:grid-cols-6">
      <div className="sm:col-span-6"><ActionFeedback state={state} /></div>
      <Field label="Rule name" name="name" idPrefix="dr" error={fieldError(state, "name")} className="sm:col-span-3"><Input required maxLength={120} /></Field>
      <Field label="Country" name="jurisdiction" idPrefix="dr" error={fieldError(state, "jurisdiction")}><Select defaultValue="ZA"><option value="ZA">South Africa</option><option value="ZW">Zimbabwe</option><option value="AU">Australia</option><option value="GB">United Kingdom</option></Select></Field>
      <Field label="Days" name="offsetDays" idPrefix="dr" error={fieldError(state, "offsetDays")}><Input type="number" required min={-3650} max={3650} /></Field>
      <div className="flex items-end pb-2"><Checkbox name="businessDays" label="Business days" /></div>
      <Field label="Counted from" name="fromLabel" idPrefix="dr" error={fieldError(state, "fromLabel")} className="sm:col-span-3"><Input required maxLength={120} placeholder="e.g. the date the decision was received" /></Field>
      <Field label="Source" name="source" idPrefix="dr" hint="The provision, regulation or official page the rule comes from." error={fieldError(state, "source")} className="sm:col-span-3"><Input required maxLength={500} /></Field>
      <div className="sm:col-span-6"><SubmitButton>Add rule</SubmitButton></div>
    </form>
  );
}

export function RuleValidation({ slug, ruleId, validated }: { slug: string; ruleId: string; validated: boolean }) {
  const [pending, run] = useAct();
  return validated ? (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm("Withdraw this rule? It can no longer be used for new calculations.")) run(() => validateDeadlineRuleAction(slug, ruleId, false)); }}><ShieldOff /> Withdraw</Button>
  ) : (
    <Button size="sm" disabled={pending} onClick={() => { if (window.confirm("Confirm you have checked this rule against its source and it is correct to use for deadlines.")) run(() => validateDeadlineRuleAction(slug, ruleId, true)); }}><ShieldCheck /> Validate</Button>
  );
}

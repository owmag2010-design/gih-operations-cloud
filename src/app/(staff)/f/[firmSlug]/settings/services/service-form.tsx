"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";

type Line = { label: string; amount: string; kind: string };
export type ServiceFormValues = { name: string; category: string; jurisdiction: string; currency: string; deposit: string; isActive: boolean; lines: Line[] };

const CATEGORIES = ["Consultation", "Temporary residence", "Work & business", "Permanent residence & citizenship", "Legal & appeals", "Documents & ancillary", "Other"];
const KINDS = [
  ["professional", "Professional fee"],
  ["government", "Government / VFS"],
  ["third_party", "Third party"],
] as const;

const asNumber = (s: string) => {
  const n = Number(s.replace(/[R\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function ServiceForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: ActionResult | null, form: FormData) => Promise<ActionResult>;
  initial: ServiceFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines : [{ label: "Professional fee", amount: "", kind: "professional" }]);
  const err = (n: string) => fieldError(state, n);
  const total = lines.reduce((a, l) => a + asNumber(l.amount), 0);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service name" name="name" error={err("name")} className="sm:col-span-2"><Input defaultValue={initial.name} required maxLength={160} /></Field>
        <Field label="Group" name="category" error={err("category")}>
          <Select defaultValue={initial.category || "Other"}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country" name="jurisdiction" hint="Two letters, e.g. ZA" error={err("jurisdiction")}><Input defaultValue={initial.jurisdiction} maxLength={2} required className="uppercase" /></Field>
          <Field label="Currency" name="currency" error={err("currency")}>
            <Select defaultValue={initial.currency}>{["ZAR", "AUD", "USD", "GBP", "EUR"].map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-ink">Fee lines</legend>
        <p className="text-xs text-muted">The total is the sum of these lines. Government and third-party costs are shown separately to the client.</p>
        {err("lines") ? <p className="text-xs text-danger">{err("lines")}</p> : null}
        <div className="grid grid-cols-[1fr_8rem_10rem_2.25rem] gap-2 text-xs font-medium text-ink-2" aria-hidden><span>Line</span><span className="text-right">Amount</span><span>Kind</span><span /></div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_10rem_2.25rem] items-center gap-2">
            <Input name="lineLabel" value={l.label} onChange={(e) => set(i, { label: e.target.value })} required maxLength={120} aria-label={`Line ${i + 1} name`} />
            <Input name="lineAmount" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} required inputMode="decimal" className="num text-right" aria-label={`Line ${i + 1} amount`} />
            <Select name="lineKind" value={l.kind} onChange={(e) => set(i, { kind: e.target.value })} aria-label={`Line ${i + 1} kind`}>{KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" disabled={lines.length >= 12} onClick={() => setLines((ls) => [...ls, { label: "", amount: "", kind: "third_party" }])}><Plus /> Add line</Button>
          <p className="num text-[13px] text-ink">Total: <span className="font-medium">{total.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span></p>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deposit to start" name="deposit" hint="Usually 50% of the total." error={err("deposit")}><Input defaultValue={initial.deposit} required inputMode="decimal" className="num" /></Field>
        <div className="flex items-end pb-2"><Checkbox name="isActive" defaultChecked={initial.isActive} label="Offered (can be added to proposals)" /></div>
        <Field label="Reason for this change" name="reason" hint="Kept in the price history, e.g. “2027 fee review”." error={err("reason")} className="sm:col-span-2"><Input required minLength={3} maxLength={300} /></Field>
      </div>
      <div><SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton></div>
    </form>
  );
}

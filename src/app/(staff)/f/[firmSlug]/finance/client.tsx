"use client";

import { CreditCard, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, cn, Field, Input, Select, Textarea, type ButtonProps } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/labels";
import type { ActionResult } from "@/server/errors";
import {
  allocatePaymentAction, creditInvoiceAction, invoiceFromProposalAction, issueInvoiceAction, paymentLinkAction, recordPaymentAction, rejectPaymentAction, saveBillingAction,
  saveDraftAction, verifyPaymentAction, voidInvoiceAction, type DraftLine,
} from "./actions";
import { LINE_KIND } from "./labels";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

/** A dialog holding one form; closes once per successful submission. */
function FormDialog({ trigger, triggerVariant = "secondary", title, description, action, submit, pendingText, children, wide }: {
  trigger: React.ReactNode; triggerVariant?: ButtonProps["variant"]; title: string; description?: string; action: Action; submit: string; pendingText?: string; children: (state: ActionResult | null) => React.ReactNode; wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  const handled = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      setOpen(false);
    }
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={triggerVariant}>{trigger}</Button></DialogTrigger>
      <DialogContent title={title} description={description} wide={wide}>
        <form action={formAction} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          {children(state)}
          <div className="flex justify-end"><SubmitButton variant={triggerVariant === "danger" ? "danger" : "primary"} pendingText={pendingText}>{submit}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Draft editor ───────── */

type Line = DraftLine & { key: string };
type DraftProps = {
  slug: string; id: string; currency: string; taxRateBp: number | null; taxLabel: string | null;
  fields: { billToName: string; billToEmail: string; billToAddress: string; reference: string; terms: string; notes: string };
  lines: { kind: string; description: string; quantity: number; unitMinor: number; taxable: boolean }[];
};

const toMinor = (v: string) => {
  const s = v.replace(/[\s,]/g, "").replace(/^R/i, "");
  return /^-?\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN;
};
let seq = 0;
const newKey = () => `l${++seq}`;

export function DraftEditor({ slug, id, currency: initialCurrency, taxRateBp, taxLabel, fields: initial, lines: initialLines }: DraftProps) {
  const [fields, setFields] = useState({ ...initial, currency: initialCurrency });
  const [lines, setLines] = useState<Line[]>(() =>
    initialLines.length
      ? initialLines.map((l) => ({ key: newKey(), kind: l.kind, description: l.description, quantity: String(l.quantity), unit: (Math.abs(l.unitMinor) / 100).toFixed(2), taxable: l.taxable }))
      : [{ key: newKey(), kind: "professional", description: "", quantity: "1", unit: "", taxable: true }],
  );
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, taxBase = 0, valid = true;
    for (const l of lines) {
      const unit = toMinor(l.unit);
      const qty = Number(l.quantity);
      if (Number.isNaN(unit) || !Number.isInteger(qty) || qty < 1) { valid = false; continue; }
      const t = Math.abs(unit) * qty;
      if (l.kind === "discount") discount += t;
      else { subtotal += t; if (l.taxable) taxBase += t; }
    }
    const taxable = subtotal > 0 ? Math.max(0, taxBase - Math.round((discount * taxBase) / subtotal)) : 0;
    const tax = taxRateBp ? Math.round((taxable * taxRateBp) / 10_000) : 0;
    return { subtotal, discount, tax, total: subtotal - discount + tax, valid };
  }, [lines, taxRateBp]);

  const setField = (k: keyof typeof fields, v: string) => { setFields((f) => ({ ...f, [k]: v })); setDirty(true); };
  const setLine = (key: string, patch: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); setDirty(true); };
  const money = (m: number) => formatMoney(m, /^[A-Z]{3}$/.test(fields.currency.toUpperCase()) ? fields.currency.toUpperCase() : initialCurrency);

  const save = () =>
    start(async () => {
      const r = await saveDraftAction(slug, id, fields, lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unit: l.unit, taxable: l.taxable })));
      if (r.ok) { setDirty(false); setErrors({}); toast.success(r.message); } else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bill to" name="billToName" idPrefix="d" error={errors.billToName}><Input value={fields.billToName} onChange={(e) => setField("billToName", e.target.value)} maxLength={160} /></Field>
        <Field label="Email" name="billToEmail" idPrefix="d" error={errors.billToEmail}><Input type="email" value={fields.billToEmail} onChange={(e) => setField("billToEmail", e.target.value)} /></Field>
        <Field label="Address" name="billToAddress" idPrefix="d" hint="Printed under the name." error={errors.billToAddress}><Textarea rows={2} value={fields.billToAddress} onChange={(e) => setField("billToAddress", e.target.value)} maxLength={500} /></Field>
        <div className="grid grid-cols-[1fr_7rem] gap-4">
          <Field label="Reference" name="reference" idPrefix="d" error={errors.reference}><Input value={fields.reference} onChange={(e) => setField("reference", e.target.value)} maxLength={120} /></Field>
          <Field label="Currency" name="currency" idPrefix="d" error={errors.currency}><Input value={fields.currency} onChange={(e) => setField("currency", e.target.value.toUpperCase())} maxLength={3} className="uppercase" /></Field>
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-2">Lines</legend>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-2 items-end gap-2 rounded-md border border-hairline p-2 sm:grid-cols-[10rem_1fr_4.5rem_8rem_auto_auto]">
              <div className="flex flex-col gap-1">
                <label htmlFor={`k-${l.key}`} className="text-xs text-muted">Type</label>
                <Select id={`k-${l.key}`} value={l.kind} onChange={(e) => setLine(l.key, { kind: e.target.value, taxable: e.target.value === "professional" || e.target.value === "disbursement" ? l.taxable : false })}>
                  {Object.entries(LINE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <label htmlFor={`d-${l.key}`} className="text-xs text-muted">Description</label>
                <Input id={`d-${l.key}`} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} maxLength={300} aria-invalid={errors[`${i}.description`] ? true : undefined} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`q-${l.key}`} className="text-xs text-muted">Qty</label>
                <Input id={`q-${l.key}`} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className="num text-right" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`u-${l.key}`} className="text-xs text-muted">Unit amount</label>
                <Input id={`u-${l.key}`} inputMode="decimal" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} placeholder="0.00" className="num text-right" aria-invalid={l.unit !== "" && Number.isNaN(toMinor(l.unit)) ? true : undefined} />
              </div>
              <Checkbox label="Taxable" checked={l.taxable} disabled={l.kind === "discount" || l.kind === "government" || l.kind === "third_party"} onChange={(e) => setLine(l.key, { taxable: e.target.checked })} className="h-9 items-center" />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => { setLines((ls) => [...ls, { key: newKey(), kind: "professional", description: "", quantity: "1", unit: "", taxable: true }]); setDirty(true); }}><Plus className="size-4" /> Add line</Button>
        <p className="mt-1 text-xs text-muted">Government and third-party costs are charged at cost and are not taxed.</p>
      </fieldset>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-[13px]">
        <dt className="text-muted">Subtotal</dt><dd className="num text-right">{money(totals.subtotal)}</dd>
        {totals.discount ? <><dt className="text-muted">Discount</dt><dd className="num text-right">−{money(totals.discount)}</dd></> : null}
        {taxRateBp ? <><dt className="text-muted">{taxLabel ?? "VAT"} at {taxRateBp / 100}%</dt><dd className="num text-right">{money(totals.tax)}</dd></> : null}
        <dt className="border-t border-hairline pt-1 font-semibold text-ink">Total</dt><dd className="num border-t border-hairline pt-1 text-right font-semibold">{money(totals.total)}</dd>
      </dl>
      {!totals.valid ? <p className="text-right text-xs text-warn">Some lines have an amount or quantity that can&apos;t be read yet.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Terms" name="terms" idPrefix="d" hint="Defaults from billing settings." error={errors.terms}><Textarea rows={3} value={fields.terms} onChange={(e) => setField("terms", e.target.value)} maxLength={2000} /></Field>
        <Field label="Notes to the client" name="notes" idPrefix="d" error={errors.notes}><Textarea rows={3} value={fields.notes} onChange={(e) => setField("notes", e.target.value)} maxLength={2000} /></Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
        <span className={cn("text-xs", dirty ? "text-warn" : "text-muted")} role="status">{dirty ? "Unsaved changes" : "All changes saved"}</span>
      </div>
    </div>
  );
}

/* ───────── Invoice actions ───────── */

export function IssueDialog({ slug, id, termsDays, disabled }: { slug: string; id: string; termsDays: number; disabled?: boolean }) {
  if (disabled) return <Button variant="primary" disabled title="Save the draft first">Issue invoice</Button>;
  return (
    <FormDialog trigger="Issue invoice" triggerVariant="primary" title="Issue this invoice" description="It gets the next number and can no longer be edited. Corrections are made with a credit note." action={issueInvoiceAction.bind(null, slug, id)} submit="Issue invoice" pendingText="Issuing…">
      {(s) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issue date" name="issueDate" idPrefix="iss" hint="Defaults to today." error={fieldError(s, "issueDate")}><Input type="date" /></Field>
          <Field label="Payment terms (days)" name="dueDays" idPrefix="iss" error={fieldError(s, "dueDays")}><Input type="number" min={0} max={120} defaultValue={termsDays} /></Field>
        </div>
      )}
    </FormDialog>
  );
}

export function VoidDialog({ slug, id, isDraft }: { slug: string; id: string; isDraft: boolean }) {
  return (
    <FormDialog trigger={isDraft ? "Discard draft" : "Void invoice"} triggerVariant="danger" title={isDraft ? "Discard this draft" : "Void this invoice"} description={isDraft ? "The draft is kept for the record, marked void." : "Use this only for an invoice issued in error and not paid. The number stays used and the invoice is kept, marked void."} action={voidInvoiceAction.bind(null, slug, id)} submit={isDraft ? "Discard draft" : "Void invoice"}>
      {(s) => <Field label="Reason" name="reason" idPrefix="void" error={fieldError(s, "reason")}><Textarea rows={2} required minLength={5} maxLength={500} /></Field>}
    </FormDialog>
  );
}

export function CreditDialog({ slug, id, balance, currency }: { slug: string; id: string; balance: number; currency: string }) {
  return (
    <FormDialog trigger="Issue credit note" title="Issue a credit note" description={`Reduces what is owed, up to the unpaid balance of ${formatMoney(balance, currency)}.`} action={creditInvoiceAction.bind(null, slug, id)} submit="Issue credit note">
      {(s) => (
        <>
          <Field label={`Amount (${currency})`} name="amount" idPrefix="cn" error={fieldError(s, "amount")}><Input inputMode="decimal" required defaultValue={(balance / 100).toFixed(2)} className="num" /></Field>
          <Field label="Reason" name="reason" idPrefix="cn" error={fieldError(s, "reason")}><Textarea rows={2} required minLength={5} maxLength={500} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function RecordPaymentDialog({ slug, invoiceId, currency, balance, clients }: { slug: string; invoiceId?: string; currency: string; balance?: number; clients?: { id: string; label: string }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <FormDialog trigger="Record payment" title="Record money received" description="For bank transfers, cash and card machines. It counts only once someone else has checked it against the bank statement." action={recordPaymentAction.bind(null, slug)} submit="Record payment">
      {(s) => (
        <>
          {invoiceId ? <input type="hidden" name="invoiceId" value={invoiceId} /> : null}
          {!invoiceId && clients ? (
            <Field label="Client" name="clientId" idPrefix="pay" hint="Optional. Allocate it to an invoice later." error={fieldError(s, "clientId")}>
              <Select defaultValue=""><option value="">Not known yet</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
            <Field label="Amount" name="amount" idPrefix="pay" error={fieldError(s, "amount")}><Input inputMode="decimal" required defaultValue={balance ? (balance / 100).toFixed(2) : ""} className="num" /></Field>
            <Field label="Currency" name="currency" idPrefix="pay" error={fieldError(s, "currency")}><Input defaultValue={currency} maxLength={3} required readOnly={!!invoiceId} className="uppercase" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method" name="method" idPrefix="pay" error={fieldError(s, "method")}>
              <Select defaultValue="eft"><option value="eft">EFT</option><option value="cash">Cash</option><option value="card_machine">Card machine</option><option value="other">Other</option></Select>
            </Field>
            <Field label="Date received" name="receivedOn" idPrefix="pay" error={fieldError(s, "receivedOn")}><Input type="date" defaultValue={today} max={today} required /></Field>
          </div>
          <Field label="Bank or receipt reference" name="reference" idPrefix="pay" error={fieldError(s, "reference")}><Input required maxLength={120} /></Field>
          <Field label="Note" name="note" idPrefix="pay" error={fieldError(s, "note")}><Textarea rows={2} maxLength={500} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function VerifyPaymentDialog({ slug, paymentId, summary }: { slug: string; paymentId: string; summary: string }) {
  return (
    <FormDialog trigger="Verify" triggerVariant="primary" title="Verify against the bank statement" description={summary} action={verifyPaymentAction.bind(null, slug, paymentId)} submit="Mark verified">
      {(s) => <Field label="Statement line or reference you checked" name="statementRef" idPrefix="ver" error={fieldError(s, "statementRef")}><Input required minLength={3} maxLength={200} /></Field>}
    </FormDialog>
  );
}

export function RejectPaymentDialog({ slug, paymentId }: { slug: string; paymentId: string }) {
  return (
    <FormDialog trigger="Reject" triggerVariant="danger" title="Reject this payment" description="Use this when the money isn't on the statement. The record is kept, marked rejected." action={rejectPaymentAction.bind(null, slug, paymentId)} submit="Reject payment">
      {(s) => <Field label="Reason" name="reason" idPrefix="rej" error={fieldError(s, "reason")}><Textarea rows={2} required minLength={5} maxLength={500} /></Field>}
    </FormDialog>
  );
}

export function AllocateDialog({ slug, paymentId, invoices }: { slug: string; paymentId: string; invoices: { id: string; label: string }[] }) {
  return (
    <FormDialog trigger="Allocate" title="Allocate to an invoice" description="Choose an issued invoice in the same currency." action={allocatePaymentAction.bind(null, slug, paymentId)} submit="Allocate">
      {(s) => (
        <Field label="Invoice" name="invoiceId" idPrefix="alloc" error={fieldError(s, "invoiceId")}>
          <Select required defaultValue=""><option value="">Choose an invoice</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select>
        </Field>
      )}
    </FormDialog>
  );
}

export function PaymentLinkButton({ slug, id, existing }: { slug: string; id: string; existing: string | null }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await paymentLinkAction(slug, id); if (r.ok) toast.success(r.message); else toast.error(r.error); })}
      >
        <CreditCard className="size-4" /> {pending ? "Creating…" : existing ? "New payment link" : "Create payment link"}
      </Button>
      {existing ? (
        <Button type="button" variant="ghost" onClick={() => navigator.clipboard.writeText(existing).then(() => toast.success("Link copied."), () => toast.error("Couldn't copy the link."))}>Copy link</Button>
      ) : null}
    </div>
  );
}

export function ProposalInvoiceButtons({ slug, proposalId, hasDeposit, existing }: { slug: string; proposalId: string; hasDeposit: boolean; existing: string[] }) {
  const [pending, start] = useTransition();
  const make = (part: "deposit" | "balance" | "full") =>
    start(async () => {
      const r = await invoiceFromProposalAction(slug, proposalId, part);
      if (r && !r.ok) toast.error(r.error);
    });
  const hasDepositInvoice = existing.includes("deposit");
  return (
    <div className="flex flex-wrap gap-2">
      {hasDeposit && !hasDepositInvoice && !existing.includes("full") ? <Button type="button" variant="primary" disabled={pending} onClick={() => make("deposit")}>Invoice the deposit</Button> : null}
      {hasDepositInvoice && !existing.includes("balance") ? <Button type="button" variant="primary" disabled={pending} onClick={() => make("balance")}>Invoice the balance</Button> : null}
      {!existing.length ? <Button type="button" disabled={pending} onClick={() => make("full")}>Invoice the full amount</Button> : null}
    </div>
  );
}

/* ───────── Billing settings ───────── */

type Billing = {
  invoicePrefix: string; creditNotePrefix: string; defaultCurrency: string; paymentTermsDays: number; taxRateBp: number | null; taxLabel: string | null; taxNumber: string | null;
  registrationNumber: string | null; address: string | null; bankDetails: string | null; invoiceTerms: string | null; invoiceFooter: string | null;
};

export function BillingForm({ slug, billing, canEdit }: { slug: string; billing: Billing; canEdit: boolean }) {
  const [state, action] = useActionState(saveBillingAction.bind(null, slug), null);
  const e = (n: string) => fieldError(state, n);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <fieldset disabled={!canEdit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Invoice prefix" name="invoicePrefix" idPrefix="b" hint="Numbers run on from here." error={e("invoicePrefix")}><Input defaultValue={billing.invoicePrefix} required className="uppercase" /></Field>
          <Field label="Credit note prefix" name="creditNotePrefix" idPrefix="b" error={e("creditNotePrefix")}><Input defaultValue={billing.creditNotePrefix} required className="uppercase" /></Field>
          <Field label="Default currency" name="defaultCurrency" idPrefix="b" error={e("defaultCurrency")}><Input defaultValue={billing.defaultCurrency} maxLength={3} required className="uppercase" /></Field>
          <Field label="Payment terms (days)" name="paymentTermsDays" idPrefix="b" error={e("paymentTermsDays")}><Input type="number" min={0} max={120} defaultValue={billing.paymentTermsDays} required /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Tax rate (%)" name="taxRate" idPrefix="b" hint="Leave empty if the practice doesn't charge tax." error={e("taxRate")}><Input inputMode="decimal" defaultValue={billing.taxRateBp ? String(billing.taxRateBp / 100) : ""} /></Field>
          <Field label="Tax label" name="taxLabel" idPrefix="b" hint="e.g. VAT" error={e("taxLabel")}><Input defaultValue={billing.taxLabel ?? ""} maxLength={20} /></Field>
          <Field label="Tax number" name="taxNumber" idPrefix="b" error={e("taxNumber")}><Input defaultValue={billing.taxNumber ?? ""} maxLength={40} /></Field>
          <Field label="Company registration" name="registrationNumber" idPrefix="b" error={e("registrationNumber")}><Input defaultValue={billing.registrationNumber ?? ""} maxLength={60} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Practice address" name="address" idPrefix="b" error={e("address")}><Textarea rows={3} defaultValue={billing.address ?? ""} maxLength={500} /></Field>
          <Field label="Bank details" name="bankDetails" idPrefix="b" hint="Printed under “How to pay”." error={e("bankDetails")}><Textarea rows={3} defaultValue={billing.bankDetails ?? ""} maxLength={800} /></Field>
          <Field label="Standard terms" name="invoiceTerms" idPrefix="b" hint="Copied onto new drafts." error={e("invoiceTerms")}><Textarea rows={3} defaultValue={billing.invoiceTerms ?? ""} maxLength={2000} /></Field>
          <Field label="Footer" name="invoiceFooter" idPrefix="b" error={e("invoiceFooter")}><Textarea rows={3} defaultValue={billing.invoiceFooter ?? ""} maxLength={300} /></Field>
        </div>
      </fieldset>
      {canEdit ? <div><SubmitButton variant="primary" pendingText="Saving…">Save billing settings</SubmitButton></div> : <p className="text-xs text-muted">Only finance officers and practice administrators can change these.</p>}
    </form>
  );
}

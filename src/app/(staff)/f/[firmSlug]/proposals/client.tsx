"use client";

import { ArrowDown, ArrowUp, Copy, FileText, Plus, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";
import {
  addProposalItemAction,
  createProposalAction,
  proposalStepAction,
  removeProposalItemAction,
  saveProposalAction,
  updateProposalItemAction,
  type ProposalDetailsPayload,
} from "../actions";

type ServiceOption = { id: string; name: string; category: string; total: string };

export function CreateProposalDialog({ firmSlug, leadId, services }: { firmSlug: string; leadId: string; services: ServiceOption[] }) {
  const [state, action] = useActionState(createProposalAction.bind(null, firmSlug, leadId), null);
  const [q, setQ] = useState("");
  const shown = services.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(shown.map((s) => s.category))];
  return (
    <Dialog>
      <DialogTrigger asChild><Button><FileText /> Create proposal</Button></DialogTrigger>
      <DialogContent title="Create a proposal" description="Pick the services to quote. The fees come from the catalogue; you can adjust them on the next screen." wide>
        <form action={action} className="flex flex-col gap-3">
          <ActionFeedback state={state} />
          <Input placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search services" />
          <div className="max-h-[48vh] overflow-y-auto rounded-md border border-hairline">
            {groups.map((g) => (
              <fieldset key={g} className="border-b border-hairline last:border-0">
                <legend className="sr-only">{g}</legend>
                <p className="bg-sunken px-3 py-1.5 text-xs font-medium text-ink-2">{g}</p>
                {shown.filter((s) => s.category === g).map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-sunken">
                    <input type="checkbox" name="serviceId" value={s.id} className="size-4 accent-[var(--accent)]" />
                    <span className="flex-1 text-ink">{s.name}</span>
                    <span className="num text-muted">{s.total}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            {!shown.length ? <p className="p-4 text-[13px] text-muted">No services match.</p> : null}
          </div>
          <div><SubmitButton pendingText="Creating…">Create proposal</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DetailsEditor({ firmSlug, id, initial, editable }: { firmSlug: string; id: string; initial: ProposalDetailsPayload; editable: boolean }) {
  const [d, setD] = useState(initial);
  const [saving, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const set = (p: Partial<ProposalDetailsPayload>) => {
    setD((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const setSection = (i: number, p: Partial<ProposalDetailsPayload["sections"][number]>) => set({ sections: d.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...d.sections];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    set({ sections: next });
  };
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" name="title" className="sm:col-span-2"><Input value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={160} /></Field>
        <Field label="Prepared for" name="recipientName"><Input value={d.recipientName} onChange={(e) => set({ recipientName: e.target.value })} maxLength={160} /></Field>
        <Field label="Client email" name="recipientEmail"><Input type="email" value={d.recipientEmail} onChange={(e) => set({ recipientEmail: e.target.value })} /></Field>
        <Field label="Valid for (days)" name="validDays"><Input type="number" min={1} max={90} value={d.validDays} onChange={(e) => set({ validDays: Number(e.target.value) })} /></Field>
        <Field label="Currency" name="currency"><Select value={d.currency} onChange={(e) => set({ currency: e.target.value })}>{["ZAR", "AUD", "USD", "GBP", "EUR"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-medium text-ink">Sections</p>
        {d.sections.map((s, i) => (
          <div key={s.key} className="rounded-md border border-hairline p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="num w-6 text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
              <Input aria-label={`Section ${i + 1} title`} value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} maxLength={120} className="flex-1" />
              {editable ? (
                <span className="flex">
                  <Button type="button" size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Move down" disabled={i === d.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove section" onClick={() => set({ sections: d.sections.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </span>
              ) : null}
            </div>
            <Textarea aria-label={`Section ${i + 1} text`} value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} rows={Math.min(14, Math.max(4, s.body.split("\n").length + 1))} maxLength={8000} />
          </div>
        ))}
        {editable ? <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => set({ sections: [...d.sections, { key: `custom_${Date.now().toString(36)}`, title: "New section", body: "" }] })}><Plus /> Add section</Button> : null}
      </div>
      {editable ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={saving || !dirty}
            onClick={() =>
              start(async () => {
                const r = await saveProposalAction(firmSlug, id, d);
                if (r.ok) {
                  toast.success(r.message ?? "Saved.");
                  setDirty(false);
                } else toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0] ?? r.error : r.error);
              })
            }
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {dirty ? <span className="text-xs text-warn">Unsaved changes</span> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

type Item = { id: string; label: string; description: string | null; quantity: number; unit: string; deposit: string; total: string; fromCatalogue: boolean; lines: string[] };

export function ItemsEditor({ firmSlug, id, items, services, editable, totals }: { firmSlug: string; id: string; items: Item[]; services: ServiceOption[]; editable: boolean; totals: { total: string; deposit: string; balance: string } }) {
  const [addState, add] = useActionState(addProposalItemAction.bind(null, firmSlug, id), null);
  const [pending, start] = useTransition();
  return (
    <div>
      <ul className="divide-y divide-hairline">
        {items.map((it) => (
          <li key={it.id} className="px-4 py-3">
            {editable ? (
              <ItemRow firmSlug={firmSlug} proposalId={id} item={it} onRemove={() => start(async () => { const r = await removeProposalItemAction(firmSlug, id, it.id); if (!r.ok) toast.error(r.error); })} pending={pending} />
            ) : (
              <div className="flex justify-between gap-3 text-[13px]">
                <div><p className="font-medium text-ink">{it.label}{it.quantity > 1 ? ` × ${it.quantity}` : ""}</p>{it.lines.length ? <p className="text-xs text-muted">{it.lines.join(" · ")}</p> : null}</div>
                <p className="num text-ink">{it.total}</p>
              </div>
            )}
          </li>
        ))}
        {!items.length ? <li className="px-4 py-6 text-[13px] text-muted">No fee items yet.</li> : null}
      </ul>
      <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-hairline px-4 py-3 text-[13px]">
        <dt className="text-ink-2">Total</dt><dd className="text-right font-semibold text-ink">{totals.total}</dd>
        <dt className="text-ink-2">Deposit to start</dt><dd className="text-right text-ink">{totals.deposit}</dd>
        <dt className="text-muted">Balance before submission</dt><dd className="text-right text-muted">{totals.balance}</dd>
      </dl>
      {editable ? (
        <div className="grid gap-4 border-t border-hairline p-4 lg:grid-cols-2">
          <form action={add} className="flex items-end gap-2">
            <Field label="Add from the catalogue" name="serviceId" className="flex-1">
              <Select defaultValue="" required>
                <option value="" disabled>Choose a service</option>
                {[...new Set(services.map((s) => s.category))].map((g) => (
                  <optgroup key={g} label={g}>{services.filter((s) => s.category === g).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.total})</option>)}</optgroup>
                ))}
              </Select>
            </Field>
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </form>
          <CustomItemForm firmSlug={firmSlug} id={id} />
          <div className="lg:col-span-2"><ActionFeedback state={addState} successToast={false} /></div>
        </div>
      ) : null}
    </div>
  );
}

function CustomItemForm({ firmSlug, id }: { firmSlug: string; id: string }) {
  const [state, action] = useActionState(addProposalItemAction.bind(null, firmSlug, id), null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-ink">Or add your own item</p>
      <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
        <Input name="label" placeholder="e.g. Courier" aria-label="Item" required maxLength={160} />
        <Input name="unit" placeholder="Amount" aria-label="Amount" required inputMode="decimal" className="num" />
        <Input name="deposit" placeholder="Deposit" aria-label="Deposit (optional)" inputMode="decimal" className="num" />
      </div>
      <ActionFeedback state={state} successToast={false} />
      <div><SubmitButton pendingText="Adding…" size="sm">Add item</SubmitButton></div>
    </form>
  );
}

function ItemRow({ firmSlug, proposalId, item, onRemove, pending }: { firmSlug: string; proposalId: string; item: Item; onRemove: () => void; pending: boolean }) {
  const [state, action] = useActionState(updateProposalItemAction.bind(null, firmSlug, proposalId, item.id), null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_4rem_7rem_7rem_auto] items-center gap-2">
        <Input name="label" defaultValue={item.label} aria-label="Item" maxLength={160} required />
        <Input name="quantity" defaultValue={item.quantity} aria-label="Quantity" type="number" min={1} max={99} className="num" />
        <Input name="unit" defaultValue={item.unit} aria-label="Price" inputMode="decimal" className="num text-right" required />
        <Input name="deposit" defaultValue={item.deposit} aria-label="Deposit" inputMode="decimal" className="num text-right" />
        <span className="flex">
          <SubmitButton size="sm" variant="secondary" pendingText="…">Save</SubmitButton>
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item.label}`} disabled={pending} onClick={onRemove}><Trash2 /></Button>
        </span>
      </div>
      <input type="hidden" name="description" value={item.description ?? ""} />
      {item.lines.length ? <p className="text-xs text-muted">{item.fromCatalogue ? "From the catalogue: " : ""}{item.lines.join(" · ")}</p> : null}
      {fieldError(state, "unit") || fieldError(state, "deposit") ? <p className="text-xs text-danger">{fieldError(state, "unit") ?? fieldError(state, "deposit")}</p> : null}
      <ActionFeedback state={state} />
    </form>
  );
}

export function WorkflowBar({ firmSlug, id, status, can }: { firmSlug: string; id: string; status: string; can: { edit: boolean; approve: boolean; release: boolean } }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<{ url: string; validUntil: string } | null>(null);
  const [note, setNote] = useState("");
  const run = (step: Parameters<typeof proposalStepAction>[2], n?: string) =>
    start(async () => {
      const r = await proposalStepAction(firmSlug, id, step, n);
      if (r.ok) {
        toast.success(r.message ?? "Done.");
        if (r.data?.url) setLink({ url: r.data.url, validUntil: r.data.validUntil ?? "" });
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {can.edit && (status === "draft" || status === "changes_requested") ? <Button variant="primary" disabled={pending} onClick={() => run("submit")}>Send for review</Button> : null}
        {can.approve && status === "in_review" ? <Button variant="primary" disabled={pending} onClick={() => run("approve")}>Approve</Button> : null}
        {can.approve && (status === "in_review" || status === "approved") ? (
          <Dialog>
            <DialogTrigger asChild><Button disabled={pending}>Request changes</Button></DialogTrigger>
            <DialogContent title="Request changes" description="The author sees this note on the proposal.">
              <div className="flex flex-col gap-3">
                <Field label="What needs to change" name="note"><Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
                <div><Button variant="primary" disabled={pending || note.trim().length < 3} onClick={() => run("changes", note)}>Send back</Button></div>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
        {can.release && status === "approved" ? <Button variant="primary" disabled={pending} onClick={() => run("release")}>Send to client</Button> : null}
        {can.release && status === "released" ? <Button disabled={pending} onClick={() => run("renew")}>New client link</Button> : null}
        {can.edit && ["released", "declined", "withdrawn", "approved", "in_review"].includes(status) ? <Button disabled={pending} onClick={() => run("revise")}>{status === "released" || status === "declined" ? "Start a new version" : "Reopen for editing"}</Button> : null}
        {can.release && ["draft", "in_review", "changes_requested", "approved", "released"].includes(status) ? <Button variant="danger" disabled={pending} onClick={() => run("withdraw")}>Withdraw</Button> : null}
      </div>
      {link ? (
        <Notice tone="ok">
          <p className="font-medium">Client link (shown once; copy it now)</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={link.url} aria-label="Client link" className="num" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" onClick={() => { void navigator.clipboard.writeText(link.url); toast.success("Link copied."); }}><Copy /> Copy</Button>
          </div>
          <p className="mt-1.5 text-xs">Send it by email or WhatsApp. It works until {new Date(link.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</p>
        </Notice>
      ) : null}
    </div>
  );
}

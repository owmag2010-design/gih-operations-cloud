"use client";

import { useActionState, useState } from "react";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Field, Input, Select } from "@/components/ui/primitives";
import { createInvoiceAction } from "../../actions";

type Props = {
  slug: string;
  clients: { id: string; ref: string; firstName: string; lastName: string | null }[];
  matters: { id: string; ref: string; title: string; clientId: string }[];
  defaultCurrency: string;
  defaults: { clientId?: string; matterId?: string };
};

export function NewInvoiceForm({ slug, clients, matters, defaultCurrency, defaults }: Props) {
  const [state, action] = useActionState(createInvoiceAction.bind(null, slug), null);
  const fromMatter = matters.find((m) => m.id === defaults.matterId);
  const [clientId, setClientId] = useState(fromMatter?.clientId ?? defaults.clientId ?? "");
  const own = matters.filter((m) => m.clientId === clientId);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Client" name="clientId" idPrefix="inv" error={fieldError(state, "clientId")}>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Choose a client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(" ")} ({c.ref})</option>)}
          </Select>
        </Field>
        <Field label="Matter" name="matterId" idPrefix="inv" hint={clientId && !own.length ? "This client has no matters you can see." : "Optional. Links the invoice to the matter."} error={fieldError(state, "matterId")}>
          <Select key={clientId} defaultValue={fromMatter?.id ?? ""} disabled={!own.length}>
            <option value="">No matter</option>
            {own.map((m) => <option key={m.id} value={m.id}>{m.ref}: {m.title}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Currency" name="currency" idPrefix="inv" hint="Three-letter code, e.g. ZAR, USD." error={fieldError(state, "currency")}>
          <Input defaultValue={defaultCurrency} maxLength={3} required className="uppercase" />
        </Field>
        <Field label="Reference" name="reference" idPrefix="inv" hint="Optional, e.g. the client's order number." error={fieldError(state, "reference")}>
          <Input maxLength={120} />
        </Field>
      </div>
      <div><SubmitButton variant="primary" pendingText="Creating…">Create draft</SubmitButton></div>
    </form>
  );
}

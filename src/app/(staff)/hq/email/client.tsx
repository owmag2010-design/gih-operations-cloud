"use client";

import { useActionState } from "react";
import { saveMailboxAction } from "../../email-actions";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";

type Box = { id: string | null; firmId: string | null; label: string; inboundAddress: string; forwardedFrom: string | null; fromName: string; fromAddress: string; signature: string | null; isActive: boolean };

export function MailboxForm({ box, firms }: { box: Box; firms: { id: string; name: string }[] }) {
  const [state, action] = useActionState(saveMailboxAction.bind(null, box.id), null);
  const err = (n: string) => fieldError(state, n);
  const p = `mb-${box.id ?? "new"}`;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
      <Field idPrefix={p} label="Inbox for" name="firmId" error={err("firmId")}>
        <Select defaultValue={box.firmId ?? ""}><option value="">Global Immigration Hub</option>{firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
      </Field>
      <Field idPrefix={p} label="Name" name="label" error={err("label")}><Input defaultValue={box.label} required /></Field>
      <Field idPrefix={p} label="Receiving address (Resend)" name="inboundAddress" hint="Your Outlook rule redirects mail here." error={err("inboundAddress")}><Input type="email" defaultValue={box.inboundAddress} required /></Field>
      <Field idPrefix={p} label="Forwarded from" name="forwardedFrom" hint="The real mailbox, for reference." error={err("forwardedFrom")}><Input defaultValue={box.forwardedFrom ?? ""} /></Field>
      <Field idPrefix={p} label="Sender name" name="fromName" error={err("fromName")}><Input defaultValue={box.fromName} required /></Field>
      <Field idPrefix={p} label="Send from" name="fromAddress" hint="Must be on a domain verified in Resend." error={err("fromAddress")}><Input type="email" defaultValue={box.fromAddress} required /></Field>
      <Field idPrefix={p} label="Signature" name="signature" hint="Added under every email. Leave empty to use the sender's name and firm." className="sm:col-span-2"><Textarea rows={3} defaultValue={box.signature ?? ""} /></Field>
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <Checkbox name="isActive" defaultChecked={box.isActive} label="Active" />
        <SubmitButton>{box.id ? "Save mailbox" : "Add mailbox"}</SubmitButton>
      </div>
    </form>
  );
}

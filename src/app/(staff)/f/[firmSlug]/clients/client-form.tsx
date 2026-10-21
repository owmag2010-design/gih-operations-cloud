"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CountrySelect } from "@/components/country-select";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Panel, PanelHeader, Select } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";

type Values = { firstName?: string; lastName?: string | null; email?: string | null; phone?: string | null; nationality?: string | null; countryOfResidence?: string | null; status?: string; primaryConsultantId?: string | null };

export function ClientForm({ action, initial = {}, people, mode, cancelHref }: { action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>; initial?: Values; people: { id: string; name: string }[]; mode: "create" | "edit"; cancelHref: string }) {
  const [state, formAction] = useActionState(action, null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <Panel>
        <PanelHeader title="Client details" description="Add an email address or a phone number." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" error={err("firstName")}><Input defaultValue={initial.firstName ?? ""} required /></Field>
          <Field label="Last name" name="lastName" error={err("lastName")}><Input defaultValue={initial.lastName ?? ""} /></Field>
          <Field label="Email" name="email" error={err("email")}><Input type="email" defaultValue={initial.email ?? ""} /></Field>
          <Field label="Phone" name="phone" error={err("phone")}><Input type="tel" defaultValue={initial.phone ?? ""} /></Field>
          <Field label="Nationality" name="nationality" error={err("nationality")}><CountrySelect defaultValue={initial.nationality ?? ""} /></Field>
          <Field label="Country of residence" name="countryOfResidence" error={err("countryOfResidence")}><CountrySelect defaultValue={initial.countryOfResidence ?? ""} /></Field>
          <Field label="Primary consultant" name="primaryConsultantId" hint={mode === "create" ? "Defaults to you." : undefined} error={err("primaryConsultantId")}>
            <Select defaultValue={initial.primaryConsultantId ?? ""}>
              <option value="">{mode === "create" ? "Me" : "Keep current"}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Status" name="status" error={err("status")}>
            <Select defaultValue={initial.status ?? "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
        </div>
      </Panel>
      <div className="flex gap-2">
        <SubmitButton>{mode === "create" ? "Create client" : "Save changes"}</SubmitButton>
        <Button asChild variant="ghost"><Link href={cancelHref}>Cancel</Link></Button>
      </div>
    </form>
  );
}

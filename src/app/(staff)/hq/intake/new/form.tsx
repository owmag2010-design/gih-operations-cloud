"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CountrySelect } from "@/components/country-select";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, Field, Input, Panel, PanelHeader, Select, Textarea } from "@/components/ui/primitives";
import { SOURCE_LABELS } from "@/lib/labels";
import { captureIntakeAction } from "../../actions";

export function CaptureForm() {
  const [state, action] = useActionState(captureIntakeAction, null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <Panel>
        <PanelHeader title="Person" description="An email address or a phone number is needed." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" error={err("firstName")}><Input required /></Field>
          <Field label="Last name" name="lastName" error={err("lastName")}><Input /></Field>
          <Field label="Email" name="email" error={err("email")}><Input type="email" /></Field>
          <Field label="Phone" name="phone" error={err("phone")}><Input type="tel" /></Field>
          <Field label="Nationality" name="nationality" error={err("nationality")}><CountrySelect /></Field>
          <Field label="Currently living in" name="currentCountry" error={err("currentCountry")}><CountrySelect /></Field>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Enquiry" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Wants to go to" name="destinationCountry" error={err("destinationCountry")}><CountrySelect /></Field>
          <Field label="Category, if known" name="immigrationCategory" error={err("immigrationCategory")}><Input /></Field>
          <Field label="What they need" name="enquiry" className="sm:col-span-2" hint="In their words where possible. The routing rules read this text." error={err("enquiry")}><Textarea rows={5} maxLength={5000} /></Field>
          <Field label="Came in through" name="source" error={err("source")}>
            <Select defaultValue="manual">{Object.entries(SOURCE_LABELS).filter(([k]) => k !== "hub_intake" && k !== "integration").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <div className="flex items-end sm:col-span-2"><Checkbox name="consentContact" label="They agreed to be contacted about this enquiry" /></div>
        </div>
      </Panel>
      <div className="flex gap-2">
        <SubmitButton pendingText="Saving…">Save enquiry</SubmitButton>
        <Button asChild variant="ghost"><Link href="/hq/intake">Cancel</Link></Button>
      </div>
    </form>
  );
}

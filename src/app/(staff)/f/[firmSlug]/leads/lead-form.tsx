"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CountrySelect } from "@/components/country-select";
import { ActionFeedback, DateTimeInput, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, Field, Input, Panel, PanelHeader, Select, Textarea } from "@/components/ui/primitives";
import { PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/labels";
import type { ActionResult } from "@/server/errors";

export type LeadFormValues = {
  firstName?: string; lastName?: string | null; email?: string | null; phone?: string | null; nationality?: string | null;
  currentCountry?: string | null; destinationCountry?: string | null; immigrationCategory?: string | null; enquiry?: string | null;
  source?: string; sourceDetail?: string | null; priority?: string; assignedToId?: string | null; followUpAt?: string | null; tags?: string[];
};

export function LeadForm({
  action, initial = {}, people, canAssign, mode, cancelHref, selfId,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  initial?: LeadFormValues;
  people: { id: string; name: string }[];
  canAssign: boolean;
  mode: "create" | "edit";
  cancelHref: string;
  selfId: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <Panel>
        <PanelHeader title="Person" description="Add an email address or a phone number so the team can reply." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" error={err("firstName")}><Input defaultValue={initial.firstName ?? ""} required autoComplete="off" /></Field>
          <Field label="Last name" name="lastName" error={err("lastName")}><Input defaultValue={initial.lastName ?? ""} autoComplete="off" /></Field>
          <Field label="Email" name="email" error={err("email")}><Input type="email" defaultValue={initial.email ?? ""} autoComplete="off" /></Field>
          <Field label="Phone" name="phone" hint="Include the country code, or we'll assume the current country." error={err("phone")}><Input type="tel" defaultValue={initial.phone ?? ""} autoComplete="off" /></Field>
          <Field label="Nationality" name="nationality" error={err("nationality")}><CountrySelect defaultValue={initial.nationality ?? ""} /></Field>
          <Field label="Currently living in" name="currentCountry" error={err("currentCountry")}><CountrySelect defaultValue={initial.currentCountry ?? ""} /></Field>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Matter" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Wants to go to" name="destinationCountry" error={err("destinationCountry")}><CountrySelect defaultValue={initial.destinationCountry ?? ""} /></Field>
          <Field label="Immigration category" name="immigrationCategory" hint="For example: spouse visa, critical skills, PR appeal." error={err("immigrationCategory")}><Input defaultValue={initial.immigrationCategory ?? ""} /></Field>
          <Field label="Enquiry" name="enquiry" className="sm:col-span-2" error={err("enquiry")}><Textarea defaultValue={initial.enquiry ?? ""} rows={5} maxLength={5000} /></Field>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Handling" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Source" name="source" error={err("source")}>
            <Select defaultValue={initial.source ?? "manual"}>
              {Object.entries(SOURCE_LABELS).filter(([k]) => k !== "hub_intake" || initial.source === "hub_intake").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Source detail" name="sourceDetail" hint="Referrer, campaign or form name." error={err("sourceDetail")}><Input defaultValue={initial.sourceDetail ?? ""} /></Field>
          <Field label="Priority" name="priority" error={err("priority")}>
            <Select defaultValue={initial.priority ?? "normal"}>{Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <Field label="Assigned to" name="assignedToId" error={err("assignedToId")}>
            {canAssign ? (
              <Select defaultValue={initial.assignedToId ?? ""}>
                <option value="">Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : (
              <Select defaultValue={initial.assignedToId ?? ""}>
                {initial.assignedToId && initial.assignedToId !== selfId ? <option value={initial.assignedToId}>Current assignee</option> : null}
                <option value="">Unassigned</option>
                <option value={selfId}>Me</option>
              </Select>
            )}
          </Field>
          <Field label="Follow up on" name="followUpAt" error={err("followUpAt")}><DateTimeInput defaultValue={initial.followUpAt} /></Field>
          <Field label="Tags" name="tags" hint="Separate with commas." error={err("tags")}><Input defaultValue={(initial.tags ?? []).join(", ")} /></Field>
          {mode === "create" ? (
            <div className="sm:col-span-2">
              <Checkbox name="consentContact" label="The person agreed to be contacted about this enquiry" />
              <input type="hidden" name="consentMethod" value="Confirmed by staff when creating the lead" />
            </div>
          ) : null}
        </div>
      </Panel>
      <div className="flex gap-2">
        <SubmitButton pendingText={mode === "create" ? "Creating…" : "Saving…"}>{mode === "create" ? "Create lead" : "Save changes"}</SubmitButton>
        <Button asChild variant="ghost"><Link href={cancelHref}>Cancel</Link></Button>
      </div>
    </form>
  );
}

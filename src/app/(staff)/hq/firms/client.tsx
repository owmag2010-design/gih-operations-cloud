"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Panel, PanelHeader } from "@/components/ui/primitives";
import { createFirmAction, joinFirmAction } from "../actions";

export function JoinFirmButton({ firmId, name }: { firmId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => {
      if (!confirm(`Join ${name} as Firm Administrator? You'll see all of its records. This is recorded in the firm's audit log.`)) return;
      start(async () => { const r = await joinFirmAction(firmId); if (r.ok) toast.success(r.message); else toast.error(r.error); });
    }}>Join as administrator</Button>
  );
}

export function CreateFirmForm() {
  const [state, action] = useActionState(createFirmAction, null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <Panel>
        <PanelHeader title="Firm" description="You become its first Firm Administrator and can invite its team afterwards." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Legal name" name="legalName" error={err("legalName")}><Input required placeholder="e.g. Example Migration (Pty) Ltd" /></Field>
          <Field label="Trading name" name="tradingName" error={err("tradingName")}><Input required /></Field>
          <Field label="Short name for links" name="slug" hint="Lowercase letters and hyphens, e.g. example-migration." error={err("slug")}><Input required pattern="[a-z][a-z0-9-]{1,30}" /></Field>
          <Field label="Reference prefix" name="refPrefix" hint="2–4 letters used on lead and client references." error={err("refPrefix")}><Input required maxLength={4} className="uppercase" /></Field>
          <Field label="Brand colour" name="brandColor" error={err("brandColor")}><Input defaultValue="#3d3a36" pattern="#[0-9a-fA-F]{6}" required /></Field>
          <Field label="Jurisdictions" name="jurisdictions" hint="Country codes, e.g. ZA, ZW." error={err("jurisdictions")}><Input /></Field>
          <Field label="Contact email" name="contactEmail" error={err("contactEmail")}><Input type="email" /></Field>
          <Field label="Website" name="website" error={err("website")}><Input type="url" placeholder="https://" /></Field>
        </div>
      </Panel>
      <div><SubmitButton pendingText="Creating…">Create firm</SubmitButton></div>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { CountrySelect } from "@/components/country-select";
import { createMatterAction } from "../actions";

type Options = {
  clients: { id: string; ref: string; firstName: string; lastName: string | null }[];
  services: { id: string; name: string; code: string }[];
  team: { id: string; name: string }[];
  proposals: { id: string; ref: string; title: string; clientId: string | null }[];
};

export function MatterForm({ slug, options, meId, defaults }: { slug: string; options: Options; meId: string; defaults: { clientId?: string; proposalId?: string } }) {
  const [state, action] = useActionState(createMatterAction.bind(null, slug), null);
  const initialProposal = options.proposals.find((p) => p.id === defaults.proposalId);
  const [clientId, setClientId] = useState(initialProposal?.clientId ?? defaults.clientId ?? "");
  const [title, setTitle] = useState(initialProposal?.title ?? "");
  const proposals = options.proposals.filter((p) => p.clientId === clientId);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ActionFeedback state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Client" name="clientId" idPrefix="m" error={fieldError(state, "clientId")}>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Choose a client</option>
            {options.clients.map((c) => <option key={c.id} value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(" ")} ({c.ref})</option>)}
          </Select>
        </Field>
        <Field label="Accepted proposal" name="proposalId" idPrefix="m" hint={proposals.length ? "Links the matter to the fees the client accepted." : "No accepted proposal for this client that hasn't already opened a matter."} error={fieldError(state, "proposalId")}>
          <Select defaultValue={initialProposal?.id ?? ""} key={clientId} disabled={!proposals.length} onChange={(e) => { const p = proposals.find((x) => x.id === e.target.value); if (p && !title) setTitle(p.title); }}>
            <option value="">None</option>
            {proposals.map((p) => <option key={p.id} value={p.id}>{p.ref}: {p.title}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Matter title" name="title" idPrefix="m" hint="Short and specific, e.g. “Spouse visa: Thandi and Peter”." error={fieldError(state, "title")}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Service" name="serviceId" idPrefix="m" hint="Sets the stages and task templates." error={fieldError(state, "serviceId")}>
          <Select defaultValue="">
            <option value="">Not linked to a service</option>
            {options.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Legal category" name="legalCategory" idPrefix="m" hint="Defaults to the service's category." error={fieldError(state, "legalCategory")}>
          <Input maxLength={120} placeholder="e.g. Temporary residence" />
        </Field>
        <Field label="Jurisdiction" name="jurisdiction" idPrefix="m" error={fieldError(state, "jurisdiction")}>
          <CountrySelect defaultValue="" placeholder="Service default" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Case manager" name="caseManagerId" idPrefix="m" error={fieldError(state, "caseManagerId")}>
          <Select defaultValue={meId}>
            {options.team.map((u) => <option key={u.id} value={u.id}>{u.id === meId ? `${u.name} (me)` : u.name}</option>)}
          </Select>
        </Field>
        <Field label="Consultant" name="consultantId" idPrefix="m" hint="Defaults to the client's consultant." error={fieldError(state, "consultantId")}>
          <Select defaultValue="">
            <option value="">Client&apos;s consultant</option>
            {options.team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
      </div>
      <Checkbox name="restricted" label={<><span className="font-medium text-ink">Restricted matter.</span> Only the case manager, consultant, people added to the team and practice administrators can see it.</>} />
      <div><SubmitButton pendingText="Opening…">Open matter</SubmitButton></div>
    </form>
  );
}

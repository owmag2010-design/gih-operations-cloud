"use client";

import { Copy } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Notice, Select } from "@/components/ui/primitives";
import { endSessionsAction, inviteStaffAction, revokeStaffInvitationAction, setGroupRoleAction, setUserActiveAction } from "../actions";

type Opt = { id: string; name: string };
const notify = (r: { ok: boolean; message?: string; error?: string }): void => {
  if (r.ok) toast.success(r.message ?? "Done.");
  else toast.error(r.error);
};

export function InviteStaffDialog({ groupRoles, firmRoles, firms }: { groupRoles: Opt[]; firmRoles: Opt[]; firms: Opt[] }) {
  const [state, action] = useActionState(inviteStaffAction, null);
  const [scope, setScope] = useState<"firm" | "group">(firmRoles.length ? "firm" : "group");
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="primary">Invite someone</Button></DialogTrigger>
      <DialogContent title="Invite a staff member" description="They choose their own password from the link.">
        {state?.ok && state.data ? (
          <div className="flex flex-col gap-3">
            {state.data.emailStatus === "sent" ? <Notice tone="ok">Invitation emailed.</Notice> : <Notice tone="warn">Email sending isn&apos;t set up yet, so nothing was emailed. Send this one-time link to the person yourself. It expires in 7 days.</Notice>}
            <div className="flex gap-2">
              <Input readOnly value={state.data.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="num text-xs" />
              <Button onClick={() => { void navigator.clipboard.writeText(state.data!.link); toast.success("Link copied."); }}><Copy /> Copy</Button>
            </div>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <ActionFeedback state={state} />
            <Field label="Name" name="name" error={fieldError(state, "name")}><Input required /></Field>
            <Field label="Work email" name="email" error={fieldError(state, "email")}><Input type="email" required /></Field>
            {firmRoles.length && groupRoles.length ? (
              <fieldset className="flex gap-4 text-[13px]">
                <legend className="mb-1 text-[13px] font-medium text-ink-2">Access to</legend>
                <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "firm"} onChange={() => setScope("firm")} className="accent-[var(--accent)]" /> A firm</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "group"} onChange={() => setScope("group")} className="accent-[var(--accent)]" /> Hub headquarters</label>
              </fieldset>
            ) : null}
            {scope === "firm" ? (
              <>
                <Field label="Firm" name="firmId" error={fieldError(state, "firmId")}><Select required>{firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
                <Field label="Role in the firm" name="roleId"><Select defaultValue={firmRoles.find((r) => r.name === "Immigration Consultant")?.id}>{firmRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
              </>
            ) : (
              <Field label="Group role" name="roleId" hint="Group roles don't give access to any firm's client records."><Select>{groupRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            )}
            <div><SubmitButton pendingText="Inviting…">Create invitation</SubmitButton></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function GroupRoleSelect({ userId, roleId, roles }: { userId: string; roleId: string | null; roles: Opt[] }) {
  const [pending, start] = useTransition();
  return (
    <label><span className="sr-only">Group role</span>
      <Select defaultValue={roleId ?? ""} disabled={pending} className="h-8 w-auto text-[13px]" onChange={(e) => { const v = e.target.value; start(async () => notify(await setGroupRoleAction(userId, v || null))); }}>
        <option value="">None</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
    </label>
  );
}

export function PersonActions({ userId, name, active }: { userId: string; name: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex gap-1">
      {active ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => notify(await endSessionsAction(userId)))}>Sign out everywhere</Button> : null}
      <Button size="sm" variant={active ? "danger" : "secondary"} disabled={pending} onClick={() => {
        if (active && !confirm(`Deactivate ${name}? They are signed out immediately and can't sign in again until reactivated.`)) return;
        start(async () => notify(await setUserActiveAction(userId, !active)));
      }}>{active ? "Deactivate" : "Reactivate"}</Button>
    </span>
  );
}

export function RevokeStaffInvite({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => notify(await revokeStaffInvitationAction(id)))}>Cancel invitation</Button>;
}

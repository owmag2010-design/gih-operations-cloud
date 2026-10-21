"use client";

import { Copy } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Notice, Select } from "@/components/ui/primitives";
import { changeRoleAction, inviteToFirmAction, removeMemberAction, revokeInvitationAction } from "../actions";

export function InviteDialog({ firmSlug, roles }: { firmSlug: string; roles: { id: string; name: string; description: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(inviteToFirmAction.bind(null, firmSlug), null);
  const [roleId, setRoleId] = useState(roles.find((r) => r.name === "Immigration Consultant")?.id ?? roles[0]?.id);
  const role = roles.find((r) => r.id === roleId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="primary">Invite someone</Button></DialogTrigger>
      <DialogContent title="Invite to this firm" description="They set their own password from the link. Nobody else sees it.">
        {state?.ok && state.data ? (
          <div className="flex flex-col gap-3">
            {state.data.emailStatus === "sent" ? (
              <Notice tone="ok">Invitation emailed.</Notice>
            ) : (
              <Notice tone="warn">Email sending isn&apos;t set up yet, so nothing was emailed. Send this link to the person yourself, through a channel you trust. It works once and expires in 7 days.</Notice>
            )}
            <div className="flex gap-2">
              <Input readOnly value={state.data.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="num text-xs" />
              <Button onClick={() => { void navigator.clipboard.writeText(state.data!.link); toast.success("Link copied."); }}><Copy /> Copy</Button>
            </div>
            <Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <ActionFeedback state={state} />
            <Field label="Name" name="name" error={fieldError(state, "name")}><Input required /></Field>
            <Field label="Work email" name="email" error={fieldError(state, "email")}><Input type="email" required /></Field>
            <Field label="Role" name="roleId" hint={role?.description} error={fieldError(state, "roleId")}>
              <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            </Field>
            <div><SubmitButton pendingText="Inviting…">Create invitation</SubmitButton></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RoleSelect({ firmSlug, membershipId, roleId, roles, currentName }: { firmSlug: string; membershipId: string; roleId: string; roles: { id: string; name: string }[]; currentName: string }) {
  const [pending, start] = useTransition();
  const known = roles.some((r) => r.id === roleId);
  return (
    <label>
      <span className="sr-only">Role</span>
      <Select
        defaultValue={roleId}
        disabled={pending || !known}
        className="h-8 w-auto text-[13px]"
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            const r = await changeRoleAction(firmSlug, membershipId, v);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          });
        }}
      >
        {!known ? <option value={roleId}>{currentName}</option> : null}
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
    </label>
  );
}

export function RemoveMember({ firmSlug, membershipId, name }: { firmSlug: string; membershipId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove ${name} from this firm? They lose access to its records immediately.`)) return;
        start(async () => {
          const r = await removeMemberAction(firmSlug, membershipId);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      Remove
    </Button>
  );
}


export function RevokeInvite({ firmSlug, invitationId }: { firmSlug: string; invitationId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await revokeInvitationAction(firmSlug, invitationId); if (r.ok) toast.success(r.message); else toast.error(r.error); })}>
      Cancel invitation
    </Button>
  );
}

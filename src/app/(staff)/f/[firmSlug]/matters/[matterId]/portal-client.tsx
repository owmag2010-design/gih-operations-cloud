"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import {
  addChecklistAction, checklistStatusAction, closePortalAction, enablePortalAction, portalDriveFolderAction, portalMessageAction, removeChecklistAction,
  resendPortalInviteAction, retryDriveAction,
} from "../actions";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
      } else toast.error(r.error);
    });
  return { pending, run };
}

export function OpenPortalDialog({ slug, matterId, email, replace }: { slug: string; matterId: string; email: string; replace?: boolean }) {
  return (
    <FormDialog
      trigger={replace ? "Replace link" : "Open client portal"}
      triggerVariant={replace ? "ghost" : "primary"}
      triggerSize="sm"
      title={replace ? "Replace the portal link" : "Open the client portal"}
      description={replace ? "The current link and any signed-in sessions stop working at once." : "The client gets a private link and signs in with a code emailed to this address."}
      action={enablePortalAction.bind(null, slug, matterId)}
      submit={replace ? "Replace link" : "Open portal"}
    >
      {(state) => (
        <>
          <Field label="Client email" name="email" error={fieldError(state, "email")} idPrefix="portal">
            <Input type="email" defaultValue={email} required />
          </Field>
          <Field label="Google Drive folder (optional)" name="driveFolder" hint="Paste the link to the client's folder. Uploads are saved there as well as on this matter." error={fieldError(state, "driveFolder")} idPrefix="portal">
            <Input placeholder="https://drive.google.com/drive/folders/…" />
          </Field>
          <Checkbox name="sendInvite" defaultChecked label="Email the client their invitation now" />
        </>
      )}
    </FormDialog>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input readOnly value={link} aria-label="Portal link" className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          } catch {
            toast.error("Select the link and copy it.");
          }
        }}
      >
        {done ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

export function PortalButtons({ slug, matterId }: { slug: string; matterId: string }) {
  const { pending, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => resendPortalInviteAction(slug, matterId))}>Email the link again</Button>
      {confirm ? (
        <>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => closePortalAction(slug, matterId))}>Yes, close the portal</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep it open</Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Close portal</Button>
      )}
    </div>
  );
}

export function DriveFolderForm({ slug, matterId, current }: { slug: string; matterId: string; current: string | null }) {
  const [state, action] = useActionState(portalDriveFolderAction.bind(null, slug, matterId), null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Google Drive folder" name="driveFolder" error={fieldError(state, "driveFolder")} className="min-w-0 flex-1" idPrefix="drive">
          <Input defaultValue={current ? `https://drive.google.com/drive/folders/${current}` : ""} placeholder="https://drive.google.com/drive/folders/…" />
        </Field>
        <SubmitButton size="sm" variant="secondary">Save folder</SubmitButton>
      </div>
    </form>
  );
}

export function AddChecklistDialog({ slug, matterId }: { slug: string; matterId: string }) {
  return (
    <FormDialog trigger="Add documents" triggerSize="sm" title="Add to the client's checklist" description="One document per line. Start a line with a group and a colon to group it, e.g. “Identity: Passport copy”." action={addChecklistAction.bind(null, slug, matterId)} submit="Add">
      {(state) => (
        <Field label="Documents" name="labels" error={fieldError(state, "labels")} idPrefix="checklist">
          <Textarea rows={8} placeholder={"Identity: Passport copy (certified)\nRelationship: Marriage certificate\nRelationship: Joint bank statements, 3 months\nClearances: Police clearance certificate"} />
        </Field>
      )}
    </FormDialog>
  );
}

export function ChecklistStatus({ slug, matterId, itemId, status }: { slug: string; matterId: string; itemId: string; status: string }) {
  const { pending, run } = useRun();
  return (
    <span className="flex items-center gap-1.5">
      <Select aria-label="Status" value={status} disabled={pending} className="h-7 w-auto py-0 text-xs" onChange={(e) => run(() => checklistStatusAction(slug, matterId, itemId, e.target.value))}>
        <option value="needed">Needed</option>
        <option value="uploaded">Received</option>
        <option value="accepted">Accepted</option>
        <option value="waived">Not needed</option>
      </Select>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="Remove" onClick={() => run(() => removeChecklistAction(slug, matterId, itemId))}>Remove</Button>
    </span>
  );
}

export function RetryDrive({ slug, matterId, uploadId }: { slug: string; matterId: string; uploadId: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => retryDriveAction(slug, matterId, uploadId))}>Try Drive again</Button>;
}

export function StaffComposer({ slug, matterId, portalOpen }: { slug: string; matterId: string; portalOpen: boolean }) {
  const [state, action] = useActionState(portalMessageAction.bind(null, slug, matterId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} />
      <Field label={portalOpen ? "Reply to the client" : "Internal note"} name="body" error={fieldError(state, "body")} idPrefix="pmsg">
        <Textarea rows={3} required maxLength={4000} placeholder={portalOpen ? "The client sees this in their portal and gets an email with a link." : "Only the team sees internal notes."} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {portalOpen ? <Checkbox name="internal" label="Internal note (the client never sees it)" /> : <input type="hidden" name="internal" value="on" />}
        <SubmitButton size="sm" pendingText="Sending…">{portalOpen ? "Send" : "Save note"}</SubmitButton>
      </div>
    </form>
  );
}

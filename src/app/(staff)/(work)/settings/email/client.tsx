"use client";

import { Loader2, Plug, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveMailboxAction } from "@/app/(staff)/email-actions";
import { disconnectAction, syncNowAction } from "@/app/(staff)/inbox-actions";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Checkbox, Field, Input, Select, buttonVariants, cn } from "@/components/ui/primitives";

export function ConnectButtons({ practices, microsoft, google }: { practices: { id: string; name: string }[]; microsoft: boolean; google: boolean }) {
  const [practice, setPractice] = useState(practices[0]?.id ?? "");
  if (!practices.length) return <p className="text-[13px] text-muted">You don&apos;t have permission to send email in any practice.</p>;
  const link = (p: "microsoft" | "google") => `/api/mail/oauth/${p}/start?practice=${encodeURIComponent(practice)}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-ink-2">Connect a mailbox for</span>
      <Select aria-label="Practice" value={practice} onChange={(e) => setPractice(e.target.value)} className="h-8 w-auto text-[13px]">
        {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      {microsoft ? <a href={link("microsoft")} className={buttonVariants({ variant: "primary", size: "sm" })}><Plug /> Microsoft 365 / Outlook</a> : <Button size="sm" disabled title="Not set up on the server yet"><Plug /> Microsoft 365 (not set up)</Button>}
      {google ? <a href={link("google")} className={buttonVariants({ variant: "secondary", size: "sm" })}><Plug /> Gmail / Google Workspace</a> : <Button size="sm" disabled title="Not set up on the server yet"><Plug /> Gmail (not set up)</Button>}
      {!microsoft || !google ? <span className="text-xs text-muted">A provider that isn&apos;t set up needs a one-time registration by an administrator (see Server connections).</span> : null}
    </div>
  );
}

export function MailboxActions({ mailboxId, provider, connected, canManage, microsoft, google }: { mailboxId: string; provider: string; connected: boolean; canManage: boolean; microsoft?: boolean; google?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done.");
      else toast.error(r.error ?? "Something went wrong.");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {provider !== "forwarding" && connected ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => syncNowAction(mailboxId))}>{pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now</Button> : null}
      {provider !== "forwarding" ? <a href={`/api/mail/oauth/${provider}/start?mailbox=${mailboxId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Plug /> Reconnect</a> : null}
      {provider === "forwarding" && canManage && microsoft ? <a href={`/api/mail/oauth/microsoft/start?mailbox=${mailboxId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><Plug /> Connect Microsoft 365</a> : null}
      {provider === "forwarding" && canManage && google ? <a href={`/api/mail/oauth/google/start?mailbox=${mailboxId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><Plug /> Connect Gmail</a> : null}
      {provider !== "forwarding" && canManage ? (
        <Button size="sm" variant="ghost" className={cn("text-danger")} disabled={pending} onClick={() => { if (window.confirm("Disconnect this mailbox? Imported conversations stay; nothing new will sync or send from it.")) run(() => disconnectAction(mailboxId)); }}><Unplug /> Disconnect</Button>
      ) : null}
    </div>
  );
}

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
      <Field idPrefix={p} label="Forwarding address (Resend)" name="inboundAddress" hint="Optional when the mailbox is connected to Microsoft 365 or Gmail." error={err("inboundAddress")}><Input type="email" defaultValue={box.inboundAddress} /></Field>
      <Field idPrefix={p} label="Real mailbox" name="forwardedFrom" hint="For reference, e.g. hello@thegih.com." error={err("forwardedFrom")}><Input defaultValue={box.forwardedFrom ?? ""} /></Field>
      <Field idPrefix={p} label="Sender name" name="fromName" error={err("fromName")}><Input defaultValue={box.fromName} required /></Field>
      <Field idPrefix={p} label="Send from" name="fromAddress" hint="For Resend: on a verified domain." error={err("fromAddress")}><Input type="email" defaultValue={box.fromAddress} required /></Field>
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <Checkbox name="isActive" defaultChecked={box.isActive} label="Active" />
        <SubmitButton size="sm">{box.id ? "Save inbox" : "Add inbox"}</SubmitButton>
      </div>
    </form>
  );
}

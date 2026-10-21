"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { ActionFeedback, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Notice, Select, Textarea } from "@/components/ui/primitives";
import { routeIntakeAction, setIntakeStatusAction } from "../../actions";

export function RouteForm({ itemId, firms, suggested }: { itemId: string; firms: { id: string; name: string }[]; suggested: string | null }) {
  const [state, action] = useActionState(routeIntakeAction.bind(null, itemId), null);
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionFeedback state={state} successToast={false} />
      <Field label="Firm" name="firmId" hint="Creates a lead in that firm. You won't be able to see it afterwards unless you belong to the firm.">
        <Select defaultValue={suggested ?? ""} required>
          <option value="" disabled>Choose a firm</option>
          {firms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.id === suggested ? " (suggested)" : ""}</option>)}
        </Select>
      </Field>
      <Field label="Note for the record (optional)" name="note"><Textarea rows={2} maxLength={1000} placeholder="Why this firm, or anything the team should know" /></Field>
      <div><SubmitButton pendingText="Routing…">Route enquiry</SubmitButton></div>
    </form>
  );
}

export function StatusButtons({ itemId, status }: { itemId: string; status: string }) {
  const [pending, start] = useTransition();
  const run = (s: "held" | "rejected" | "duplicate" | "new", ask?: string) => {
    const note = ask ? prompt(ask) ?? undefined : undefined;
    if (ask && note === undefined) return;
    start(async () => {
      const r = await setIntakeStatusAction(itemId, s, note);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  };
  if (status === "routed") return null;
  if (status === "rejected" || status === "duplicate") return <Button disabled={pending} onClick={() => run("new")}>Reopen</Button>;
  return (
    <>
      {status === "new" ? <Button disabled={pending} onClick={() => run("held", "Why is it on hold? (shown on the record)")}>Hold for review</Button> : null}
      <Button disabled={pending} onClick={() => run("duplicate", "Which earlier enquiry does it duplicate? (optional)")}>Mark duplicate</Button>
      <Button variant="danger" disabled={pending} onClick={() => run("rejected", "Why close it? For example: spam, out of scope, consultation offered.")}>Close</Button>
    </>
  );
}

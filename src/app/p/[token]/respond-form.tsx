"use client";

import { useActionState, useState } from "react";
import { Button, Checkbox, Field, Input, Notice, Textarea } from "@/components/ui/primitives";
import { respondAction } from "./actions";

export function RespondForm({ token, accent }: { token: string; accent: string }) {
  const [state, action, pending] = useActionState(respondAction.bind(null, token), null);
  const [decision, setDecision] = useState<"accept" | "decline">("accept");
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-4">
      {state && !state.ok ? <Notice tone="danger">{state.message}</Notice> : null}
      <div className="flex gap-2" role="radiogroup" aria-label="Your decision">
        {(["accept", "decline"] as const).map((d) => (
          <label key={d} className={`flex-1 cursor-pointer rounded-md border px-3 py-2.5 text-center text-sm ${decision === d ? "border-ink bg-white font-medium text-ink" : "border-hairline-strong text-ink-2"}`}>
            <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="sr-only" />
            {d === "accept" ? "Accept the proposal" : "Decline"}
          </label>
        ))}
      </div>
      <Field label="Your full name" name="name" hint="This records your decision."><Input required minLength={2} maxLength={120} autoComplete="name" /></Field>
      {decision === "accept" ? (
        <Checkbox name="agree" label="I accept the scope of work and fees in this proposal." />
      ) : (
        <Field label="Anything you'd like us to know? (optional)" name="note"><Textarea rows={3} maxLength={1000} /></Field>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={pending} style={decision === "accept" ? { background: accent, borderColor: accent } : undefined}>
          {pending ? "Recording…" : decision === "accept" ? "Accept proposal" : "Decline proposal"}
        </Button>
      </div>
    </form>
  );
}

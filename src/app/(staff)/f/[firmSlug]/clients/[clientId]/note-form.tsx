"use client";

import { useActionState, useEffect, useRef } from "react";
import { ActionFeedback, SubmitButton } from "@/components/ui/forms";
import { Textarea } from "@/components/ui/primitives";
import { addClientNoteAction } from "../../actions";

export function ClientNoteForm({ firmSlug, clientId }: { firmSlug: string; clientId: string }) {
  const [state, action] = useActionState(addClientNoteAction.bind(null, firmSlug, clientId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <ActionFeedback state={state} />
      <label htmlFor="client-note" className="sr-only">Add an internal note</label>
      <Textarea id="client-note" name="body" rows={3} placeholder="Add an internal note" required maxLength={5000} />
      <div><SubmitButton size="sm" pendingText="Adding…">Add note</SubmitButton></div>
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/server/errors";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { ActionFeedback, SubmitButton } from "./forms";
import { Button, type ButtonProps } from "./primitives";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

/** A button that opens a dialog with one form; the dialog closes once per successful submission. */
export function FormDialog({ trigger, triggerVariant = "secondary", triggerSize, title, description, action, submit, submitVariant, pendingText, children, wide }: {
  trigger: React.ReactNode; triggerVariant?: ButtonProps["variant"]; triggerSize?: ButtonProps["size"]; title: string; description?: string; action: Action; submit: string;
  submitVariant?: ButtonProps["variant"]; pendingText?: string; children: (state: ActionResult | null) => React.ReactNode; wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  const handled = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      setOpen(false);
    }
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={triggerVariant} size={triggerSize}>{trigger}</Button></DialogTrigger>
      <DialogContent title={title} description={description} wide={wide}>
        <form action={formAction} className="flex flex-col gap-4">
          <ActionFeedback state={state} />
          {children(state)}
          <div className="flex justify-end"><SubmitButton variant={submitVariant ?? (triggerVariant === "danger" ? "danger" : "primary")} pendingText={pendingText}>{submit}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";
import { Button, Input, Notice, type ButtonProps } from "./primitives";

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

/** Results already toasted, so a form that remounts (e.g. a reopened dialog) doesn't toast again. */
const toasted = new WeakSet<object>();

/** Shows an action's error, or toasts its success message once. */
export function ActionFeedback({ state, successToast = true }: { state: ActionResult<unknown> | null; successToast?: boolean }) {
  useEffect(() => {
    if (state && state.ok && state.message && successToast && !toasted.has(state)) {
      toasted.add(state);
      toast.success(state.message);
    }
  }, [state, successToast]);
  if (!state || state.ok) return null;
  return <Notice tone="danger">{state.error}</Notice>;
}

export const fieldError = (state: ActionResult<unknown> | null, name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined);

/**
 * A local date-and-time picker that submits an ISO timestamp with the user's
 * own offset, so follow-ups land at the time the person meant.
 */
export function DateTimeInput({ name, defaultValue, id, ...rest }: { name?: string; defaultValue?: Date | string | null; id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  const initial = defaultValue ? toLocalInput(new Date(defaultValue)) : "";
  const [local, setLocal] = useState(initial);
  const iso = local ? new Date(local).toISOString() : "";
  return (
    <>
      <Input id={id} type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} {...rest} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Renders a timestamp in the viewer's own time zone. */
const noopSubscribe = () => () => {};

export function LocalTime({ value, mode = "datetime" }: { value: Date | string | null | undefined; mode?: "datetime" | "date" | "relative" }) {
  // Format only in the browser so times show in the viewer's own time zone.
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!value) return <span className="text-muted">—</span>;
  const d = new Date(value);
  const text = !isClient
    ? ""
    : mode === "relative"
      ? relative(d)
      : d.toLocaleString("en-ZA", mode === "date" ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <time dateTime={new Date(value).toISOString()} suppressHydrationWarning className="num">
      {text || new Date(value).toISOString().slice(0, 10)}
    </time>
  );
}

function relative(d: Date) {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import * as React from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ───────── Button ───────── */

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-hover",
        secondary: "border border-hairline-strong bg-surface text-ink hover:bg-sunken",
        ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
        danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
      },
      size: { sm: "h-7 px-2.5 text-[13px]", md: "h-9 px-3.5 text-sm", icon: "size-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

/* ───────── Form controls ───────── */

const control =
  "w-full rounded-md border border-hairline-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/80 transition-colors hover:border-ink-2/40 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 disabled:bg-sunken aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, "h-9", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(control, "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236e685f%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_10px_center] bg-no-repeat pr-8", className)} {...props} />
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-ink-2", className)} {...props} />;
}

/** Label, control, hint and error, wired for screen readers. */
export function Field({ label, name, hint, error, children, className, idPrefix }: { label: string; name: string; hint?: string; error?: string; children: React.ReactElement<Record<string, unknown>>; className?: string; idPrefix?: string }) {
  const id = `${idPrefix ?? "f"}-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, { id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2 text-sm text-ink-2", className)}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-hairline-strong accent-[var(--accent)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

/* ───────── Display ───────── */

const badgeTones = {
  neutral: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  outline: "border border-hairline-strong text-ink-2",
} as const;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn("inline-flex h-5 items-center gap-1 rounded px-1.5 text-xs font-medium whitespace-nowrap", badgeTones[tone], className)} {...props} />;
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-lg border border-hairline bg-surface", className)} {...props} />;
}

export function PanelHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, meta }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-[70ch] text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-5 py-10">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <div className="max-w-[60ch] text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "neutral", children, className }: { tone?: "neutral" | "warn" | "danger" | "ok"; children: React.ReactNode; className?: string }) {
  const tones = { neutral: "border-hairline bg-sunken text-ink-2", warn: "border-warn/25 bg-warn-soft text-warn", danger: "border-danger/25 bg-danger-soft text-danger", ok: "border-ok/25 bg-ok-soft text-ok" };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-[13px]", tones[tone], className)}>{children}</div>;
}

/** Definition list used on record pages. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,40%)_1fr] gap-x-4 gap-y-2.5 text-[13px]">
      {items.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v || <span className="text-muted/70">Not recorded</span>}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export const tableClass = {
  wrap: "overflow-x-auto",
  table: "w-full border-collapse text-[13px]",
  th: "h-9 border-b border-hairline bg-sunken/60 px-3 text-left text-xs font-medium whitespace-nowrap text-muted",
  td: "h-11 border-b border-hairline px-3 align-middle text-ink",
  row: "hover:bg-sunken/50",
};

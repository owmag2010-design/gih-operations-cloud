"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button, Notice } from "@/components/ui/primitives";
import { Composer } from "./composer";
import { EmailFrame } from "./frame";

export { EmailFrame };

/** "Email" button on a lead or client: compose from one of the practice's mailboxes. */
export function ComposeDialog({ firmId, target, to, disabled }: { firmId: string; target: { leadId?: string; clientId?: string }; to: string | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled || !to} title={to ? undefined : "Add an email address first"}><Mail /> Email</Button>
      </DialogTrigger>
      <DialogContent title="New email" description="Logged on this record's timeline. Replies come back to the inbox." wide className="max-w-3xl">
        {open ? (
          <Composer
            initial={{ practice: firmId, to: to ? [to] : [], leadId: target.leadId ?? null, clientId: target.clientId ?? null, mode: "new" }}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** A received or sent message: plain text first (safer), formatted on request. */
export function MessageBody({ text, html, id, preferFormatted = false }: { text: string | null; html: string | null; id: string; preferFormatted?: boolean }) {
  const [formatted, setFormatted] = useState(preferFormatted && Boolean(html));
  return (
    <div>
      {formatted && html ? (
        <EmailFrame html={html} title={`Message ${id}`} height={480} allowSameSiteImages={preferFormatted} />
      ) : (
        <p className="max-w-[78ch] text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{text?.trim() || "(No plain-text version. Show the formatted email.)"}</p>
      )}
      {html ? (
        <button type="button" onClick={() => setFormatted((v) => !v)} className="mt-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          {formatted ? "Show plain text" : "Show formatted email"}
        </button>
      ) : null}
    </div>
  );
}

export function NotConnectedNotice() {
  return <Notice tone="warn">Email sending isn&apos;t connected on this server yet. Messages are saved but not delivered until a Resend key is added.</Notice>;
}

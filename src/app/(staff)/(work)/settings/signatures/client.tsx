"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { previewSignatureAction, saveSignatureAction } from "@/app/(staff)/inbox-actions";
import { EmailFrame } from "@/components/email/frame";
import { Button, Checkbox, Input, Textarea } from "@/components/ui/primitives";

type Sig = { fullName: string; role: string; phone: string; email: string; website: string; bookingUrl: string; disclaimer: string; showLogo: boolean };

export function SignatureEditor({ practice, which, title, initial }: { practice: string; which: "mine" | "practice"; title: string; initial: Sig }) {
  const [sig, setSig] = useState(initial);
  const [html, setHtml] = useState<string | null>(null);
  const [saving, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await previewSignatureAction(practice, sig);
      if (r.ok && r.data) setHtml(r.data.html);
    }, 300);
    return () => clearTimeout(t);
  }, [sig, practice]);
  const field = (k: keyof Sig, label: string, placeholder = "") => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <Input value={String(sig[k])} placeholder={placeholder} onChange={(e) => setSig((s) => ({ ...s, [k]: e.target.value }))} />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("fullName", which === "mine" ? "Your name" : "Name (optional)", which === "mine" ? "" : "Leave blank: each sender's name is used")}
        {field("role", "Role", "e.g. Founder & Principal")}
        {field("phone", "Phone", "+27 12 140 0194")}
        {field("email", "Email", "hello@thegih.com")}
        {field("website", "Website", "https://thegih.com")}
        {field("bookingUrl", "Booking link", "https://…")}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Disclaimer (optional)</span>
        <Textarea rows={2} value={sig.disclaimer} onChange={(e) => setSig((s) => ({ ...s, disclaimer: e.target.value }))} placeholder="Confidentiality notice, registration details…" />
      </label>
      <Checkbox checked={sig.showLogo} onChange={(e) => setSig((s) => ({ ...s, showLogo: e.currentTarget.checked }))} label="Show the logo" />
      <div>
        <p className="mb-1 text-xs text-muted">Preview</p>
        {html ? <EmailFrame html={`<!doctype html><html><head></head><body style="margin:0;padding:8px 16px;background:#fff">${html}</body></html>`} title={`${title} preview`} height={230} allowSameSiteImages /> : null}
      </div>
      <div>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => start(async () => {
          const r = await saveSignatureAction(practice, which, sig);
          if (r.ok) toast.success(r.message ?? "Saved.");
          else toast.error(r.error);
        })}>{saving ? "Saving…" : "Save signature"}</Button>
      </div>
    </div>
  );
}

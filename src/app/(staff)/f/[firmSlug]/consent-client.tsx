"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { fieldError } from "@/components/ui/forms";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { recordClientConsentAction, setAiDraftingAction } from "./actions";

export function ClientConsentDialog({ slug, clientId, purposes }: { slug: string; clientId: string; purposes: [string, string][] }) {
  return (
    <FormDialog trigger="Record consent" triggerSize="sm" title="Record consent" description="Keep a record of what the client agreed to (or declined), and how. The latest record for each purpose applies." action={recordClientConsentAction.bind(null, slug, clientId)} submit="Record">
      {(s) => (
        <>
          <Field label="Purpose" name="purpose" idPrefix="cc" error={fieldError(s, "purpose")}>
            <Select defaultValue="ai_assistance">{purposes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <Field label="Decision" name="granted" idPrefix="cc" error={fieldError(s, "granted")}>
            <Select defaultValue="yes"><option value="yes">Consent given</option><option value="no">Declined or withdrawn</option></Select>
          </Field>
          <Field label="How it was given" name="method" idPrefix="cc" hint="e.g. Signed engagement letter clause 9, 24 Oct 2026" error={fieldError(s, "method")}><Input required maxLength={120} /></Field>
          <Field label="Evidence (optional)" name="evidence" idPrefix="cc" hint="Where the signed copy or email is kept." error={fieldError(s, "evidence")}><Input maxLength={500} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function AiDraftingToggle({ slug, enabled }: { slug: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={enabled ? "secondary" : "primary"}
      disabled={pending}
      onClick={() => start(async () => { const r = await setAiDraftingAction(slug, !enabled); if (r.ok) toast.success(r.message); else toast.error(r.error); })}
    >
      {pending ? "Saving…" : enabled ? "Switch off AI drafting" : "Switch on AI drafting"}
    </Button>
  );
}

"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/server/errors";
import { CountrySelect } from "@/components/country-select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Checkbox, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";
import { countryName } from "@/lib/countries";
import { FLAG_LABELS } from "@/lib/labels";
import { moveRuleAction, previewRoutingAction, saveRuleAction } from "../actions";

type Rule = { id: string; name: string; action: string; targetFirmId: string | null; flag: string | null; isActive: boolean; keywords: string[]; currentCountries: string[]; destinations: string[] };
type Firm = { id: string; name: string };

export function RulesEditor({ rules, firms, canManage }: { rules: Rule[]; firms: Firm[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const firmName = (id: string | null) => firms.find((f) => f.id === id)?.name;
  return (
    <div>
      <ol className="divide-y divide-hairline">
        {rules.map((r, i) => {
          const conditions = [
            r.keywords.length ? `mentions ${r.keywords.slice(0, 6).map((k) => `“${k}”`).join(", ")}${r.keywords.length > 6 ? ` and ${r.keywords.length - 6} more` : ""}` : null,
            r.currentCountries.length ? `lives in ${r.currentCountries.map(countryName).join(" or ")}` : null,
            r.destinations.length ? `going to ${r.destinations.map(countryName).join(" or ")}` : null,
          ].filter(Boolean);
          return (
            <li key={r.id} className={`flex gap-3 px-4 py-3 ${r.isActive ? "" : "opacity-55"}`}>
              <span className="num w-5 pt-0.5 text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="font-medium text-ink">{r.name}{r.isActive ? null : <Badge tone="outline" className="ml-2">Off</Badge>}</p>
                <p className="mt-0.5 text-ink-2">
                  {conditions.length ? `When the enquiry ${conditions.join(" and ")}` : "Any enquiry not matched above"}
                  {", "}
                  {r.action === "route" ? <>suggest <span className="font-medium text-ink">{firmName(r.targetFirmId)}</span></> : r.action === "consult" ? "hold it and offer a consultation" : "hold it for a person"}
                  {r.flag ? <>, flagged <Badge tone="accent">{FLAG_LABELS[r.flag] ?? r.flag}</Badge></> : null}.
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-start">
                  <Button size="icon" variant="ghost" aria-label="Move up" disabled={pending || i === 0} onClick={() => start(async () => { await moveRuleAction(r.id, "up"); })}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" disabled={pending || i === rules.length - 1} onClick={() => start(async () => { await moveRuleAction(r.id, "down"); })}><ArrowDown /></Button>
                  <RuleDialog rule={r} firms={firms} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {canManage ? <div className="border-t border-hairline p-4"><RuleDialog firms={firms} /></div> : null}
    </div>
  );
}

function RuleDialog({ rule, firms }: { rule?: Rule; firms: Firm[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await saveRuleAction(rule?.id ?? null, prev, form);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  const [act, setAct] = useState(rule?.action ?? "route");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{rule ? <Button size="sm" variant="ghost">Edit</Button> : <Button>Add a rule</Button>}</DialogTrigger>
      <DialogContent title={rule ? "Edit rule" : "Add a rule"} description="All filled-in conditions must match. Leave one empty to ignore it." wide>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
          <Field label="Name" name="name" className="sm:col-span-2" error={fieldError(state, "name")}><Input defaultValue={rule?.name} required placeholder="e.g. Study visas to Veritas Emigrate" /></Field>
          <Field label="Words or phrases in the enquiry" name="keywords" className="sm:col-span-2" hint="Separate with commas. Whole words only, so “ban” won't match “bank”." error={fieldError(state, "keywords")}>
            <Textarea rows={2} defaultValue={rule?.keywords.join(", ")} />
          </Field>
          <Field label="Lives in (country codes)" name="currentCountries" hint="e.g. ZW, MZ"><Input defaultValue={rule?.currentCountries.join(", ")} /></Field>
          <Field label="Going to (country codes)" name="destinations" hint="e.g. AU"><Input defaultValue={rule?.destinations.join(", ")} /></Field>
          <Field label="Then" name="action">
            <Select value={act} onChange={(e) => setAct(e.target.value)}>
              <option value="route">Suggest a firm</option>
              <option value="hold">Hold for a person</option>
              <option value="consult">Hold and offer a consultation</option>
            </Select>
          </Field>
          <Field label="Firm" name="targetFirmId" error={fieldError(state, "targetFirmId")}>
            <Select defaultValue={rule?.targetFirmId ?? ""} disabled={act !== "route"}>
              <option value="">None</option>
              {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Flag (optional)" name="flag" hint="Shown on matching enquiries.">
            <Select defaultValue={rule?.flag ?? ""}>
              <option value="">No flag</option>
              {Object.entries(FLAG_LABELS).filter(([k]) => !["possible_duplicate", "needs_information"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <div className="flex items-end"><Checkbox name="isActive" defaultChecked={rule?.isActive ?? true} label="Rule is on" /></div>
          <div className="sm:col-span-2"><SubmitButton>{rule ? "Save rule" : "Add rule"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RulePreview({ firms }: { firms: Firm[] }) {
  const [state, action] = useActionState(previewRoutingAction, null);
  const firmName = (id: string | null) => firms.find((f) => f.id === id)?.name;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Enquiry text" name="enquiry"><Textarea rows={3} required placeholder="I overstayed my visa and was banned…" /></Field>
      <Field label="Lives in" name="currentCountry"><CountrySelect /></Field>
      <Field label="Going to" name="destinationCountry"><CountrySelect /></Field>
      <div><SubmitButton variant="secondary" pendingText="Checking…">Check</SubmitButton></div>
      {state && "decision" in state ? (
        <Notice tone={state.decision.action === "route" ? "ok" : "warn"}>
          {state.decision.action === "route" ? `Suggests ${firmName(state.decision.firmId)}` : state.decision.action === "consult" ? "Held: offer a consultation" : "Held for a person"}
          {". "}{state.decision.reason}.
          {state.decision.flags.length ? ` Flags: ${state.decision.flags.map((f) => FLAG_LABELS[f] ?? f).join(", ")}.` : ""}
        </Notice>
      ) : state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
    </form>
  );
}

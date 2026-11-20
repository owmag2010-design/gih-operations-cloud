"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { CountrySelect } from "@/components/country-select";
import { ActionFeedback, fieldError, LocalTime, SubmitButton } from "@/components/ui/forms";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { CURRENCIES } from "@/lib/countries";
import { SOURCE_KINDS as KINDS } from "@/lib/country-status";
import type { ActionResult } from "@/server/errors";
import {
  addHolidayAction, calendarStatusAction, countryStepAction, createCalendarAction, createCountryAction, removeHolidayAction, saveSourceAction,
  setCapabilityAction, setRegisteredCountryAction, sourceStatusAction, updateCountryAction,
} from "./actions";

export type ProfileValues = {
  code: string; name: string; currency: string; dateFormat: string; phonePrefix: string; timezones: string; defaultTimezone: string;
  addressFormat: string; authorities: string; notes: string;
};

const DATE_FORMATS = [["dd/MM/yyyy", "21/11/2026"], ["d MMM yyyy", "21 Nov 2026"], ["yyyy/MM/dd", "2026/11/21"], ["yyyy-MM-dd", "2026-11-21"], ["MM/dd/yyyy", "11/21/2026"]] as const;

function useRun() {
  const [pending, start] = useTransition();
  const run = (p: Promise<ActionResult>) =>
    start(async () => {
      const r = await p;
      if (r.ok) toast.success(r.message ?? "Done.");
      else toast.error(r.error);
    });
  return { pending, run };
}

/* ───────── Profile ───────── */

export function ProfileForm({ initial, mode, canEdit, warnReopen }: { initial: ProfileValues; mode: "create" | "edit"; canEdit: boolean; warnReopen?: string }) {
  const action = mode === "create" ? createCountryAction : updateCountryAction.bind(null, initial.code);
  const [state, formAction] = useActionState(action, null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={formAction} className="grid gap-4 p-4">
      <ActionFeedback state={state} />
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <Field label="Country" name="code" error={err("code")}><CountrySelect name="code" required placeholder="Choose a country" /></Field>
        ) : null}
        <Field label="Name as shown" name="name" error={err("name")}><Input name="name" defaultValue={initial.name} required /></Field>
        <Field label="Currency" name="currency" error={err("currency")}>
          <Select name="currency" defaultValue={initial.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Date format" name="dateFormat" error={err("dateFormat")}>
          <Select name="dateFormat" defaultValue={initial.dateFormat}>{DATE_FORMATS.map(([f, ex]) => <option key={f} value={f}>{ex}</option>)}</Select>
        </Field>
        <Field label="Phone prefix" name="phonePrefix" hint="For example +61." error={err("phonePrefix")}><Input name="phonePrefix" defaultValue={initial.phonePrefix} /></Field>
        <Field label="Time zones" name="timezones" hint="IANA names separated by commas, e.g. Australia/Sydney, Australia/Perth." error={err("timezones")}><Input name="timezones" defaultValue={initial.timezones} required /></Field>
        <Field label="Main time zone" name="defaultTimezone" error={err("defaultTimezone")}><Input name="defaultTimezone" defaultValue={initial.defaultTimezone} required /></Field>
        <Field label="Address format" name="addressFormat" className="sm:col-span-2" hint="One field per line: key | label | required. For example: postcode | Postcode | required" error={err("addressFormat")}>
          <Textarea name="addressFormat" rows={6} defaultValue={initial.addressFormat} className="font-mono text-[12px]" />
        </Field>
        <Field label="Authorities" name="authorities" className="sm:col-span-2" hint="One per line: name | kind (immigration, education, professional, privacy, other) | official https:// address" error={err("authorities")}>
          <Textarea name="authorities" rows={5} defaultValue={initial.authorities} className="font-mono text-[12px]" />
        </Field>
        <Field label="Notes" name="notes" className="sm:col-span-2" error={err("notes")}><Textarea name="notes" rows={3} defaultValue={initial.notes} /></Field>
        <Field label="What changed and why" name="reason" className="sm:col-span-2" hint="Kept in the version history." error={err("reason")}>
          <Input name="reason" required defaultValue={mode === "create" ? "New country profile" : ""} />
        </Field>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>{mode === "create" ? "Add country as a draft" : "Save new version"}</SubmitButton>
          {warnReopen ? <p className="text-[13px] text-warn">{warnReopen}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

/* ───────── Status steps ───────── */

export function StatusActions({ code, status, canManage, canReview, blockers }: { code: string; status: string; canManage: boolean; canReview: boolean; blockers: { forReview: string[]; forOperational: string[] } }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  const step = (s: Parameters<typeof countryStepAction>[1], n?: string) => run(countryStepAction(code, s, n));
  return (
    <div className="grid gap-3 p-4">
      {status === "draft" && canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || blockers.forReview.length > 0} onClick={() => step("submit")}>Send for review</Button>
          {blockers.forReview.length ? <span className="text-[13px] text-muted">First: {blockers.forReview.join(" ")}</span> : null}
        </div>
      ) : null}
      {status === "in_review" ? (
        <div className="grid gap-2">
          {canReview ? (
            <>
              <Textarea aria-label="Review note" placeholder="Note for the record (required when returning)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={pending} onClick={() => step("verify", note)}>Verify profile</Button>
                <Button disabled={pending} onClick={() => step("return", note)}>Return with note</Button>
              </div>
            </>
          ) : <p className="text-[13px] text-muted">Waiting for a reviewer.</p>}
          {canManage ? <Button variant="ghost" className="justify-self-start" disabled={pending} onClick={() => step("withdraw")}>Withdraw from review</Button> : null}
        </div>
      ) : null}
      {status === "verified" && canReview ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || blockers.forOperational.length > 0} onClick={() => step("operational")}>Make operational</Button>
          {blockers.forOperational.length ? <span className="text-[13px] text-muted">First: {blockers.forOperational.join(" ")}</span> : <span className="text-[13px] text-muted">Proposals with services or destinations in {code} can then be sent.</span>}
        </div>
      ) : null}
      {status === "retired" && canManage ? <Button className="justify-self-start" disabled={pending} onClick={() => step("restore")}>Restore to draft</Button> : null}
      {status !== "retired" && canReview ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted">Retire this country</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input aria-label="Reason for retiring" placeholder="Reason" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-sm" />
            <Button variant="danger" disabled={pending} onClick={() => step("retire", note)}>Retire</Button>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ───────── Calendars ───────── */

type Holiday = { id: string; date: string; name: string; sourceUrl: string | null };
type Cal = { id: string; name: string; region: string | null; status: string; sourceTitle: string; sourceUrl: string; notes: string | null; reviewedBy: string | null; reviewedAt: string | null; holidays: Holiday[] };

export function CalendarCard({ code, cal, canManage, canReview }: { code: string; cal: Cal; canManage: boolean; canReview: boolean }) {
  const { pending, run } = useRun();
  const [state, formAction] = useActionState(addHolidayAction.bind(null, code, cal.id), null);
  const [reason, setReason] = useState("");
  const years = [...new Set(cal.holidays.map((h) => h.date.slice(0, 4)))];
  const draft = cal.status === "draft";
  return (
    <div className="border-b border-hairline p-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{cal.name} <CalendarBadge status={cal.status} /></p>
          <p className="mt-0.5 text-[13px] text-muted">
            Source: <a className="underline" href={cal.sourceUrl} target="_blank" rel="noreferrer">{cal.sourceTitle}</a>
            {cal.reviewedBy ? <> · verified by {cal.reviewedBy}{cal.reviewedAt ? <> on <LocalTime value={cal.reviewedAt} mode="date" /></> : null}</> : null}
          </p>
          {cal.notes ? <p className="mt-1 max-w-[80ch] text-[13px] text-ink-2">{cal.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && canReview ? <Button size="sm" variant="primary" disabled={pending} onClick={() => run(calendarStatusAction(code, cal.id, "verified"))}>Verify dates</Button> : null}
        </div>
      </div>
      {years.map((y) => (
        <details key={y} className="mt-3" open={y === String(new Date().getFullYear() + 1)}>
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">{y} · {cal.holidays.filter((h) => h.date.startsWith(y)).length} dates</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {cal.holidays.filter((h) => h.date.startsWith(y)).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-sunken">
                <span><span className="tabular-nums text-muted">{formatDay(h.date)}</span> {h.name}{h.sourceUrl ? <> · <a className="underline" href={h.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</span>
                {draft && canManage ? (
                  <button type="button" aria-label={`Remove ${h.name} ${h.date}`} className="text-muted hover:text-danger" disabled={pending} onClick={() => run(removeHolidayAction(code, cal.id, h.id))}><Trash2 className="size-3.5" /></button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {draft && canManage ? (
        <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Date" name="date" error={fieldError(state, "date")} idPrefix={cal.id}><Input type="date" name="date" required /></Field>
          <Field label="Holiday" name="name" error={fieldError(state, "name")} idPrefix={cal.id}><Input name="name" required /></Field>
          <Field label="Source if different" name="sourceUrl" error={fieldError(state, "sourceUrl")} idPrefix={cal.id}><Input name="sourceUrl" placeholder="https://" /></Field>
          <SubmitButton size="sm">Add date</SubmitButton>
          <ActionFeedback state={state} />
        </form>
      ) : null}
      {!draft && canManage ? (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-muted">Correct this calendar</summary>
          <p className="mt-1 text-muted">Returning it to draft unlocks the dates. Deadline rules that use it stop calculating until it is verified again.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-sm" />
            <Button size="sm" disabled={pending} onClick={() => run(calendarStatusAction(code, cal.id, "draft", reason))}>Return to draft</Button>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function formatDay(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function CalendarBadge({ status }: { status: string }) {
  return <Badge tone={status === "verified" ? "ok" : status === "retired" ? "outline" : "warn"}>{status === "verified" ? "Verified" : status === "retired" ? "Retired" : "Draft: not used for deadlines"}</Badge>;
}

export function NewCalendarForm({ code }: { code: string }) {
  const [state, formAction] = useActionState(createCalendarAction.bind(null, code), null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={formAction} className="grid gap-3 p-4 sm:grid-cols-2">
      <ActionFeedback state={state} />
      <Field label="Calendar name" name="name" error={err("name")}><Input name="name" required placeholder="e.g. Australia: Victoria public holidays" /></Field>
      <Field label="Region" name="region" hint="Leave empty for a national calendar." error={err("region")}><Input name="region" /></Field>
      <Field label="Source title" name="sourceTitle" error={err("sourceTitle")}><Input name="sourceTitle" required /></Field>
      <Field label="Official source address" name="sourceUrl" error={err("sourceUrl")}><Input name="sourceUrl" required placeholder="https://" /></Field>
      <Field label="Notes" name="notes" className="sm:col-span-2" error={err("notes")}><Textarea name="notes" rows={2} /></Field>
      <div><SubmitButton>Add calendar</SubmitButton></div>
    </form>
  );
}

/* ───────── Sources ───────── */


export function SourceForm({ code, staff }: { code: string; staff: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(saveSourceAction.bind(null, code, null), null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={formAction} className="grid gap-3 p-4 sm:grid-cols-2">
      <ActionFeedback state={state} />
      <Field label="Kind" name="kind" error={err("kind")}><Select name="kind">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Title" name="title" error={err("title")}><Input name="title" required /></Field>
      <Field label="Official address" name="url" error={err("url")}><Input name="url" required placeholder="https://" /></Field>
      <Field label="Publisher" name="publisher" error={err("publisher")}><Input name="publisher" /></Field>
      <Field label="Version or edition" name="versionLabel" error={err("versionLabel")}><Input name="versionLabel" /></Field>
      <Field label="Responsible reviewer" name="ownerId" error={err("ownerId")}>
        <Select name="ownerId"><option value="">Not assigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <Field label="In effect from" name="effectiveFrom" error={err("effectiveFrom")}><Input type="date" name="effectiveFrom" /></Field>
      <Field label="In effect until" name="effectiveTo" error={err("effectiveTo")}><Input type="date" name="effectiveTo" /></Field>
      <Field label="Next review" name="nextReviewOn" error={err("nextReviewOn")}><Input type="date" name="nextReviewOn" /></Field>
      <Field label="Notes" name="notes" className="sm:col-span-2" error={err("notes")}><Textarea name="notes" rows={2} /></Field>
      <div><SubmitButton>Add source</SubmitButton></div>
    </form>
  );
}

export function SourceActions({ code, id, status, canReview }: { code: string; id: string; status: string; canReview: boolean }) {
  const { pending, run } = useRun();
  if (!canReview) return null;
  return (
    <div className="flex gap-1.5">
      {status === "draft" ? <Button size="sm" disabled={pending} onClick={() => run(sourceStatusAction(code, id, "verified"))}>Verify</Button> : null}
      {status === "verified" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(sourceStatusAction(code, id, "superseded"))}>Mark superseded</Button> : null}
    </div>
  );
}

/* ───────── Practice-by-country checks ───────── */

export function CapabilityForm({ code, firms, areas, statuses, canReview }: { code: string | null; firms: { id: string; name: string }[]; areas: [string, string][]; statuses: [string, string][]; canReview: boolean }) {
  const [state, formAction] = useActionState(setCapabilityAction.bind(null, code), null);
  const err = (n: string) => fieldError(state, n);
  return (
    <form action={formAction} className="grid gap-3 p-4 sm:grid-cols-3">
      <ActionFeedback state={state} />
      <Field label="Practice" name="firmId" error={err("firmId")}><Select name="firmId" required>{firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
      {code ? <input type="hidden" name="countryCode" value={code} /> : <Field label="Country" name="countryCode" error={err("countryCode")}><CountrySelect name="countryCode" required placeholder="Choose" /></Field>}
      <Field label="Area" name="area" error={err("area")}><Select name="area">{areas.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Provider or law" name="provider" error={err("provider")}><Input name="provider" placeholder="e.g. Stripe, Xero, Infobip, Privacy Act 1988" /></Field>
      <Field label="Status" name="status" error={err("status")} hint={canReview ? undefined : "Only a reviewer can mark something verified."}>
        <Select name="status">{statuses.filter(([v]) => canReview || v !== "verified").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <Field label="Evidence address" name="evidenceUrl" error={err("evidenceUrl")}><Input name="evidenceUrl" placeholder="https://" /></Field>
      <Field label="Note or test result" name="note" className="sm:col-span-3" hint="For 'verified', describe the test transaction or check that proves it works." error={err("note")}><Textarea name="note" rows={2} /></Field>
      <div><SubmitButton>Save check</SubmitButton></div>
    </form>
  );
}

export function RegisteredCountryForm({ firmId, value }: { firmId: string; value: string | null }) {
  const [state, formAction] = useActionState(setRegisteredCountryAction.bind(null, firmId), null);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <CountrySelect name="registeredCountry" defaultValue={value ?? ""} placeholder="Not confirmed" aria-label="Registered country" className="w-[200px]" />
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}

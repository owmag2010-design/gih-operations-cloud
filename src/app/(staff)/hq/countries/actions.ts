"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/server/errors";
import {
  addHoliday, createCalendar, createCountry, makeCountryOperational, removeHoliday, restoreCountry, retireCountry, reviewCountry, saveSource,
  setCalendarStatus, setCapability, setRegisteredCountry, setSourceStatus, submitCountryForReview, updateCountry, withdrawCountryFromReview,
} from "@/server/modules/countries/countries";
import { requireStaff } from "@/server/next/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const data = (f: FormData) => Object.fromEntries([...f.keys()].map((k) => [k, String(f.get(k))]));

/** Turn the profile form's plain-text fields into the structured profile. One item per line, parts separated by "|". */
function profileFromForm(f: FormData) {
  const lines = (k: string) => str(f, k).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("|").map((p) => p.trim()));
  return {
    name: str(f, "name"),
    currency: str(f, "currency"),
    dateFormat: str(f, "dateFormat"),
    phonePrefix: str(f, "phonePrefix"),
    timezones: str(f, "timezones").split(/[,\s]+/).map((t) => t.trim()).filter(Boolean),
    defaultTimezone: str(f, "defaultTimezone").trim(),
    addressFormat: lines("addressFormat").map(([key, label, req]) => ({ key: key ?? "", label: label ?? key ?? "", required: /^(required|yes|true)$/i.test(req ?? "") })),
    authorities: lines("authorities").map(([name, kind, url]) => ({ name: name ?? "", kind: (kind || "other").toLowerCase(), url: url || null })),
    notes: str(f, "notes"),
    reason: str(f, "reason"),
  };
}

const done = (code?: string) => {
  revalidatePath("/hq/countries", "layout");
  if (code) revalidatePath(`/hq/countries/${code}`);
};

export async function createCountryAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  let code: string;
  try {
    code = (await createCountry(ctx, { ...profileFromForm(form), code: str(form, "code") })).code;
  } catch (err) {
    return toActionError(err);
  }
  done();
  redirect(`/hq/countries/${code}`);
}

export async function updateCountryAction(code: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    const { profile, reopened } = await updateCountry(ctx, code, profileFromForm(form));
    done(code);
    return { ok: true, message: reopened ? `Saved as version ${profile.version}. ${code} is back in draft until it's reviewed again.` : `Saved as version ${profile.version}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function countryStepAction(code: string, step: "submit" | "withdraw" | "verify" | "return" | "operational" | "retire" | "restore", note?: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    if (step === "submit") await submitCountryForReview(ctx, code);
    else if (step === "withdraw") await withdrawCountryFromReview(ctx, code);
    else if (step === "verify" || step === "return") await reviewCountry(ctx, code, { decision: step, note });
    else if (step === "operational") await makeCountryOperational(ctx, code);
    else if (step === "retire") await retireCountry(ctx, code, note ?? "");
    else await restoreCountry(ctx, code);
    done(code);
    const msg = { submit: "Sent for review.", withdraw: "Withdrawn from review.", verify: "Verified.", return: "Returned to draft with your note.", operational: `${code} is now operational.`, retire: "Retired.", restore: "Restored to draft." }[step];
    return { ok: true, message: msg };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createCalendarAction(code: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await createCalendar(ctx, { ...data(form), countryCode: code });
    done(code);
    return { ok: true, message: "Calendar added as a draft. Add its holidays, then ask a reviewer to verify it." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addHolidayAction(code: string, calendarId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await addHoliday(ctx, calendarId, data(form));
    done(code);
    return { ok: true, message: "Holiday added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeHolidayAction(code: string, calendarId: string, holidayId: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await removeHoliday(ctx, calendarId, holidayId);
    done(code);
    return { ok: true, message: "Holiday removed." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function calendarStatusAction(code: string, calendarId: string, to: "verified" | "draft" | "retired", reason?: string): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setCalendarStatus(ctx, calendarId, to, reason);
    done(code);
    return { ok: true, message: to === "verified" ? "Calendar verified. Its dates are now locked and used for deadlines." : to === "draft" ? "Calendar back in draft: deadlines can't use it until it's verified again." : "Calendar retired." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveSourceAction(code: string, sourceId: string | null, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await saveSource(ctx, sourceId, { ...data(form), countryCode: code });
    done(code);
    return { ok: true, message: sourceId ? "Source updated (back in draft for review)." : "Source added as a draft." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function sourceStatusAction(code: string, sourceId: string, to: "verified" | "superseded"): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setSourceStatus(ctx, sourceId, to);
    done(code);
    return { ok: true, message: to === "verified" ? "Source verified." : "Source marked superseded." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setCapabilityAction(code: string | null, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setCapability(ctx, data(form));
    done(code ?? undefined);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setRegisteredCountryAction(firmId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { ctx } = await requireStaff();
  try {
    await setRegisteredCountry(ctx, firmId, str(form, "registeredCountry") || null);
    done();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toActionError(err);
  }
}

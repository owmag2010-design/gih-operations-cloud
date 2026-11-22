import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { CURRENCIES, isCountryCode } from "@/lib/countries";
import type { AccessContext } from "../../access/context";
import { audit } from "../../audit";
import { withScope, type Scope, type Tx } from "../../db/client";
import {
  businessCalendars,
  calendarHolidays,
  countryProfiles,
  countryProfileVersions,
  entityCountryCapabilities,
  firms,
  jurisdictionSources,
  users,
} from "../../db/schema";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { optionalText, parseOrThrow } from "../../validation";
import { isIsoDate } from "../matters/dates";

/*
 * Countries and jurisdictions.
 *
 * A country profile records how the platform works for one country: currency,
 * formats, time zones, authorities, holiday calendars and the sources behind
 * them. Its status says how far review has gone:
 *   draft → in review → verified → operational (→ retired)
 * Only an operational country may appear in client-facing work (sending a
 * proposal). Any edit to a verified or operational profile returns it to draft,
 * so nothing changes behind a reviewer's back.
 */

export type CountryStatus = (typeof countryProfiles.$inferSelect)["status"];
export const COUNTRY_STATUS_LABELS: Record<CountryStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  verified: "Verified",
  operational: "Operational",
  retired: "Retired",
};

export const CAPABILITY_AREAS = ["payments", "accounting", "messaging", "email", "e_signature", "privacy", "professional_regulation", "data_residency"] as const;
export const CAPABILITY_AREA_LABELS: Record<(typeof CAPABILITY_AREAS)[number], string> = {
  payments: "Payments",
  accounting: "Accounting",
  messaging: "WhatsApp and SMS",
  email: "Email",
  e_signature: "E-signature",
  privacy: "Privacy law",
  professional_regulation: "Professional regulation",
  data_residency: "Data residency",
};
export const CAPABILITY_STATUSES = ["not_assessed", "pending", "verified", "unavailable", "not_needed"] as const;
export const CAPABILITY_STATUS_LABELS: Record<(typeof CAPABILITY_STATUSES)[number], string> = {
  not_assessed: "Not assessed",
  pending: "Pending",
  verified: "Verified",
  unavailable: "Unavailable",
  not_needed: "Not needed",
};

function orgScope(ctx: AccessContext): Scope {
  return { orgId: ctx.orgId, userId: ctx.user.id, firmIds: [] };
}

const TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("timeZone"));
const httpsUrl = z.string().trim().url("Enter the full web address.").max(500).refine((u) => u.startsWith("https://"), "Use an https:// address.");
const code = z.string().trim().toUpperCase().refine(isCountryCode, "Choose a country from the list.");

/* ───────── Reading ───────── */

/** Every country profile in the organisation. Any staff member may read them (forms use them). */
export async function listCountries(ctx: AccessContext) {
  return withScope(orgScope(ctx), async (tx) => {
    const rows = await tx.select().from(countryProfiles).where(eq(countryProfiles.orgId, ctx.orgId)).orderBy(asc(countryProfiles.name));
    const cal = await tx
      .select({ country: businessCalendars.countryCode, status: businessCalendars.status, n: sql<number>`count(*)::int` })
      .from(businessCalendars)
      .where(eq(businessCalendars.orgId, ctx.orgId))
      .groupBy(businessCalendars.countryCode, businessCalendars.status);
    const src = await tx
      .select({ country: jurisdictionSources.countryCode, status: jurisdictionSources.status, n: sql<number>`count(*)::int` })
      .from(jurisdictionSources)
      .where(eq(jurisdictionSources.orgId, ctx.orgId))
      .groupBy(jurisdictionSources.countryCode, jurisdictionSources.status);
    const count = (list: { country: string; status: string; n: number }[], c: string, status?: string) =>
      list.filter((r) => r.country === c && (!status || r.status === status)).reduce((a, r) => a + r.n, 0);
    return rows.map((p) => ({
      ...p,
      calendars: count(cal, p.code),
      verifiedCalendars: count(cal, p.code, "verified"),
      sources: count(src, p.code),
      verifiedSources: count(src, p.code, "verified"),
    }));
  });
}

/** Status of each known country, for other modules (code → status). Countries without a profile are absent. */
export async function countryStatuses(tx: Tx, orgId: string): Promise<Map<string, CountryStatus>> {
  const rows = await tx.select({ code: countryProfiles.code, status: countryProfiles.status }).from(countryProfiles).where(eq(countryProfiles.orgId, orgId));
  return new Map(rows.map((r) => [r.code, r.status]));
}

/** Throw unless every listed country has an operational profile. Used before anything client-facing. */
export async function assertOperational(tx: Tx, orgId: string, codes: (string | null | undefined)[], what: string) {
  const wanted = [...new Set(codes.filter((c): c is string => !!c))];
  if (!wanted.length) return;
  const statuses = await countryStatuses(tx, orgId);
  const blocked = wanted.filter((c) => statuses.get(c) !== "operational");
  if (blocked.length) {
    const detail = blocked.map((c) => `${c} (${statuses.has(c) ? COUNTRY_STATUS_LABELS[statuses.get(c)!].toLowerCase() : "no country profile"})`).join(", ");
    throw new ValidationError(`${what} can't go to a client yet: ${detail} isn't operational. A Hub reviewer needs to verify the country profile first (Settings › Countries).`);
  }
}

/** Holiday dates of a verified calendar, for business-day deadlines. Returns null if the calendar isn't verified. */
export async function verifiedHolidays(tx: Tx, orgId: string, calendarId: string) {
  const [cal] = await tx.select().from(businessCalendars).where(and(eq(businessCalendars.id, calendarId), eq(businessCalendars.orgId, orgId)));
  if (!cal) return null;
  if (cal.status !== "verified") return { calendar: cal, dates: null };
  const rows = await tx.select({ date: calendarHolidays.date }).from(calendarHolidays).where(eq(calendarHolidays.calendarId, cal.id));
  return { calendar: cal, dates: new Set(rows.map((r) => r.date)) };
}

/** Calendars available for a country (any status), for the deadline-rule form. */
export async function listCalendarsFor(ctx: AccessContext, countryCode?: string) {
  return withScope(orgScope(ctx), (tx) =>
    tx
      .select({ id: businessCalendars.id, name: businessCalendars.name, countryCode: businessCalendars.countryCode, region: businessCalendars.region, status: businessCalendars.status })
      .from(businessCalendars)
      .where(and(eq(businessCalendars.orgId, ctx.orgId), countryCode ? eq(businessCalendars.countryCode, countryCode) : undefined))
      .orderBy(asc(businessCalendars.countryCode), asc(businessCalendars.name)),
  );
}

export async function getCountry(ctx: AccessContext, rawCode: string) {
  const c = rawCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new NotFoundError("Country");
  return withScope(orgScope(ctx), async (tx) => {
    const [profile] = await tx.select().from(countryProfiles).where(and(eq(countryProfiles.orgId, ctx.orgId), eq(countryProfiles.code, c)));
    if (!profile) throw new NotFoundError("Country");
    const ids = [profile.submittedById, profile.reviewedById, profile.operationalById, profile.createdById].filter((x): x is string => !!x);
    const names = new Map((ids.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, u.name]));
    const versions = await tx
      .select({ v: countryProfileVersions, by: users.name })
      .from(countryProfileVersions)
      .leftJoin(users, eq(users.id, countryProfileVersions.changedById))
      .where(eq(countryProfileVersions.profileId, profile.id))
      .orderBy(desc(countryProfileVersions.createdAt))
      .limit(50);
    const calendars = await tx
      .select({ cal: businessCalendars, reviewedBy: users.name, holidays: sql<number>`(select count(*)::int from calendar_holidays h where h.calendar_id = ${businessCalendars.id})` })
      .from(businessCalendars)
      .leftJoin(users, eq(users.id, businessCalendars.reviewedById))
      .where(and(eq(businessCalendars.orgId, ctx.orgId), eq(businessCalendars.countryCode, c)))
      .orderBy(asc(businessCalendars.name));
    const holidays = calendars.length
      ? await tx
          .select()
          .from(calendarHolidays)
          .where(inArray(calendarHolidays.calendarId, calendars.map((r) => r.cal.id)))
          .orderBy(asc(calendarHolidays.date))
      : [];
    const sources = await tx
      .select({ s: jurisdictionSources, owner: sql<string | null>`(select name from users u where u.id = ${jurisdictionSources.ownerId})`, reviewedBy: sql<string | null>`(select name from users u where u.id = ${jurisdictionSources.reviewedById})` })
      .from(jurisdictionSources)
      .where(and(eq(jurisdictionSources.orgId, ctx.orgId), eq(jurisdictionSources.countryCode, c)))
      .orderBy(asc(jurisdictionSources.kind), asc(jurisdictionSources.title));
    const matrix = await capabilityMatrix(tx, ctx.orgId, c);
    return {
      profile: { ...profile, submittedBy: names.get(profile.submittedById ?? "") ?? null, reviewedBy: names.get(profile.reviewedById ?? "") ?? null, operationalBy: names.get(profile.operationalById ?? "") ?? null },
      versions: versions.map((r) => ({ ...r.v, changedBy: r.by })),
      calendars: calendars.map((r) => ({ ...r.cal, reviewedBy: r.reviewedBy, holidayCount: r.holidays, holidays: holidays.filter((h) => h.calendarId === r.cal.id) })),
      sources: sources.map((r) => ({ ...r.s, owner: r.owner, reviewedBy: r.reviewedBy })),
      matrix,
      readiness: readiness(profile, calendars.map((r) => r.cal), sources.map((r) => r.s)),
    };
  });
}

/** What still stands between a profile and the next status. Shown on the page and enforced by the transitions. */
export function readiness(
  p: typeof countryProfiles.$inferSelect,
  calendars: { status: string }[],
  sources: { status: string; kind: string }[],
) {
  const forReview: string[] = [];
  if (!p.currency) forReview.push("Set the currency.");
  if (!p.defaultTimezone) forReview.push("Set the main time zone.");
  if (!p.addressFormat.length) forReview.push("Describe the address format.");
  if (!p.authorities.length) forReview.push("List at least one authority with its official website.");
  if (!sources.length) forReview.push("Add at least one authoritative source.");
  const forOperational: string[] = [];
  if (!calendars.some((c) => c.status === "verified")) forOperational.push("Verify at least one public-holiday calendar.");
  if (!sources.some((s) => s.status === "verified")) forOperational.push("Verify at least one source.");
  return { forReview, forOperational };
}

/* ───────── Profiles ───────── */

const addressFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,30}$/, "Use a short key such as line1 or postcode."),
  label: z.string().trim().min(1).max(60),
  required: z.boolean().default(false),
});
const authoritySchema = z.object({
  name: z.string().trim().min(2, "Name the authority.").max(160),
  kind: z.enum(["immigration", "education", "professional", "privacy", "other"]),
  url: httpsUrl.nullable().optional().transform((v) => v ?? null),
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter the country name.").max(80),
  currency: z.enum(CURRENCIES, { message: "Choose a currency." }),
  dateFormat: z.enum(["dd/MM/yyyy", "yyyy/MM/dd", "yyyy-MM-dd", "MM/dd/yyyy", "d MMM yyyy"], { message: "Choose a date format." }),
  phonePrefix: z.string().trim().regex(/^\+\d{1,4}$/, "Use the form +61.").optional().or(z.literal("")).transform((v) => v || null),
  timezones: z.array(z.string().refine((t) => TIMEZONES.has(t), "Choose a valid time zone.")).min(1, "Add at least one time zone.").max(12),
  defaultTimezone: z.string().refine((t) => TIMEZONES.has(t), "Choose a valid time zone."),
  addressFormat: z.array(addressFieldSchema).max(10),
  authorities: z.array(authoritySchema).max(20),
  notes: optionalText(4000),
  reason: z.string().trim().min(3, "Say briefly what changed and why.").max(300),
}).refine((v) => v.timezones.includes(v.defaultTimezone), { path: ["defaultTimezone"], message: "The main time zone must be one of the country's time zones." });

function snapshot(p: typeof countryProfiles.$inferSelect): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...p };
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

async function recordVersion(tx: Tx, ctx: AccessContext, p: typeof countryProfiles.$inferSelect, reason: string) {
  await tx.insert(countryProfileVersions).values({ orgId: ctx.orgId, profileId: p.id, version: p.version, status: p.status, snapshot: snapshot(p), reason, changedById: ctx.user.id });
}

async function loadProfile(tx: Tx, ctx: AccessContext, c: string, lock = false) {
  const q = tx.select().from(countryProfiles).where(and(eq(countryProfiles.orgId, ctx.orgId), eq(countryProfiles.code, c.toUpperCase())));
  const [p] = lock ? await q.for("update") : await q;
  if (!p) throw new NotFoundError("Country");
  return p;
}

export async function createCountry(ctx: AccessContext, raw: unknown) {
  ctx.require("countries:manage");
  const input = parseOrThrow(profileSchema.and(z.object({ code })), raw);
  return withScope(orgScope(ctx), async (tx) => {
    const [exists] = await tx.select({ id: countryProfiles.id }).from(countryProfiles).where(and(eq(countryProfiles.orgId, ctx.orgId), eq(countryProfiles.code, input.code)));
    if (exists) throw new ConflictError(`${input.code} already has a country profile.`);
    const { reason, code: c, ...fields } = input;
    const [p] = await tx.insert(countryProfiles).values({ orgId: ctx.orgId, code: c, ...fields, status: "draft", version: 1, createdById: ctx.user.id }).returning();
    await recordVersion(tx, ctx, p, reason);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "country.created", entityType: "country_profile", entityId: p.id, summary: `Added country profile ${p.code} (${p.name}) as a draft`, ip: ctx.ip }, tx);
    return p;
  });
}

/** Edit a profile. A verified or operational profile goes back to draft and must be reviewed again. */
export async function updateCountry(ctx: AccessContext, c: string, raw: unknown) {
  ctx.require("countries:manage");
  const input = parseOrThrow(profileSchema, raw);
  return withScope(orgScope(ctx), async (tx) => {
    const before = await loadProfile(tx, ctx, c, true);
    if (before.status === "retired") throw new ValidationError("This country is retired. Restore it to draft before editing.");
    if (before.status === "in_review") throw new ValidationError("This profile is with a reviewer. Withdraw it from review before editing.");
    const { reason, ...fields } = input;
    const reopened = before.status === "verified" || before.status === "operational";
    const [p] = await tx
      .update(countryProfiles)
      .set({
        ...fields, version: before.version + 1, status: "draft", updatedAt: new Date(),
        ...(reopened ? { reviewedById: null, reviewedAt: null, reviewNote: null, selfReviewed: false, operationalById: null, operationalAt: null, submittedById: null, submittedAt: null } : {}),
      })
      .where(eq(countryProfiles.id, before.id))
      .returning();
    await recordVersion(tx, ctx, p, reason);
    await audit({
      orgId: ctx.orgId, actorId: ctx.user.id, action: "country.updated", entityType: "country_profile", entityId: p.id,
      summary: `Updated ${p.code} to version ${p.version}${reopened ? ` (was ${COUNTRY_STATUS_LABELS[before.status].toLowerCase()}; back to draft for review)` : ""}`,
      data: { reason, from: before.status }, ip: ctx.ip,
    }, tx);
    return { profile: p, reopened };
  });
}

async function transition(
  ctx: AccessContext,
  c: string,
  from: CountryStatus[],
  apply: (p: typeof countryProfiles.$inferSelect, tx: Tx) => Promise<Partial<typeof countryProfiles.$inferInsert>>,
  label: (p: typeof countryProfiles.$inferSelect) => { action: string; summary: string; reason: string },
) {
  return withScope(orgScope(ctx), async (tx) => {
    const before = await loadProfile(tx, ctx, c, true);
    if (!from.includes(before.status)) throw new ValidationError(`This profile is ${COUNTRY_STATUS_LABELS[before.status].toLowerCase()}, so that step isn't available.`);
    const set = await apply(before, tx);
    const [p] = await tx.update(countryProfiles).set({ ...set, updatedAt: new Date() }).where(eq(countryProfiles.id, before.id)).returning();
    const l = label(p);
    await recordVersion(tx, ctx, p, l.reason);
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: l.action, entityType: "country_profile", entityId: p.id, summary: l.summary, ip: ctx.ip }, tx);
    return p;
  });
}

async function readinessFor(tx: Tx, orgId: string, p: typeof countryProfiles.$inferSelect) {
  const cals = await tx.select({ status: businessCalendars.status }).from(businessCalendars).where(and(eq(businessCalendars.orgId, orgId), eq(businessCalendars.countryCode, p.code)));
  const srcs = await tx.select({ status: jurisdictionSources.status, kind: jurisdictionSources.kind }).from(jurisdictionSources).where(and(eq(jurisdictionSources.orgId, orgId), eq(jurisdictionSources.countryCode, p.code)));
  return readiness(p, cals, srcs);
}

export async function submitCountryForReview(ctx: AccessContext, c: string) {
  ctx.require("countries:manage");
  return transition(ctx, c, ["draft"], async (p, tx) => {
    const r = await readinessFor(tx, ctx.orgId, p);
    if (r.forReview.length) throw new ValidationError(`Not ready for review: ${r.forReview.join(" ")}`);
    return { status: "in_review", submittedById: ctx.user.id, submittedAt: new Date() };
  }, (p) => ({ action: "country.submitted", summary: `Sent ${p.code} version ${p.version} for review`, reason: "Submitted for review" }));
}

export async function withdrawCountryFromReview(ctx: AccessContext, c: string) {
  ctx.require("countries:manage");
  return transition(ctx, c, ["in_review"], async () => ({ status: "draft", submittedById: null, submittedAt: null }), (p) => ({ action: "country.withdrawn", summary: `Withdrew ${p.code} from review`, reason: "Withdrawn from review" }));
}

const reviewSchema = z.object({ decision: z.enum(["verify", "return"]), note: z.string().trim().max(1000).optional().transform((v) => v || null) });

/** A reviewer verifies the profile or returns it with a note. Reviewing your own submission is allowed but recorded. */
export async function reviewCountry(ctx: AccessContext, c: string, raw: unknown) {
  ctx.require("countries:review");
  const input = parseOrThrow(reviewSchema, raw);
  if (input.decision === "return" && !input.note) throw new ValidationError("Say what needs changing.", { note: "Say what needs changing." });
  return transition(ctx, c, ["in_review"], async (p) =>
    input.decision === "verify"
      ? { status: "verified", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note, selfReviewed: p.submittedById === ctx.user.id }
      : { status: "draft", reviewNote: input.note, submittedById: null, submittedAt: null },
  (p) => ({
    action: input.decision === "verify" ? "country.verified" : "country.returned",
    summary: input.decision === "verify" ? `Verified ${p.code} version ${p.version}${p.selfReviewed ? " (self-review)" : ""}` : `Returned ${p.code} to draft: ${input.note}`,
    reason: input.decision === "verify" ? `Verified${input.note ? `: ${input.note}` : ""}` : `Returned: ${input.note}`,
  }));
}

/** Make a verified country available for client-facing work. Needs a verified holiday calendar and source. */
export async function makeCountryOperational(ctx: AccessContext, c: string) {
  ctx.require("countries:review");
  return transition(ctx, c, ["verified"], async (p, tx) => {
    const r = await readinessFor(tx, ctx.orgId, p);
    if (r.forOperational.length) throw new ValidationError(`Not ready to go live: ${r.forOperational.join(" ")}`);
    return { status: "operational", operationalById: ctx.user.id, operationalAt: new Date() };
  }, (p) => ({ action: "country.operational", summary: `Made ${p.code} operational`, reason: "Made operational" }));
}

export async function retireCountry(ctx: AccessContext, c: string, reason: string) {
  ctx.require("countries:review");
  const r = parseOrThrow(z.string().trim().min(5, "Say why the country is being retired.").max(300), reason);
  return transition(ctx, c, ["draft", "in_review", "verified", "operational"], async () => ({ status: "retired" }), (p) => ({ action: "country.retired", summary: `Retired ${p.code}: ${r}`, reason: `Retired: ${r}` }));
}

export async function restoreCountry(ctx: AccessContext, c: string) {
  ctx.require("countries:manage");
  return transition(ctx, c, ["retired"], async () => ({ status: "draft", reviewedById: null, reviewedAt: null, operationalById: null, operationalAt: null, selfReviewed: false }), (p) => ({ action: "country.restored", summary: `Restored ${p.code} to draft`, reason: "Restored to draft" }));
}

/* ───────── Holiday calendars ───────── */

const calendarSchema = z.object({
  countryCode: code,
  region: z.string().trim().max(60).optional().transform((v) => v || null),
  name: z.string().trim().min(3, "Name the calendar.").max(120),
  sourceTitle: z.string().trim().min(3, "Name the source.").max(200),
  sourceUrl: httpsUrl,
  notes: optionalText(2000),
});

export async function createCalendar(ctx: AccessContext, raw: unknown) {
  ctx.require("countries:manage");
  const input = parseOrThrow(calendarSchema, raw);
  return withScope(orgScope(ctx), async (tx) => {
    const [dup] = await tx.select({ id: businessCalendars.id }).from(businessCalendars).where(and(eq(businessCalendars.orgId, ctx.orgId), eq(businessCalendars.name, input.name)));
    if (dup) throw new ConflictError("A calendar with this name already exists.");
    const [cal] = await tx.insert(businessCalendars).values({ orgId: ctx.orgId, ...input, notes: input.notes ?? null, status: "draft", createdById: ctx.user.id }).returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "calendar.created", entityType: "business_calendar", entityId: cal.id, summary: `Added holiday calendar "${cal.name}" (draft)`, ip: ctx.ip }, tx);
    return cal;
  });
}

async function loadCalendar(tx: Tx, ctx: AccessContext, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Calendar");
  const q = tx.select().from(businessCalendars).where(and(eq(businessCalendars.id, id), eq(businessCalendars.orgId, ctx.orgId)));
  const [cal] = lock ? await q.for("update") : await q;
  if (!cal) throw new NotFoundError("Calendar");
  return cal;
}

const holidaySchema = z.object({
  date: z.string().refine(isIsoDate, "Enter a valid date."),
  name: z.string().trim().min(2, "Name the holiday.").max(120),
  sourceUrl: httpsUrl.optional().or(z.literal("")).transform((v) => v || null),
});

export async function addHoliday(ctx: AccessContext, calendarId: string, raw: unknown) {
  ctx.require("countries:manage");
  const input = parseOrThrow(holidaySchema, raw);
  return withScope(orgScope(ctx), async (tx) => {
    const cal = await loadCalendar(tx, ctx, calendarId, true);
    if (cal.status !== "draft") throw new ValidationError("Return the calendar to draft before changing its dates.");
    const [h] = await tx.insert(calendarHolidays).values({ orgId: ctx.orgId, calendarId: cal.id, ...input }).onConflictDoNothing().returning();
    if (!h) throw new ConflictError("That holiday is already in the calendar.");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "calendar.holiday_added", entityType: "business_calendar", entityId: cal.id, summary: `${cal.name}: added ${h.date} ${h.name}`, ip: ctx.ip }, tx);
    return h;
  });
}

export async function removeHoliday(ctx: AccessContext, calendarId: string, holidayId: string) {
  ctx.require("countries:manage");
  return withScope(orgScope(ctx), async (tx) => {
    const cal = await loadCalendar(tx, ctx, calendarId, true);
    if (cal.status !== "draft") throw new ValidationError("Return the calendar to draft before changing its dates.");
    const [h] = await tx.delete(calendarHolidays).where(and(eq(calendarHolidays.id, holidayId), eq(calendarHolidays.calendarId, cal.id))).returning();
    if (!h) throw new NotFoundError("Holiday");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: "calendar.holiday_removed", entityType: "business_calendar", entityId: cal.id, summary: `${cal.name}: removed ${h.date} ${h.name}`, ip: ctx.ip }, tx);
  });
}

/** Verify a draft calendar (dates then lock) or return a verified one to draft (with a reason) so it can be corrected. */
export async function setCalendarStatus(ctx: AccessContext, calendarId: string, to: "verified" | "draft" | "retired", reason?: string) {
  ctx.require(to === "draft" ? "countries:manage" : "countries:review");
  const why = to === "verified" ? null : parseOrThrow(z.string().trim().min(5, "Say why.").max(300), reason ?? "");
  return withScope(orgScope(ctx), async (tx) => {
    const cal = await loadCalendar(tx, ctx, calendarId, true);
    if (cal.status === to) return cal;
    if (to === "verified") {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(calendarHolidays).where(eq(calendarHolidays.calendarId, cal.id));
      if (!n) throw new ValidationError("Add the holidays before verifying the calendar.");
    }
    const [updated] = await tx
      .update(businessCalendars)
      .set(to === "verified" ? { status: to, reviewedById: ctx.user.id, reviewedAt: new Date(), updatedAt: new Date() } : { status: to, reviewedById: null, reviewedAt: null, updatedAt: new Date() })
      .where(eq(businessCalendars.id, cal.id))
      .returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: `calendar.${to}`, entityType: "business_calendar", entityId: cal.id, summary: `${cal.name}: ${cal.status} → ${to}${why ? ` (${why})` : ""}`, ip: ctx.ip }, tx);
    return updated;
  });
}

/* ───────── Sources ───────── */

const sourceSchema = z.object({
  countryCode: code,
  kind: z.enum(["legislation", "official_fees", "requirements", "checklist", "holidays", "guidance", "other"]),
  title: z.string().trim().min(3, "Give the source a title.").max(200),
  url: httpsUrl,
  publisher: optionalText(160),
  versionLabel: optionalText(80),
  effectiveFrom: z.string().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."),
  effectiveTo: z.string().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."),
  ownerId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  nextReviewOn: z.string().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Enter a valid date."),
  notes: optionalText(2000),
}).refine((v) => !v.effectiveFrom || !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { path: ["effectiveTo"], message: "The end date is before the start date." });

async function assertStaffOwner(tx: Tx, ctx: AccessContext, ownerId: string | null) {
  if (!ownerId) return;
  const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.orgId, ctx.orgId), eq(users.kind, "staff")));
  if (!u) throw new ValidationError("Choose a staff member as the responsible reviewer.", { ownerId: "Choose a staff member." });
}

/** Add or edit a source. Editing a verified source returns it to draft. */
export async function saveSource(ctx: AccessContext, sourceId: string | null, raw: unknown) {
  ctx.require("countries:manage");
  const input = parseOrThrow(sourceSchema, raw);
  return withScope(orgScope(ctx), async (tx) => {
    await assertStaffOwner(tx, ctx, input.ownerId);
    const values = { ...input, publisher: input.publisher ?? null, versionLabel: input.versionLabel ?? null, effectiveFrom: input.effectiveFrom ?? null, effectiveTo: input.effectiveTo ?? null, nextReviewOn: input.nextReviewOn ?? null, notes: input.notes ?? null };
    let row;
    if (sourceId) {
      if (!z.string().uuid().safeParse(sourceId).success) throw new NotFoundError("Source");
      [row] = await tx.update(jurisdictionSources).set({ ...values, status: "draft", reviewedById: null, reviewedAt: null, updatedAt: new Date() }).where(and(eq(jurisdictionSources.id, sourceId), eq(jurisdictionSources.orgId, ctx.orgId))).returning();
      if (!row) throw new NotFoundError("Source");
    } else {
      [row] = await tx.insert(jurisdictionSources).values({ orgId: ctx.orgId, ...values, createdById: ctx.user.id }).returning();
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: sourceId ? "source.updated" : "source.created", entityType: "jurisdiction_source", entityId: row.id, summary: `${sourceId ? "Updated" : "Added"} ${row.countryCode} source "${row.title}" (draft)`, ip: ctx.ip }, tx);
    return row;
  });
}

export async function setSourceStatus(ctx: AccessContext, sourceId: string, to: "verified" | "superseded", supersededById?: string) {
  ctx.require("countries:review");
  if (!z.string().uuid().safeParse(sourceId).success) throw new NotFoundError("Source");
  return withScope(orgScope(ctx), async (tx) => {
    const [s] = await tx.select().from(jurisdictionSources).where(and(eq(jurisdictionSources.id, sourceId), eq(jurisdictionSources.orgId, ctx.orgId))).for("update");
    if (!s) throw new NotFoundError("Source");
    if (to === "verified" && s.status !== "draft") throw new ValidationError("Only a draft source can be verified.");
    if (supersededById) {
      const [n] = await tx.select({ id: jurisdictionSources.id }).from(jurisdictionSources).where(and(eq(jurisdictionSources.id, supersededById), eq(jurisdictionSources.orgId, ctx.orgId), eq(jurisdictionSources.countryCode, s.countryCode)));
      if (!n) throw new ValidationError("Choose the newer source from the same country.");
    }
    const [row] = await tx
      .update(jurisdictionSources)
      .set(to === "verified" ? { status: to, reviewedById: ctx.user.id, reviewedAt: new Date(), updatedAt: new Date() } : { status: to, supersededById: supersededById ?? null, effectiveTo: s.effectiveTo ?? new Date().toISOString().slice(0, 10), updatedAt: new Date() })
      .where(eq(jurisdictionSources.id, s.id))
      .returning();
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, action: `source.${to}`, entityType: "jurisdiction_source", entityId: s.id, summary: `${s.countryCode} source "${s.title}": ${to}`, ip: ctx.ip }, tx);
    return row;
  });
}

/* ───────── Practice-by-country checks ───────── */

async function capabilityMatrix(tx: Tx, orgId: string, countryCode?: string) {
  const fs = await tx.select({ id: firms.id, name: firms.tradingName, registeredCountry: firms.registeredCountry }).from(firms).where(and(eq(firms.orgId, orgId), eq(firms.status, "active"))).orderBy(asc(firms.tradingName));
  const rows = await tx
    .select({ c: entityCountryCapabilities, reviewedBy: sql<string | null>`(select name from users u where u.id = ${entityCountryCapabilities.reviewedById})` })
    .from(entityCountryCapabilities)
    .where(and(eq(entityCountryCapabilities.orgId, orgId), countryCode ? eq(entityCountryCapabilities.countryCode, countryCode) : undefined));
  return { firms: fs, cells: rows.map((r) => ({ ...r.c, reviewedBy: r.reviewedBy })) };
}

/** The whole matrix: every practice × country × area that has been assessed. */
export async function getCapabilityMatrix(ctx: AccessContext) {
  return withScope(orgScope(ctx), (tx) => capabilityMatrix(tx, ctx.orgId));
}

const capabilitySchema = z.object({
  firmId: z.string().uuid("Choose a practice."),
  countryCode: code,
  area: z.enum(CAPABILITY_AREAS),
  provider: optionalText(120),
  status: z.enum(CAPABILITY_STATUSES),
  note: optionalText(1000),
  evidenceUrl: httpsUrl.optional().or(z.literal("")).transform((v) => v || null),
});

/** Record what is known for one practice in one country. Marking something verified needs the reviewer permission and evidence. */
export async function setCapability(ctx: AccessContext, raw: unknown) {
  ctx.require("countries:manage");
  const input = parseOrThrow(capabilitySchema, raw);
  if (input.status === "verified") {
    if (!ctx.has("countries:review")) throw new AccessDeniedError("countries:review");
    if (!input.evidenceUrl && !input.note) throw new ValidationError("Record the evidence: a link or a note of the test transaction.", { evidenceUrl: "Add evidence." });
  }
  return withScope(orgScope(ctx), async (tx) => {
    const [f] = await tx.select({ id: firms.id, name: firms.tradingName }).from(firms).where(and(eq(firms.id, input.firmId), eq(firms.orgId, ctx.orgId)));
    if (!f) throw new ValidationError("Choose a practice.", { firmId: "Choose a practice." });
    const verified = input.status === "verified";
    const values = {
      provider: input.provider ?? null, status: input.status, note: input.note ?? null, evidenceUrl: input.evidenceUrl,
      reviewedById: verified ? ctx.user.id : null, reviewedAt: verified ? new Date() : null, updatedById: ctx.user.id, updatedAt: new Date(),
    };
    const [row] = await tx
      .insert(entityCountryCapabilities)
      .values({ orgId: ctx.orgId, firmId: f.id, countryCode: input.countryCode, area: input.area, ...values })
      .onConflictDoUpdate({ target: [entityCountryCapabilities.firmId, entityCountryCapabilities.countryCode, entityCountryCapabilities.area], set: values })
      .returning();
    await audit({
      orgId: ctx.orgId, actorId: ctx.user.id, firmId: f.id, action: "capability.set", entityType: "entity_country_capability", entityId: row.id,
      summary: `${f.name} × ${input.countryCode} · ${CAPABILITY_AREA_LABELS[input.area]}: ${CAPABILITY_STATUS_LABELS[input.status]}${input.provider ? ` (${input.provider})` : ""}`, ip: ctx.ip,
    }, tx);
    return row;
  });
}

/** Record the country a practice's legal entity is registered in. */
export async function setRegisteredCountry(ctx: AccessContext, firmId: string, countryCode: string | null) {
  ctx.require("firms:edit");
  const c = countryCode ? parseOrThrow(code, countryCode) : null;
  return withScope(orgScope(ctx), async (tx) => {
    const [f] = await tx.update(firms).set({ registeredCountry: c, updatedAt: new Date() }).where(and(eq(firms.id, firmId), eq(firms.orgId, ctx.orgId))).returning();
    if (!f) throw new NotFoundError("Practice");
    await audit({ orgId: ctx.orgId, actorId: ctx.user.id, firmId: f.id, action: "firm.registered_country", entityType: "firm", entityId: f.id, summary: `${f.tradingName}: registered country ${c ?? "cleared"}`, ip: ctx.ip }, tx);
    return f;
  });
}

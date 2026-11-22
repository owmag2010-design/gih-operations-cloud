import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/schema";
import { withScope } from "../../src/server/db/client";
import { AccessDeniedError, ValidationError } from "../../src/server/errors";
import {
  addHoliday, createCalendar, createCountry, getCapabilityMatrix, getCountry, listCountries, makeCountryOperational, retireCountry,
  reviewCountry, saveSource, setCalendarStatus, setCapability, setSourceStatus, submitCountryForReview, updateCountry,
} from "../../src/server/modules/countries/countries";
import { addBusinessDays } from "../../src/server/modules/matters/dates";
import { convertLead, createLead } from "../../src/server/modules/crm/leads";
import { updateClient } from "../../src/server/modules/clients/clients";
import { addCalculatedDeadline, createMatter, getMatter, saveDeadlineRule, validateDeadlineRule } from "../../src/server/modules/matters/matters";
import { createProposalFromLead, approveProposal, releaseProposal, submitForReview } from "../../src/server/modules/proposals/proposals";
import { listCatalogue, parseMoney } from "../../src/server/modules/services/services";
import { runSeed } from "../../scripts/seed-lib";
import { auditCount, firmId, lead, makeUser, owner, resetDatabase } from "../support/fixtures";

const hub = () => makeUser({ name: "Hub Admin", group: "group_super_admin" });

async function profileInput(code: string) {
  const v = (await owner.select().from(s.countryProfiles).where(eq(s.countryProfiles.code, code)))[0];
  return { name: v.name, currency: v.currency, dateFormat: v.dateFormat, phonePrefix: v.phonePrefix ?? "", timezones: v.timezones, defaultTimezone: v.defaultTimezone, addressFormat: v.addressFormat, authorities: v.authorities, notes: v.notes ?? "", reason: "Test edit" };
}

/** Take AU from the seeded draft to operational the way a Hub reviewer would. */
async function makeAuOperational(admin: Awaited<ReturnType<typeof hub>>) {
  await submitCountryForReview(admin, "AU");
  await reviewCountry(admin, "AU", { decision: "verify", note: "Checked against official pages" });
  const au = await getCountry(admin, "AU");
  const nsw = au.calendars.find((c) => c.region === "NSW")!;
  await setCalendarStatus(admin, nsw.id, "verified");
  await setSourceStatus(admin, au.sources.find((x) => x.url.includes("nsw.gov.au"))!.id, "verified");
  await makeCountryOperational(admin, "AU");
  return nsw;
}

describe("country profiles", () => {
  beforeEach(resetDatabase);

  it("loads Australia, New Zealand, South Africa and Zimbabwe as drafts, with their own currencies and calendars", async () => {
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const list = await listCountries(consultant);
    expect(list.map((c) => [c.code, c.currency, c.status])).toEqual([
      ["AU", "AUD", "draft"], ["NZ", "NZD", "draft"], ["ZA", "ZAR", "draft"], ["ZW", "USD", "draft"],
    ]);
    const au = list.find((c) => c.code === "AU")!;
    expect(au.calendars).toBe(2); // NSW and ACT: Australia has no national calendar
    expect(au.verifiedCalendars).toBe(0);
    const zaHolidays = await owner.select().from(s.calendarHolidays).innerJoin(s.businessCalendars, eq(s.businessCalendars.id, s.calendarHolidays.calendarId)).where(eq(s.businessCalendars.countryCode, "ZA"));
    expect(zaHolidays.map((r) => r.calendar_holidays.date)).toContain("2026-11-04");
    // Seeding again adds nothing and keeps edits.
    await owner.update(s.countryProfiles).set({ notes: "Edited in the app" }).where(eq(s.countryProfiles.code, "NZ"));
    await runSeed(owner, () => {});
    expect((await listCountries(consultant)).length).toBe(4);
    expect((await owner.select().from(s.countryProfiles).where(eq(s.countryProfiles.code, "NZ")))[0].notes).toBe("Edited in the app");
    expect((await owner.select({ n: sql<number>`count(*)::int` }).from(s.calendarHolidays))[0].n).toBe(zaHolidays.length + 29 + 27 + 30);
  });

  it("lets only Hub roles change countries; reviewing is a separate permission", async () => {
    const admin = await hub();
    const firmAdmin = await makeUser({ firms: { veritas: "firm_admin" } });
    const ops = await makeUser({ group: "group_ops_admin" });
    const input = { ...(await profileInput("NZ")), reason: "Typo" };
    await expect(updateCountry(firmAdmin, "NZ", input)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(updateCountry(ops, "NZ", input)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(reviewCountry(ops, "NZ", { decision: "verify" })).rejects.toBeInstanceOf(AccessDeniedError);
    const { profile } = await updateCountry(admin, "NZ", input);
    expect(profile.version).toBe(2);
  });

  it("moves a profile through review to operational and back to draft when edited", async () => {
    const admin = await hub();
    // Zimbabwe has no authorities or sources yet, so it can't go for review.
    await expect(submitCountryForReview(admin, "ZW")).rejects.toThrow(/authority/);

    await submitCountryForReview(admin, "AU");
    await expect(updateCountry(admin, "AU", await profileInput("AU"))).rejects.toThrow(/with a reviewer/);
    const verified = await reviewCountry(admin, "AU", { decision: "verify" });
    expect(verified.status).toBe("verified");
    expect(verified.selfReviewed).toBe(true); // recorded, not hidden

    // Operational needs a verified calendar and a verified source.
    await expect(makeCountryOperational(admin, "AU")).rejects.toThrow(/holiday calendar/);
    const au = await getCountry(admin, "AU");
    await setCalendarStatus(admin, au.calendars.find((c) => c.region === "NSW")!.id, "verified");
    await expect(makeCountryOperational(admin, "AU")).rejects.toThrow(/source/);
    await setSourceStatus(admin, au.sources[0].id, "verified");
    expect((await makeCountryOperational(admin, "AU")).status).toBe("operational");

    // Any edit takes it out of operational use until reviewed again.
    const { profile, reopened } = await updateCountry(admin, "AU", { ...(await profileInput("AU")), notes: "Added registration note", reason: "Registration note" });
    expect(reopened).toBe(true);
    expect(profile.status).toBe("draft");
    expect(profile.reviewedById).toBeNull();
    const history = (await getCountry(admin, "AU")).versions;
    expect(history.map((v) => v.status)).toEqual(["draft", "operational", "verified", "in_review", "draft"]);
    expect(await auditCount("country.operational")).toBe(1);

    // History can't be rewritten by the app.
    await expect(withScope({ orgId: admin.orgId, userId: admin.user.id, firmIds: [] }, (tx) => tx.execute(sql`delete from country_profile_versions`))).rejects.toThrow();

    await retireCountry(admin, "AU", "Not offering AU work for now");
    expect((await getCountry(admin, "AU")).profile.status).toBe("retired");
  });

  it("adds a further country as a draft without code changes, and refuses duplicates", async () => {
    const admin = await hub();
    const p = await createCountry(admin, {
      code: "gb", name: "United Kingdom", currency: "GBP", dateFormat: "dd/MM/yyyy", phonePrefix: "+44", timezones: ["Europe/London"], defaultTimezone: "Europe/London",
      addressFormat: [{ key: "line1", label: "Address", required: true }, { key: "postcode", label: "Postcode", required: true }], authorities: [], reason: "Expansion",
    });
    expect([p.code, p.status]).toEqual(["GB", "draft"]);
    await expect(createCountry(admin, { ...(await profileInput("NZ")), code: "NZ" })).rejects.toThrow(/already/);
    await expect(createCountry(admin, { ...(await profileInput("NZ")), code: "XX" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCountry(admin, { ...(await profileInput("NZ")), code: "FJ", timezones: ["Mars/Base"], defaultTimezone: "Mars/Base" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps another organisation's countries out of reach", async () => {
    const admin = await hub();
    const [other] = await owner.insert(s.organisations).values({ name: "Other Org", slug: "other", hqCountry: "GB" }).returning();
    await owner.insert(s.countryProfiles).values({ orgId: other.id, code: "GB", name: "United Kingdom", currency: "GBP", dateFormat: "dd/MM/yyyy", defaultTimezone: "Europe/London", timezones: ["Europe/London"] });
    expect((await listCountries(admin)).map((c) => c.code)).not.toContain("GB");
    const leaked = await withScope({ orgId: admin.orgId, userId: admin.user.id, firmIds: [] }, (tx) => tx.select().from(s.countryProfiles).where(eq(s.countryProfiles.orgId, other.id)));
    expect(leaked).toHaveLength(0);
  });
});

describe("holiday calendars and deadlines", () => {
  beforeEach(resetDatabase);

  it("skips public holidays only when the calendar is verified, and locks a verified calendar", () => {
    // Pure arithmetic: Christmas and the Boxing Day additional day in NSW.
    expect(addBusinessDays("2026-12-24", 2)).toBe("2026-12-28");
    expect(addBusinessDays("2026-12-24", 2, new Set(["2026-12-25", "2026-12-28"]))).toBe("2026-12-30");
  });

  it("calculates a deadline with a verified calendar and records it in the basis", async () => {
    const admin = await hub();
    const veritas = await firmId("veritas");
    const firmAdmin = await makeUser({ firms: { veritas: "firm_admin" } });
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const au = await getCountry(admin, "AU");
    const nsw = au.calendars.find((c) => c.region === "NSW")!;
    const nz = (await getCountry(admin, "NZ")).calendars[0];

    // A calendar must match the rule's country and only applies to business days.
    await expect(saveDeadlineRule(firmAdmin, veritas, null, { name: "Response window", jurisdiction: "AU", offsetDays: "2", businessDays: "on", calendarId: nz.id, fromLabel: "the request date", source: "Test source for the rule" })).rejects.toThrow(/rule's country/);
    await expect(saveDeadlineRule(firmAdmin, veritas, null, { name: "Response window", jurisdiction: "AU", offsetDays: "2", calendarId: nsw.id, fromLabel: "the request date", source: "Test source for the rule" })).rejects.toThrow(/business-day/);
    const rule = await saveDeadlineRule(firmAdmin, veritas, null, { name: "Response window", jurisdiction: "AU", offsetDays: "2", businessDays: "on", calendarId: nsw.id, fromLabel: "the request date", source: "Test source for the rule" });
    await validateDeadlineRule(firmAdmin, veritas, rule.id, true);

    const { lead: l } = await createLead(consultant, veritas, lead());
    const { client } = await convertLead(consultant, veritas, l.id);
    const m = await createMatter(consultant, veritas, { clientId: client.id, title: "Partner visa", jurisdiction: "AU" });

    // Draft calendar: refused rather than silently ignoring holidays.
    await expect(addCalculatedDeadline(consultant, veritas, m.id, { ruleId: rule.id, fromDate: "2026-12-24" })).rejects.toThrow(/isn't verified/);
    await setCalendarStatus(admin, nsw.id, "verified");
    const d = await addCalculatedDeadline(consultant, veritas, m.id, { ruleId: rule.id, fromDate: "2026-12-24" });
    expect(d.dueOn).toBe("2026-12-30");
    expect(d.basis).toContain("excluding public holidays");

    // Verified dates are locked in the service and in the database.
    await expect(addHoliday(admin, nsw.id, { date: "2026-12-29", name: "Made up" })).rejects.toThrow(/Return the calendar to draft/);
    await expect(owner.insert(s.calendarHolidays).values({ orgId: admin.orgId, calendarId: nsw.id, date: "2026-12-29", name: "Direct insert" })).rejects.toThrow();
    // Returning it to draft needs a reason, then corrections are possible again.
    await expect(setCalendarStatus(admin, nsw.id, "draft")).rejects.toBeInstanceOf(ValidationError);
    await setCalendarStatus(admin, nsw.id, "draft", "Local public holiday to add");
    await addHoliday(admin, nsw.id, { date: "2027-02-12", name: "Example local holiday", sourceUrl: "https://www.nsw.gov.au/about-nsw/public-holidays/local-public-holidays" });
  });

  it("creates a new calendar for a new country and refuses non-https sources", async () => {
    const admin = await hub();
    await expect(createCalendar(admin, { countryCode: "ZW", name: "Zimbabwe: national", sourceTitle: "Official list", sourceUrl: "http://example.org" })).rejects.toBeInstanceOf(ValidationError);
    const cal = await createCalendar(admin, { countryCode: "ZW", name: "Zimbabwe: national", sourceTitle: "Official list", sourceUrl: "https://example.org/holidays" });
    await expect(setCalendarStatus(admin, cal.id, "verified")).rejects.toThrow(/Add the holidays/);
  });
});

describe("three kinds of country on one client", () => {
  beforeEach(resetDatabase);

  it("keeps nationality, residence, destination and operating country apart, across several applications", async () => {
    const veritas = await firmId("veritas");
    const consultant = await makeUser({ firms: { veritas: "immigration_consultant" } });
    const { lead: l } = await createLead(consultant, veritas, lead({ currentCountry: "ZA", destinationCountry: "AU" }));
    const { client } = await convertLead(consultant, veritas, l.id);
    await updateClient(consultant, veritas, client.id, { firstName: "Thandi", email: client.email, nationality: "ZW", countryOfResidence: "ZA", otherNationalities: "GB, zw" });
    const [row] = await owner.select().from(s.clients).where(eq(s.clients.id, client.id));
    expect([row.nationality, row.countryOfResidence, row.otherNationalities]).toEqual(["ZW", "ZA", ["GB"]]);
    await expect(updateClient(consultant, veritas, client.id, { firstName: "Thandi", email: client.email, otherNationalities: "QQ" })).rejects.toBeInstanceOf(ValidationError);

    const [pretoria] = await owner.select({ id: s.offices.id }).from(s.offices).innerJoin(s.firmOffices, eq(s.firmOffices.officeId, s.offices.id)).where(and(eq(s.firmOffices.firmId, veritas), eq(s.offices.country, "ZA")));
    const au = await createMatter(consultant, veritas, { clientId: client.id, title: "Skilled visa", jurisdiction: "AU", operatingOfficeId: pretoria.id });
    const nz = await createMatter(consultant, veritas, { clientId: client.id, title: "Study visa", jurisdiction: "NZ" });
    const auView = await getMatter(consultant, veritas, au.id);
    expect([auView.matter.jurisdiction, auView.matter.operatingCountry]).toEqual(["AU", "ZA"]);
    expect((await getMatter(consultant, veritas, nz.id)).matter.jurisdiction).toBe("NZ");

    // An office the practice doesn't use is refused.
    const [stranger] = await owner.insert(s.offices).values({ orgId: consultant.orgId, name: "Elsewhere", country: "GB", timezone: "Europe/London" }).returning();
    await expect(createMatter(consultant, veritas, { clientId: client.id, title: "Visit visa", jurisdiction: "GB", operatingOfficeId: stranger.id })).rejects.toThrow(/practice's offices/);
  });
});

describe("client-facing gate", () => {
  beforeEach(resetDatabase);

  it("won't send a proposal until its destination country is operational", async () => {
    const admin = await hub();
    const veritas = await firmId("veritas");
    const firmAdmin = await makeUser({ firms: { veritas: "firm_admin" } });
    const { lead: l } = await createLead(firmAdmin, veritas, lead({ destinationCountry: "AU" }));
    const catalogue = await listCatalogue(firmAdmin, veritas, { activeOnly: true });
    const p = await createProposalFromLead(firmAdmin, veritas, l.id, { serviceIds: [catalogue[0].id] });
    await submitForReview(firmAdmin, veritas, p.id);
    await approveProposal(firmAdmin, veritas, p.id);
    // The service is ZA, the lead's destination AU: both must be operational.
    await expect(releaseProposal(firmAdmin, veritas, p.id)).rejects.toThrow(/AU \(draft\), ZA \(draft\)|ZA \(draft\), AU \(draft\)/);
    await makeAuOperational(admin);
    await expect(releaseProposal(firmAdmin, veritas, p.id)).rejects.toThrow(/ZA \(draft\)/);
    await owner.update(s.countryProfiles).set({ status: "operational" }).where(eq(s.countryProfiles.code, "ZA"));
    const { url } = await releaseProposal(firmAdmin, veritas, p.id);
    expect(url).toContain("/p/");
  });

  it("accepts NZD and other launch currencies in amounts", () => {
    expect(parseMoney("NZ$ 1,200.50")).toBe(120_050);
    expect(parseMoney("NZD 900")).toBe(90_000);
    expect(parseMoney("A$300")).toBe(30_000);
  });
});

describe("practice-by-country checks", () => {
  beforeEach(resetDatabase);

  it("records what each practice has checked in each country; verified needs a reviewer and evidence", async () => {
    const admin = await hub();
    const veritas = await firmId("veritas");
    const firmAdmin = await makeUser({ firms: { veritas: "firm_admin" } });
    await expect(setCapability(firmAdmin, { firmId: veritas, countryCode: "AU", area: "payments", status: "pending" })).rejects.toBeInstanceOf(AccessDeniedError);
    await setCapability(admin, { firmId: veritas, countryCode: "AU", area: "payments", provider: "Stripe", status: "pending", note: "Awaiting test keys" });
    await expect(setCapability(admin, { firmId: veritas, countryCode: "ZA", area: "payments", provider: "Stripe", status: "verified" })).rejects.toThrow(/evidence/);
    await setCapability(admin, { firmId: veritas, countryCode: "ZA", area: "payments", provider: "Stripe", status: "verified", note: "Test payment of R1 received and reconciled on 21 Nov 2026" });
    // Updating replaces the cell rather than adding a second one.
    await setCapability(admin, { firmId: veritas, countryCode: "AU", area: "payments", provider: "Stripe", status: "unavailable", note: "Entity not registered in AU" });
    const m = await getCapabilityMatrix(admin);
    expect(m.cells.filter((c) => c.firmId === veritas).map((c) => [c.countryCode, c.status]).sort()).toEqual([["AU", "unavailable"], ["ZA", "verified"]]);
    expect(m.cells.find((c) => c.countryCode === "ZA")?.reviewedById).toBe(admin.user.id);
  });

  it("registers sources with effective dates and refuses an end before the start", async () => {
    const admin = await hub();
    await expect(saveSource(admin, null, { countryCode: "NZ", kind: "official_fees", title: "Fees", url: "https://www.immigration.govt.nz", effectiveFrom: "2026-07-01", effectiveTo: "2026-01-01" })).rejects.toBeInstanceOf(ValidationError);
    const src = await saveSource(admin, null, { countryCode: "NZ", kind: "official_fees", title: "Immigration fees", url: "https://www.immigration.govt.nz", effectiveFrom: "2026-07-01", ownerId: admin.user.id });
    const v = await setSourceStatus(admin, src.id, "verified");
    expect(v.reviewedById).toBe(admin.user.id);
    // Editing a verified source returns it to draft.
    const edited = await saveSource(admin, src.id, { countryCode: "NZ", kind: "official_fees", title: "Immigration fees (updated)", url: "https://www.immigration.govt.nz", effectiveFrom: "2026-07-01" });
    expect(edited.status).toBe("draft");
  });
});

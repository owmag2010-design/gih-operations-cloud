import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeeSchedule } from "../../src/server/modules/services/fee-schedule";
import { containsKeyword, decideRoute, type RuleLike } from "../../src/server/modules/intake/routing";

describe("fee schedule parser", () => {
  const parsed = parseFeeSchedule(readFileSync("data/config/fee-schedule-za-2026-10-20.md", "utf8"));

  it("reads every service with totals that reconcile", () => {
    expect(parsed).toHaveLength(46);
    expect(parsed.flatMap((p) => p.warnings)).toEqual([]);
  });

  it("applies the deposit and consultation rules", () => {
    const spouse = parsed.find((p) => p.name.startsWith("Section 11(6) spouse"))!;
    expect(spouse.totalMinor).toBe(1_925_000);
    expect(spouse.depositMinor).toBe(962_500);
    const consult = parsed.find((p) => p.name === "Consultation, 60 minutes")!;
    expect(consult.depositMinor).toBe(consult.totalMinor);
  });

  it("keeps add-ons out of the total", () => {
    const critical = parsed.find((p) => p.name.startsWith("Critical Skills"))!;
    expect(critical.totalMinor).toBe(1_885_000);
    expect(critical.addOns.map((a) => a.label)).toContain("SAQA evaluation");
    expect(critical.addOns.find((a) => a.label.startsWith("Professional body"))?.amountMinor).toBeNull();
  });
});

describe("routing engine", () => {
  const rules: RuleLike[] = [
    { id: "1", name: "legal", position: 1, isActive: true, match: { keywordsAny: ["ban", "appeal"] }, action: "route", targetFirmId: "M", flag: "legal_matter" },
    { id: "2", name: "inactive", position: 2, isActive: false, match: {}, action: "route", targetFirmId: "X", flag: null },
    { id: "3", name: "everything", position: 3, isActive: true, match: {}, action: "route", targetFirmId: "V", flag: null },
  ];

  it("matches whole words only", () => {
    expect(containsKeyword("My bank statement", "ban")).toBe(false);
    expect(containsKeyword("I have a 5-year ban.", "ban")).toBe(true);
    expect(containsKeyword("Business Visa please", "business visa")).toBe(true);
  });

  it("takes the first active match and carries flags", () => {
    expect(decideRoute(rules, { enquiry: "Appeal my refusal" })).toMatchObject({ firmId: "M", flags: ["legal_matter"] });
    expect(decideRoute(rules, { enquiry: "Bank statements for my visa" })).toMatchObject({ firmId: "V" });
    expect(decideRoute(rules, { enquiry: "" })).toMatchObject({ action: "hold", firmId: null });
  });
});

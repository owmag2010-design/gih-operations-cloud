import { describe, expect, it } from "vitest";
import { addBusinessDays, addCalendarDays, daysBetween, isIsoDate } from "../../src/server/modules/matters/dates";

describe("deadline date arithmetic", () => {
  it("validates calendar dates strictly", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-02-28")).toBe(false);
  });
  it("adds calendar days across month and year ends", () => {
    expect(addCalendarDays("2026-12-25", 10)).toBe("2027-01-04");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("skips weekends for business days", () => {
    // Friday 23 Oct 2026 + 1 business day = Monday 26 Oct
    expect(addBusinessDays("2026-10-23", 1)).toBe("2026-10-26");
    // Saturday start: first business day is Monday
    expect(addBusinessDays("2026-10-24", 1)).toBe("2026-10-26");
    expect(addBusinessDays("2026-10-26", 10)).toBe("2026-11-09");
    expect(addBusinessDays("2026-10-26", -1)).toBe("2026-10-23");
  });
  it("counts days between dates", () => {
    expect(daysBetween("2026-10-24", "2026-11-03")).toBe(10);
  });
});

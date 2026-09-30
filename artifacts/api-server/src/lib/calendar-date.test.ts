import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDaysToCalendarDate, clinicToday, toCalendarDateKey } from "./calendar-date";
import { computeScheduledDate } from "./followup-schedule";
import { localeDate } from "./locale";

const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Sao_Paulo"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("calendar dates (server in America/Sao_Paulo)", () => {
  it("does calendar arithmetic without timezone drift", () => {
    expect(addDaysToCalendarDate("2026-09-29", 42, "2000-01-01")).toBe("2026-11-10");
    expect(addDaysToCalendarDate("2026-09-29T00:00:00.000Z", 1, "2000-01-01")).toBe("2026-09-30");
    expect(addDaysToCalendarDate(null, 30, "2026-09-29")).toBe("2026-10-29");
    expect(addDaysToCalendarDate("2024-02-28", 1, "2000-01-01")).toBe("2024-02-29");
  });

  it("uses the clinic (São Paulo) calendar for today", () => {
    // 02:00 UTC on the 30th is still the 29th in São Paulo.
    expect(clinicToday(new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
    expect(clinicToday(new Date("2026-09-30T03:00:00Z"))).toBe("2026-09-30");
  });

  it("keys calendar values from either serialisation", () => {
    expect(toCalendarDateKey("2026-09-29")).toBe("2026-09-29");
    expect(toCalendarDateKey("2026-09-29T00:00:00.000Z")).toBe("2026-09-29");
    expect(toCalendarDateKey(new Date("2026-09-29T00:00:00.000Z"))).toBe("2026-09-29");
    expect(toCalendarDateKey("2026-02-30")).toBeNull();
    expect(toCalendarDateKey("29/09/2026")).toBeNull();
    expect(toCalendarDateKey(null)).toBeNull();
  });

  it("schedules surgical follow-ups on the right calendar day", () => {
    expect(computeScheduledDate("2026-09-29", 0)).toBe("2026-09-29");
    expect(computeScheduledDate("2026-09-29", 30)).toBe("2026-10-29");
    expect(computeScheduledDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(computeScheduledDate(null, 30)).toBeNull();
    expect(computeScheduledDate("not a date", 30)).toBeNull();
  });

  it("formats calendar dates in documents without shifting them", () => {
    expect(localeDate("2026-09-29", "pt-BR")).toBe("29/09/2026");
    expect(localeDate("2026-09-29", "es")).toBe("29/9/2026");
    expect(localeDate("not-a-date", "pt-BR")).toBe("");
  });
});

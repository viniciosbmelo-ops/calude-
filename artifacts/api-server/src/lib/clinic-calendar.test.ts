import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calendarAgeYears,
  clinicDayRange,
  clinicDayStart,
  clinicPeriodRange,
  clinicToday,
} from "./calendar-date";
import { localeDate } from "./locale";

/**
 * Server in UTC (as in production), clock at 23:30 in Brasília on 29/09/2026
 * = 02:30 UTC on 30/09/2026. Every "today" and every document issue date must
 * still be the clinic's 29/09/2026.
 */
const NIGHT_IN_BRASILIA = new Date("2026-09-29T23:30:00-03:00");
const originalTz = process.env.TZ;

beforeAll(() => { process.env.TZ = "UTC"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NIGHT_IN_BRASILIA);
});
afterEach(() => { vi.useRealTimers(); });

describe("clinic calendar at 23:30 BRT (02:30 UTC next day)", () => {
  it("the fake clock really is the next UTC day", () => {
    expect(new Date().toISOString()).toBe("2026-09-30T02:30:00.000Z");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("today is 2026-09-29 on the clinic calendar", () => {
    expect(clinicToday()).toBe("2026-09-29");
  });

  it("a document issued now shows 29/09/2026", () => {
    expect(localeDate(new Date(), "pt-BR")).toBe("29/09/2026");
    expect(localeDate(new Date(), "es")).toBe("29/9/2026");
    // Calendar dates are never shifted either.
    expect(localeDate("2026-09-29", "pt-BR")).toBe("29/09/2026");
  });

  it("the clinic day runs from 00:00 to 24:00 in Brasília and contains the 23:30 event", () => {
    const { start, end } = clinicDayRange(clinicToday());
    expect(start.toISOString()).toBe("2026-09-29T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-30T03:00:00.000Z");
    const event = new Date();
    expect(event >= start && event < end).toBe(true);
    expect(clinicDayStart("2026-09-30").getTime()).toBe(end.getTime());
  });

  it("report periods (day / Sunday–Saturday week / month) use the clinic calendar", () => {
    expect(clinicPeriodRange("dia")).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(clinicPeriodRange("semana")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(clinicPeriodRange("mes")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // Last day of the month at night: still that month, not the next one.
    expect(clinicPeriodRange("mes", new Date("2026-02-28T23:30:00-03:00"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("ages count the birthday on the clinic's today, not the UTC day", () => {
    expect(calendarAgeYears("1990-09-30", clinicToday())).toBe(35);
    expect(calendarAgeYears("1990-09-29", clinicToday())).toBe(36);
    expect(calendarAgeYears("not a date", clinicToday())).toBeNull();
  });
});

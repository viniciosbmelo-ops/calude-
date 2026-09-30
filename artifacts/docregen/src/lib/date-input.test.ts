import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  evaluateDateText,
  formatDisplayDate,
  isoToLocalDate,
  isValidCalendarDate,
  joinDateTime,
  localDateToIso,
  maskDateText,
  maskTimeText,
  normalizeIsoDate,
  parseDisplayDate,
  parseTimeText,
  splitDateTime,
} from "./date-input";

describe("date-input helpers (DD/MM/AAAA ↔ YYYY-MM-DD)", () => {
  it("runs in the Brazilian timezone", () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
  });

  it("masks digits progressively as DD/MM/AAAA", () => {
    expect(maskDateText("")).toBe("");
    expect(maskDateText("2")).toBe("2");
    expect(maskDateText("29")).toBe("29");
    expect(maskDateText("290")).toBe("29/0");
    expect(maskDateText("2909")).toBe("29/09");
    expect(maskDateText("29092")).toBe("29/09/2");
    expect(maskDateText("29092026")).toBe("29/09/2026");
    expect(maskDateText("290920261234")).toBe("29/09/2026");
    expect(maskDateText("29/09/2026")).toBe("29/09/2026");
    expect(maskDateText("ab29-09.2026x")).toBe("29/09/2026");
  });

  it("parses complete display dates into ISO", () => {
    expect(parseDisplayDate("29/09/2026")).toBe("2026-09-29");
    expect(parseDisplayDate("01/01/1950")).toBe("1950-01-01");
    expect(parseDisplayDate("29/09/26")).toBeNull();
    expect(parseDisplayDate("")).toBeNull();
  });

  it("validates real calendar dates (leap years, 30-day months)", () => {
    expect(parseDisplayDate("29/02/2024")).toBe("2024-02-29");
    expect(parseDisplayDate("29/02/2000")).toBe("2000-02-29");
    expect(parseDisplayDate("29/02/2026")).toBeNull();
    expect(parseDisplayDate("29/02/1900")).toBeNull();
    expect(parseDisplayDate("31/04/2026")).toBeNull();
    expect(parseDisplayDate("31/02/2026")).toBeNull();
    expect(parseDisplayDate("30/04/2026")).toBe("2026-04-30");
    expect(parseDisplayDate("00/01/2026")).toBeNull();
    expect(parseDisplayDate("01/13/2026")).toBeNull();
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(isValidCalendarDate(2026, 12, 31)).toBe(true);
    expect(isValidCalendarDate(999, 1, 1)).toBe(false);
  });

  it("formats ISO values for display and tolerates timestamps / garbage", () => {
    expect(formatDisplayDate("2026-09-29")).toBe("29/09/2026");
    expect(formatDisplayDate("2026-09-29T03:00:00.000Z")).toBe("29/09/2026");
    expect(formatDisplayDate("")).toBe("");
    expect(formatDisplayDate(null)).toBe("");
    expect(formatDisplayDate("2026-02-30")).toBe("");
    expect(normalizeIsoDate("not a date")).toBe("");
  });

  it("classifies partial typing without emitting a value", () => {
    expect(evaluateDateText("")).toEqual({ status: "empty", iso: "" });
    expect(evaluateDateText("2")).toEqual({ status: "partial", iso: "" });
    expect(evaluateDateText("29/0")).toEqual({ status: "partial", iso: "" });
    expect(evaluateDateText("29/09/202")).toEqual({ status: "partial", iso: "" });
    expect(evaluateDateText("29/09/2026")).toEqual({ status: "valid", iso: "2026-09-29" });
  });

  it("flags impossible prefixes early and invalid complete dates", () => {
    expect(evaluateDateText("32").status).toBe("invalid");
    expect(evaluateDateText("15/13").status).toBe("invalid");
    expect(evaluateDateText("31/04").status).toBe("invalid");
    expect(evaluateDateText("30/02").status).toBe("invalid");
    expect(evaluateDateText("29/02").status).toBe("partial"); // could still be a leap year
    expect(evaluateDateText("29/02/2027").status).toBe("invalid");
    expect(evaluateDateText("31/04/2026").status).toBe("invalid");
  });

  it("enforces inclusive min/max bounds", () => {
    expect(evaluateDateText("01/01/2026", "2026-01-01", "2026-12-31").status).toBe("valid");
    expect(evaluateDateText("31/12/2025", "2026-01-01").status).toBe("before-min");
    expect(evaluateDateText("01/01/2027", undefined, "2026-12-31").status).toBe("after-max");
  });

  it("round-trips calendar picks without a timezone shift", () => {
    const d = isoToLocalDate("2026-09-29")!;
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(8);
    expect(localDateToIso(d)).toBe("2026-09-29");
    expect(localDateToIso(new Date(2026, 1, 28, 23, 59))).toBe("2026-02-28");
    expect(isoToLocalDate("")).toBeUndefined();
  });

  it("masks and validates 24h times", () => {
    expect(maskTimeText("0930")).toBe("09:30");
    expect(maskTimeText("9")).toBe("9");
    expect(maskTimeText("235999")).toBe("23:59");
    expect(parseTimeText("23:59")).toBe("23:59");
    expect(parseTimeText("24:00")).toBeNull();
    expect(parseTimeText("12:60")).toBeNull();
    expect(parseTimeText("9:30")).toBeNull();
  });

  it("splits and joins datetime-local values", () => {
    expect(splitDateTime("2026-09-29T14:05")).toEqual({ date: "2026-09-29", time: "14:05" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
    expect(joinDateTime("2026-09-29", "14:05")).toBe("2026-09-29T14:05");
    expect(joinDateTime("2026-09-29", "")).toBe("2026-09-29T00:00");
    expect(joinDateTime("", "14:05")).toBe("");
  });
});

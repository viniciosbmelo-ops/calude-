import { describe, expect, it } from "vitest";
import { clinicTodayDateOnly, isDateOnlyOverdue } from "./utils";

describe("isDateOnlyOverdue (clinic timezone America/Sao_Paulo)", () => {
  // 2026-10-05 10:00 em São Paulo.
  const morning = new Date("2026-10-05T13:00:00Z");

  it("today is not overdue", () => {
    expect(isDateOnlyOverdue("2026-10-05", morning)).toBe(false);
  });

  it("yesterday is overdue", () => {
    expect(isDateOnlyOverdue("2026-10-04", morning)).toBe(true);
  });

  it("tomorrow is upcoming, not overdue", () => {
    expect(isDateOnlyOverdue("2026-10-06", morning)).toBe(false);
  });

  it("uses the São Paulo calendar day in the evening, when UTC is already tomorrow", () => {
    // 2026-10-05 22:30 em São Paulo = 2026-10-06 01:30 UTC.
    const evening = new Date("2026-10-06T01:30:00Z");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-06");
    expect(clinicTodayDateOnly(evening)).toBe("2026-10-05");
    expect(isDateOnlyOverdue("2026-10-05", evening)).toBe(false);
    expect(isDateOnlyOverdue("2026-10-04", evening)).toBe(true);
  });

  it("ignores empty or non date-only values", () => {
    expect(isDateOnlyOverdue(null, morning)).toBe(false);
    expect(isDateOnlyOverdue("", morning)).toBe(false);
    expect(isDateOnlyOverdue("not-a-date", morning)).toBe(false);
  });
});

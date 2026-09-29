import { describe, expect, it } from "vitest";
import {
  buildPromTimeline,
  calendarDateToNoonIso,
  formatPromTrend,
  promSeries,
  scheduleRowsForCase,
} from "./regen-case-detail";

describe("follow-up schedule is product-specific", () => {
  it("omits the 6-week HA review for PRP cases", () => {
    const periods = scheduleRowsForCase(["PRP"]).map((row) => row.periodo);
    expect(periods).not.toContain("6 semanas (HA)");
    expect(periods).toContain("6 meses ★");
  });

  it("includes it for hyaluronic acid (AH) cases", () => {
    expect(scheduleRowsForCase(["AH"]).map((row) => row.periodo)).toContain("6 semanas (HA)");
    expect(scheduleRowsForCase(["PRP", "ah"]).map((row) => row.periodo)).toContain("6 semanas (HA)");
  });

  it("keeps a period that already has a notification (older schedules)", () => {
    expect(scheduleRowsForCase(["PRP"], ["6 semanas (HA)"]).map((row) => row.periodo)).toContain("6 semanas (HA)");
  });
});

describe("PROM timeline", () => {
  const manual = [
    { id: 3, instrument: "VAS", timepoint: "3 meses", score: "3.00", answered_at: "2026-12-28T15:00:00.000Z" },
    { id: 1, instrument: "VAS", timepoint: "Pré-operatório / Basal", score: 8, answered_at: "2026-09-29T15:00:00.000Z" },
    { id: 2, instrument: "VAS", timepoint: "1 mês", score: "5", answered_at: "2026-10-29T15:00:00.000Z" },
    { id: 4, instrument: "VAS", timepoint: "6 meses", score: null, answered_at: "2027-03-29T15:00:00.000Z" },
  ];

  it("keeps every value in clinical order: 8 → 5 → 3", () => {
    const points = buildPromTimeline(manual);
    expect(points.map((p) => p.score)).toEqual([8, 5, 3]);
    const [series] = promSeries(points);
    expect(series).toMatchObject({ instrument: "VAS", values: [8, 5, 3], first: 8, last: 3, delta: -5 });
    expect(formatPromTrend(series!.values)).toBe("8 → 5 → 3");
  });

  it("merges patient follow-up answers under the same instrument", () => {
    const points = buildPromTimeline(manual, [
      {
        id: "n6", periodo: "6 meses ★", days_after_procedure: 180, scheduled_date: "2027-03-28",
        responses: [{ nome_escala: "VAS Dor", score: "2", completado_em: "2027-03-30T12:00:00Z" }],
      },
    ]);
    expect(points.map((p) => [p.instrument, p.score, p.source])).toEqual([
      ["VAS", 8, "manual"], ["VAS", 5, "manual"], ["VAS", 3, "manual"], ["VAS", 2, "followup"],
    ]);
    expect(promSeries(points)[0]!.values).toEqual([8, 5, 3, 2]);
  });
});

describe("procedure date input", () => {
  it("stores a date input at local noon so it stays on the same calendar day", () => {
    const iso = calendarDateToNoonIso("2026-09-29")!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 9, 29, 12]);
    expect(calendarDateToNoonIso("")).toBeUndefined();
    expect(calendarDateToNoonIso("29/09/2026")).toBeUndefined();
  });
});

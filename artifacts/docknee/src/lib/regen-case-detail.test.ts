import { describe, expect, it } from "vitest";
import {
  assessPromChange,
  buildPromTimeline,
  calendarDateToNoonIso,
  formatPromTrend,
  promDirection,
  promScaleMax,
  promSeries,
  scheduleRowsForCase,
} from "./regen-case-detail";

describe("follow-up schedule mirrors the API", () => {
  it("lists every checkpoint the API schedules, including the 6-week review", () => {
    const periods = scheduleRowsForCase(["PRP"]).map((row) => row.periodo);
    expect(periods).toEqual([
      "Pré-op (Baseline)", "1 mês", "6 semanas (HA)", "3 meses", "6 meses ★", "12 meses", "24 meses", "4 anos",
    ]);
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

describe("PROM change direction", () => {
  it("VAS falling is an improvement; other scores rising is an improvement", () => {
    expect(promDirection("VAS")).toBe("lower");
    expect(promDirection("VAS Dor")).toBe("lower");
    expect(promDirection("SANE Ombro")).toBe("higher");
    expect(assessPromChange("lower", -5)).toBe("better");
    expect(assessPromChange("lower", 2)).toBe("worse");
    expect(assessPromChange("higher", 10)).toBe("better");
    expect(assessPromChange("higher", -10)).toBe("worse");
    expect(assessPromChange("higher", 0)).toBe("same");
    expect(promScaleMax("VAS")).toBe(10);
    expect(promScaleMax("ASES")).toBe(100);
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

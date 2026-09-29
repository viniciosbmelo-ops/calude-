import { describe, expect, it } from "vitest";
import {
  KNEE_PERFORMANCE_MEASURES,
  KNEE_TESTS_BY_CONDITION,
  SANE_KNEE_SCALE,
  assessChange,
  isKneeCondition,
  kneeRecommendation,
  performanceChartRows,
  performanceGroups,
  performanceInputError,
  performancePoints,
  promDirection,
} from "./regen-knee-measures";
import { REGEN_CONDITION_CATALOG } from "./regen-conditions";
import { buildPromTimeline, promSeries, scheduleRowsForCase } from "./regen-case-detail";
import { regenKneeMessages } from "@/locales/regen-knee";
// The API owns the follow-up schedule; both sides must agree on knee scales.
import * as apiKnee from "../../../docregen-api/src/lib/regen-knee-measures";
import * as apiSchedule from "../../../docregen-api/src/lib/regen-followup-schedule";

const KNEE = REGEN_CONDITION_CATALOG.filter((c) => c.region === "joelho").map((c) => c.code);

describe("knee condition → recommended measures", () => {
  it("covers every knee condition with VAS + SANE-joelho", () => {
    expect(Object.keys(KNEE_TESTS_BY_CONDITION).sort()).toEqual([...KNEE].sort());
    for (const code of KNEE) {
      expect(kneeRecommendation(code)?.proms).toEqual(["VAS", "SANE_JOELHO"]);
    }
    expect(kneeRecommendation("OA_QUADRIL")).toBeNull();
    expect(kneeRecommendation(undefined)).toBeNull();
  });

  it("OA KL1–4 and patellar chondropathy get the full OARSI set + ROM", () => {
    const full = ["CHAIR_STAND_30S", "WALK_40M", "TUG", "STAIR_CLIMB", "KNEE_FLEXION", "KNEE_EXTENSION_DEFICIT"];
    for (const code of ["OA_JOELHO_KL1", "OA_JOELHO_KL2", "OA_JOELHO_KL3", "OA_JOELHO_KL4", "CONDROPATIA_PATELAR"]) {
      expect([...kneeRecommendation(code)!.tests].sort()).toEqual([...full].sort());
    }
  });

  it("meniscal: ROM + TUG + chair stand; patellar tendinopathy: chair stand + stair", () => {
    expect([...kneeRecommendation("LESAO_MENISCAL_DEGENERATIVA")!.tests].sort()).toEqual(
      ["CHAIR_STAND_30S", "KNEE_EXTENSION_DEFICIT", "KNEE_FLEXION", "TUG"],
    );
    expect([...kneeRecommendation("TENDINOPATIA_PATELAR")!.tests].sort()).toEqual(["CHAIR_STAND_30S", "STAIR_CLIMB"]);
  });

  it("agrees with the API on which conditions are knee and on the follow-up scale name", () => {
    expect(SANE_KNEE_SCALE).toBe(apiKnee.SANE_KNEE_SCALE);
    for (const c of REGEN_CONDITION_CATALOG) expect(isKneeCondition(c.code), c.code).toBe(apiKnee.isKneeCondition(c.code));
  });

  it("the case schedule mirrors the API: knee slots ask VAS + SANE Joelho", () => {
    const web = scheduleRowsForCase(["PRP"], [], true).map((r) => [r.periodo, r.scales]);
    const api = apiSchedule.regenFollowupScheduleFor(["PRP"], "OA_JOELHO_KL3").map((r) => [r.periodo, r.scales]);
    expect(web).toEqual(api);
    expect(scheduleRowsForCase(["PRP"]).every((r) => r.scales.join() === "VAS Dor")).toBe(true);
  });
});

describe("direction of improvement", () => {
  it("per test: time lower = better, repetitions/flexion higher = better, extension deficit lower = better", () => {
    const dir = Object.fromEntries(KNEE_PERFORMANCE_MEASURES.map((m) => [m.code, m.better]));
    expect(dir).toEqual({
      CHAIR_STAND_30S: "higher", WALK_40M: "lower", TUG: "lower", STAIR_CLIMB: "lower",
      KNEE_FLEXION: "higher", KNEE_EXTENSION_DEFICIT: "lower",
    });
  });

  it("PROMs: VAS lower = better, SANE higher = better", () => {
    expect(promDirection("VAS")).toBe("lower");
    expect(promDirection("SANE Joelho")).toBe("higher");
    expect(assessChange(promDirection("SANE Joelho"), 30)).toBe("better");
    expect(assessChange(promDirection("VAS"), 3)).toBe("worse");
  });

  it("merges manual SANE_JOELHO and follow-up 'SANE Joelho' into one series", () => {
    const points = buildPromTimeline(
      [{ id: 1, instrument: "SANE_JOELHO", timepoint: "Pré-operatório / Basal", score: 40, answered_at: "2026-01-10T15:00:00Z" }],
      [{ id: "n", periodo: "3 meses", days_after_procedure: 90, responses: [{ nome_escala: "SANE Joelho", score: "70", completado_em: "2026-04-10T15:00:00Z" }] }],
    );
    expect(promSeries(points)).toEqual([expect.objectContaining({ instrument: "SANE Joelho", values: [40, 70], delta: 30 })]);
  });
});

describe("performance test series", () => {
  const rows = [
    { id: 4, measure: "TUG", timepoint: "3 meses", value: "9.10", unit: "s", measured_at: "2026-04-10T15:00:00Z" },
    { id: 1, measure: "TUG", timepoint: "Pré-operatório / Basal", value: "12.40", unit: "s", measured_at: "2026-01-10T15:00:00Z" },
    { id: 2, measure: "KNEE_FLEXION", timepoint: "Pré-operatório / Basal", side: "D", value: "100", unit: "deg", measured_at: "2026-01-10T15:00:00Z" },
    { id: 3, measure: "KNEE_FLEXION", timepoint: "Pré-operatório / Basal", side: "E", value: "130", unit: "deg", measured_at: "2026-01-10T15:00:00Z" },
    { id: 5, measure: "KNEE_FLEXION", timepoint: "3 meses", side: "D", value: "118", unit: "deg", measured_at: "2026-04-10T15:00:00Z" },
    { id: 6, measure: "CHAIR_STAND_30S", timepoint: "Pré-operatório / Basal", value: 8, unit: "rep", measured_at: "2026-01-10T15:00:00Z" },
    { id: 7, measure: "CHAIR_STAND_30S", timepoint: "3 meses", value: 6, unit: "rep", measured_at: "2026-04-10T15:00:00Z" },
    { id: 8, measure: "WALK_40M", timepoint: "3 meses", value: 25, unit: "s", details: { speed_mps: 1.6 }, measured_at: "2026-04-10T15:00:00Z" },
    { id: 9, measure: "KOOS", timepoint: "3 meses", value: 50, unit: "pts", measured_at: "2026-04-10T15:00:00Z" },
  ];

  it("groups per measure in catalog order, per side for ROM, ignoring unknown measures", () => {
    const groups = performanceGroups(rows);
    expect(groups.map((g) => g.def.code)).toEqual(["CHAIR_STAND_30S", "WALK_40M", "TUG", "KNEE_FLEXION"]);
    const tug = groups.find((g) => g.def.code === "TUG")!.series[0]!;
    expect(tug).toMatchObject({ side: null, baseline: 12.4, last: 9.1, change: -3.3, assessment: "better" });
    const chair = groups.find((g) => g.def.code === "CHAIR_STAND_30S")!.series[0]!;
    expect(chair).toMatchObject({ change: -2, assessment: "worse" });
    const flex = groups.find((g) => g.def.code === "KNEE_FLEXION")!.series;
    expect(flex.map((s) => [s.side, s.change, s.assessment])).toEqual([["D", 18, "better"], ["E", 0, "same"]]);
  });

  it("chart rows keep one unit per measure and one column per side", () => {
    const flex = performanceGroups(rows).find((g) => g.def.code === "KNEE_FLEXION")!;
    expect(performanceChartRows(flex, (tp) => tp)).toEqual([
      { label: "Pré-operatório / Basal", D: 100, E: 130 },
      { label: "3 meses", D: 118 },
    ]);
    const walk = performanceGroups(rows).find((g) => g.def.code === "WALK_40M")!;
    expect(walk.series[0]!.points[0]!.speedMps).toBe(1.6);
  });

  it("keeps insertion order for ties (id 9 before id 10)", () => {
    const tie = [
      { id: 10, measure: "TUG", timepoint: "3 meses", value: 9, unit: "s", measured_at: "2026-04-10T15:00:00Z" },
      { id: 9, measure: "CHAIR_STAND_30S", timepoint: "3 meses", value: 12, unit: "rep", measured_at: "2026-04-10T15:00:00Z" },
    ];
    expect(performancePoints(tie).map((p) => p.id)).toEqual(["9", "10"]);
  });

  it("validates form input like the API", () => {
    expect(performanceInputError("TUG", "", "", "")).toBe("value");
    expect(performanceInputError("TUG", "0.5", "", "")).toBe("range");
    expect(performanceInputError("TUG", "9,5", "", "")).toBeNull();
    expect(performanceInputError("CHAIR_STAND_30S", "7.5", "", "")).toBe("integer");
    expect(performanceInputError("CHAIR_STAND_30S", "61", "", "")).toBe("range");
    expect(performanceInputError("KNEE_FLEXION", "110", "", "")).toBe("side");
    expect(performanceInputError("KNEE_EXTENSION_DEFICIT", "-5", "E", "")).toBeNull();
    expect(performanceInputError("STAIR_CLIMB", "14", "", "0")).toBe("steps");
    expect(performanceInputError("STAIR_CLIMB", "14", "", "11")).toBeNull();
  });
});

describe("labels", () => {
  it("every measure has pt-BR and es labels; catalogs have the same keys", () => {
    expect(Object.keys(regenKneeMessages.es).sort()).toEqual(Object.keys(regenKneeMessages["pt-BR"]).sort());
    for (const m of KNEE_PERFORMANCE_MEASURES) {
      expect(regenKneeMessages["pt-BR"][`measure_${m.code}` as keyof typeof regenKneeMessages["pt-BR"]]).toBeTruthy();
    }
    expect(regenKneeMessages["pt-BR"].measure_CHAIR_STAND_30S).toBe("Sentar e levantar em 30 s");
    expect(regenKneeMessages["pt-BR"].better_lower).toContain("menor é melhor");
    expect(regenKneeMessages.es.saneKnee).toBe("SANE-rodilla");
    expect(regenKneeMessages["pt-BR"].referenceNote).toContain("Dobson");
  });
});

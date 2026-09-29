/**
 * Knee outcome measures in DocRegen, without licensed questionnaires:
 * - SANE-joelho (patient PROM, 0–100 % of a normal knee) + VAS for every knee case;
 * - OARSI recommended physical performance tests (Dobson et al., Osteoarthritis
 *   Cartilage 2013;21(8):1042-52) + knee ROM, measured by the clinician.
 * Definitions, ranges, units and direction of improvement come from
 * @workspace/clinical/knee-function (shared with the API). Pure — unit-tested.
 */
import {
  KNEE_PERFORMANCE_BY_CODE,
  KNEE_PERFORMANCE_MEASURES,
  SANE_KNEE_CODE,
  assessChange,
  type ChangeAssessment,
  type ImprovementDirection,
  type KneePerformanceDef,
  type KneePerformanceMeasure,
} from "@workspace/clinical/knee-function";
import { REGEN_CONDITION_CATALOG } from "./regen-conditions";
import { timepointOrder } from "./regen-case-detail";

export { KNEE_PERFORMANCE_MEASURES, KNEE_PERFORMANCE_BY_CODE, SANE_KNEE_CODE, assessChange };
export type { ChangeAssessment, ImprovementDirection, KneePerformanceDef, KneePerformanceMeasure };

/** Follow-up (patient link) scale name — mirrors the API. */
export const SANE_KNEE_SCALE = "SANE Joelho";

const KNEE_CODES = new Set(REGEN_CONDITION_CATALOG.filter((c) => c.region === "joelho").map((c) => c.code));

export function isKneeCondition(code: string | null | undefined): boolean {
  return !!code && KNEE_CODES.has(code);
}

const OA_SET: readonly KneePerformanceMeasure[] = [
  "CHAIR_STAND_30S", "WALK_40M", "TUG", "STAIR_CLIMB", "KNEE_FLEXION", "KNEE_EXTENSION_DEFICIT",
];

/** Performance tests recommended per knee condition (all knee cases also get VAS + SANE-joelho). */
export const KNEE_TESTS_BY_CONDITION: Readonly<Record<string, readonly KneePerformanceMeasure[]>> = {
  OA_JOELHO_KL1: OA_SET,
  OA_JOELHO_KL2: OA_SET,
  OA_JOELHO_KL3: OA_SET,
  OA_JOELHO_KL4: OA_SET,
  CONDROPATIA_PATELAR: OA_SET,
  LESAO_MENISCAL_DEGENERATIVA: ["KNEE_FLEXION", "KNEE_EXTENSION_DEFICIT", "TUG", "CHAIR_STAND_30S"],
  TENDINOPATIA_PATELAR: ["CHAIR_STAND_30S", "STAIR_CLIMB"],
};

export interface KneeRecommendation {
  proms: readonly string[];
  tests: readonly KneePerformanceMeasure[];
}

/** Recommended measures for a case, or null when the condition is not a knee condition. */
export function kneeRecommendation(conditionCode: string | null | undefined): KneeRecommendation | null {
  if (!isKneeCondition(conditionCode)) return null;
  return { proms: ["VAS", SANE_KNEE_CODE], tests: KNEE_TESTS_BY_CONDITION[conditionCode!] ?? [] };
}

// ─── PROM direction ─────────────────────────────────────────────────────────

/** VAS: lower = better (pain). SANE: higher = better (% of normal). */
export function promDirection(instrument: string): ImprovementDirection {
  return /^sane/i.test(instrument.trim()) ? "higher" : "lower";
}

// ─── Performance-test timeline ──────────────────────────────────────────────

export interface PerformanceTestRow {
  id: number | string;
  measure: string;
  timepoint: string;
  side?: string | null;
  value: number | string;
  unit: string;
  details?: { steps?: number; speed_mps?: number } | null;
  measured_at: string;
}

export interface PerformancePoint {
  id: string;
  measure: KneePerformanceMeasure;
  side: "D" | "E" | null;
  timepoint: string;
  order: number;
  date: string;
  value: number;
  unit: string;
  steps?: number;
  speedMps?: number;
}

export interface PerformanceSeries {
  side: "D" | "E" | null;
  points: PerformancePoint[];
  baseline: number;
  last: number;
  change: number;
  assessment: ChangeAssessment;
}

export interface PerformanceMeasureGroup {
  def: KneePerformanceDef;
  series: PerformanceSeries[];
}

function time(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** Valid rows as points, ordered by timepoint, then measurement date. */
export function performancePoints(rows: readonly PerformanceTestRow[]): PerformancePoint[] {
  const out: PerformancePoint[] = [];
  for (const row of rows) {
    const def = KNEE_PERFORMANCE_BY_CODE.get(row.measure);
    const value = typeof row.value === "number" ? row.value : Number(row.value);
    if (!def || !Number.isFinite(value)) continue;
    out.push({
      id: String(row.id),
      measure: def.code,
      side: row.side === "D" || row.side === "E" ? row.side : null,
      timepoint: row.timepoint,
      order: timepointOrder(row.timepoint),
      date: row.measured_at,
      value,
      unit: row.unit,
      steps: row.details?.steps,
      speedMps: row.details?.speed_mps,
    });
  }
  return out.sort((a, b) => a.order - b.order || time(a.date) - time(b.date) || a.id.localeCompare(b.id));
}

/**
 * One group per measure (catalog order), one series per side for ROM.
 * Change = last − baseline, assessed with the measure's direction.
 */
export function performanceGroups(rows: readonly PerformanceTestRow[]): PerformanceMeasureGroup[] {
  const points = performancePoints(rows);
  const groups: PerformanceMeasureGroup[] = [];
  for (const def of KNEE_PERFORMANCE_MEASURES) {
    const own = points.filter((p) => p.measure === def.code);
    if (!own.length) continue;
    const sides: ("D" | "E" | null)[] = def.perSide ? ["D", "E"] : [null];
    const series: PerformanceSeries[] = [];
    for (const side of sides) {
      const list = own.filter((p) => p.side === side);
      if (!list.length) continue;
      const baseline = list[0]!.value;
      const last = list[list.length - 1]!.value;
      const change = Math.round((last - baseline) * 100) / 100;
      series.push({ side, points: list, baseline, last, change, assessment: assessChange(def.better, change) });
    }
    groups.push({ def, series });
  }
  return groups;
}

/** Chart rows for one measure: one row per timepoint, one column per side ("value" | "D" | "E"). */
export function performanceChartRows(
  group: PerformanceMeasureGroup,
  labelFor: (timepoint: string) => string,
): Array<Record<string, string | number>> {
  const rows = new Map<string, Record<string, string | number> & { _order: number }>();
  for (const series of group.series) {
    for (const point of series.points) {
      const key = `${point.order}|${point.timepoint}`;
      const row = rows.get(key) ?? { label: labelFor(point.timepoint), _order: point.order };
      // Later measurements at the same timepoint replace earlier ones in the chart.
      row[series.side ?? "value"] = point.value;
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .sort((a, b) => a._order - b._order)
    .map(({ _order, ...row }) => row);
}

/** Client-side check mirroring the API (range, integer, side). Returns an error key or null. */
export function performanceInputError(
  measure: KneePerformanceMeasure,
  rawValue: string,
  side: string,
  rawSteps: string,
): "value" | "integer" | "range" | "side" | "steps" | null {
  const def = KNEE_PERFORMANCE_BY_CODE.get(measure)!;
  if (rawValue.trim() === "") return "value";
  const value = Number(rawValue.replace(",", "."));
  if (!Number.isFinite(value)) return "value";
  if (def.integer && !Number.isInteger(value)) return "integer";
  if (value < def.min || value > def.max) return "range";
  if (def.perSide && side !== "D" && side !== "E") return "side";
  if (measure === "STAIR_CLIMB" && rawSteps.trim() !== "") {
    const steps = Number(rawSteps);
    if (!Number.isInteger(steps) || steps < 1 || steps > 100) return "steps";
  }
  return null;
}

/**
 * Knee outcome measures for DocRegen (no licensed questionnaires):
 * SANE-joelho (patient PROM, 0–100) and the OARSI recommended physical
 * performance tests + knee ROM (clinician-measured). Definitions, ranges and
 * direction of improvement live in @workspace/clinical/knee-function.
 */
import {
  KNEE_PERFORMANCE_BY_CODE,
  KNEE_PERFORMANCE_MEASURES,
  SANE_KNEE_CODE,
} from "@workspace/clinical/knee-function";
import { REGEN_CONDITION_CATALOG } from "./regen-conditions";
import { SANE_RESEARCH_KEYS } from "./regen-sane";

/** Follow-up (patient link) scale name for SANE-joelho; persisted in regen_scale_responses.nome_escala. */
export const SANE_KNEE_SCALE = "SANE Joelho";

const KNEE_CODES = new Set(
  REGEN_CONDITION_CATALOG.filter((condition) => condition.region === "joelho").map((condition) => condition.code),
);

export function isKneeCondition(code: unknown): boolean {
  return typeof code === "string" && KNEE_CODES.has(code);
}

/** Same instrument under both naming schemes (manual "SANE_JOELHO", follow-up "SANE Joelho"). */
export function isSaneKneeInstrument(name: unknown): boolean {
  return name === SANE_KNEE_CODE || name === SANE_KNEE_SCALE;
}

export interface MeasurePoint {
  key: string;
  value: number;
  at: string | Date | null;
}

export interface MeasureChange {
  baseline: number;
  last: number;
  change: number;
}

/**
 * Research/report column keys: one SANE per body region ("sane_ombro",
 * "sane_joelho", …) plus each knee test (ROM split by side D/E).
 */
export const RESEARCH_MEASURE_KEYS: readonly string[] = [
  ...SANE_RESEARCH_KEYS,
  ...KNEE_PERFORMANCE_MEASURES.flatMap((m) =>
    m.perSide ? [`${m.code.toLowerCase()}_d`, `${m.code.toLowerCase()}_e`] : [m.code.toLowerCase()],
  ),
];

export function performanceResearchKey(measure: string, side: string | null | undefined): string | null {
  const def = KNEE_PERFORMANCE_BY_CODE.get(measure);
  if (!def) return null;
  if (!def.perSide) return def.code.toLowerCase();
  return side === "D" || side === "E" ? `${def.code.toLowerCase()}_${side.toLowerCase()}` : null;
}

function time(at: string | Date | null): number {
  const ms = at == null ? NaN : new Date(at).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** Baseline (earliest) → last (latest) per key, with change = last − baseline. */
export function baselineToLast(points: readonly MeasurePoint[]): Record<string, MeasureChange> {
  const byKey = new Map<string, MeasurePoint[]>();
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    const list = byKey.get(point.key) ?? [];
    list.push(point);
    byKey.set(point.key, list);
  }
  const out: Record<string, MeasureChange> = {};
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => time(a.at) - time(b.at));
    const baseline = sorted[0]!.value;
    const last = sorted[sorted.length - 1]!.value;
    out[key] = { baseline, last, change: Math.round((last - baseline) * 100) / 100 };
  }
  return out;
}

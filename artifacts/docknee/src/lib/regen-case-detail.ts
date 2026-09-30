/**
 * Pure helpers behind the regenerative case detail tabs (procedures, PROMs,
 * follow-up schedule). Kept free of React so they are unit-tested.
 */

// ─── Follow-up schedule (mirrors api-server routes/regen.ts REGEN_FOLLOWUP_SCHEDULE) ───

export interface RegenScheduleRow {
  periodo: string;
  days: number;
  scales: string[];
  /** Only for cases using one of these products (e.g. the 6-week HA review). */
  products?: readonly string[];
}

export const REGEN_SCHEDULE_META: readonly RegenScheduleRow[] = [
  { periodo: "Pré-op (Baseline)", days: 0, scales: ["VAS Dor"] },
  { periodo: "1 mês", days: 30, scales: ["VAS Dor"] },
  // DocKnee's API schedules this checkpoint for every regenerative case.
  { periodo: "6 semanas (HA)", days: 42, scales: ["VAS Dor"] },
  { periodo: "3 meses", days: 90, scales: ["VAS Dor"] },
  { periodo: "6 meses ★", days: 180, scales: ["VAS Dor"] },
  { periodo: "12 meses", days: 365, scales: ["VAS Dor"] },
  { periodo: "24 meses", days: 730, scales: ["VAS Dor"] },
  { periodo: "4 anos", days: 1460, scales: ["VAS Dor"] },
];

/**
 * Schedule rows that apply to a case. Product-specific rows are shown only
 * when the case uses the product — or when a notification for that period
 * already exists (older schedules created before this rule).
 */
export function scheduleRowsForCase(
  productCodes: Iterable<string | null | undefined>,
  existingPeriods: Iterable<string> = [],
): RegenScheduleRow[] {
  const used = new Set<string>();
  for (const code of productCodes) if (code) used.add(code.toUpperCase());
  const existing = new Set(existingPeriods);
  return REGEN_SCHEDULE_META.filter(
    (row) => !row.products || row.products.some((code) => used.has(code)) || existing.has(row.periodo),
  );
}

// ─── PROMs ──────────────────────────────────────────────────────────────────

export interface ManualPromResponse {
  id: number | string;
  instrument: string;
  timepoint: string;
  score?: number | string | null;
  answered_at: string;
}

export interface FollowupNotificationLike {
  id: string;
  periodo: string;
  days_after_procedure?: number | null;
  scheduled_date?: string | null;
  responses?: Array<{ nome_escala: string; score: number | string | null; completado_em?: string | null }> | null;
}

export interface PromPoint {
  key: string;
  instrument: string;
  timepoint: string;
  /** Days after the procedure used to order points in the same instrument. */
  order: number;
  date: string | null;
  score: number;
  source: "manual" | "followup";
}

/** Same instrument under both naming schemes ("VAS" manual, "VAS Dor" follow-up). */
export function normalizePromInstrument(name: string): string {
  const trimmed = name.trim();
  if (/^(vas|eva)(\s+(dor|dolor))?$/i.test(trimmed)) return "VAS";
  return trimmed;
}

const TIMEPOINT_DAYS: Record<string, number> = {
  "Pré-operatório / Basal": 0,
  "Pré-op (Baseline)": 0,
  "Pré-operatório": 0,
  preop: 0,
  "1 mês": 30,
  "30 dias": 30,
  "6 semanas": 42,
  "6 semanas (HA)": 42,
  "3 meses": 90,
  "90 dias": 90,
  "6 meses": 180,
  "6 meses ★": 180,
  "180 dias": 180,
  "12 meses": 365,
  "1 ano": 365,
  "24 meses": 730,
  "2 anos": 730,
  "4 anos": 1460,
};

export function timepointOrder(timepoint: string, fallbackDays?: number | null): number {
  const known = TIMEPOINT_DAYS[timepoint] ?? TIMEPOINT_DAYS[timepoint.replace(" ★", "")];
  if (known !== undefined) return known;
  return typeof fallbackDays === "number" ? fallbackDays : Number.MAX_SAFE_INTEGER;
}

function toScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Every PROM value recorded for a case — manual entries and patient
 * follow-up answers — ordered by timepoint, then date. Nothing is collapsed:
 * a case with VAS 8 → 5 → 3 yields three points.
 */
export function buildPromTimeline(
  manual: readonly ManualPromResponse[],
  notifications: readonly FollowupNotificationLike[] = [],
): PromPoint[] {
  const points: PromPoint[] = [];
  for (const prom of manual) {
    const score = toScore(prom.score);
    if (score === null) continue;
    points.push({
      key: `m-${prom.id}`,
      instrument: normalizePromInstrument(prom.instrument),
      timepoint: prom.timepoint,
      order: timepointOrder(prom.timepoint),
      date: prom.answered_at ?? null,
      score,
      source: "manual",
    });
  }
  for (const notif of notifications) {
    for (const [index, response] of (notif.responses ?? []).entries()) {
      const score = toScore(response?.score);
      if (!response || score === null) continue;
      points.push({
        key: `f-${notif.id}-${index}`,
        instrument: normalizePromInstrument(response.nome_escala),
        timepoint: notif.periodo,
        order: timepointOrder(notif.periodo, notif.days_after_procedure),
        date: response.completado_em ?? notif.scheduled_date ?? null,
        score,
        source: "followup",
      });
    }
  }
  const time = (value: string | null) => {
    const ms = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
  };
  return points.sort((a, b) => a.order - b.order || time(a.date) - time(b.date) || a.key.localeCompare(b.key));
}

export interface PromSeries {
  instrument: string;
  values: number[];
  first: number;
  last: number;
  delta: number;
}

export function promSeries(points: readonly PromPoint[]): PromSeries[] {
  const byInstrument = new Map<string, number[]>();
  for (const point of points) {
    const list = byInstrument.get(point.instrument) ?? [];
    list.push(point.score);
    byInstrument.set(point.instrument, list);
  }
  return [...byInstrument.entries()].map(([instrument, values]) => ({
    instrument,
    values,
    first: values[0]!,
    last: values[values.length - 1]!,
    delta: values[values.length - 1]! - values[0]!,
  }));
}

/** Direction of improvement: VAS/EVA is pain (lower = better); other scores higher = better. */
export type ImprovementDirection = "lower" | "higher";
export type ChangeAssessment = "better" | "worse" | "same";

export function promDirection(instrument: string): ImprovementDirection {
  return /^(vas|eva)\b/i.test(instrument.trim()) ? "lower" : "higher";
}

/** Axis maximum for an instrument: VAS is 0–10, other scores 0–100. */
export function promScaleMax(instrument: string): number {
  return /^(vas|eva)\b/i.test(instrument.trim()) ? 10 : 100;
}

/** Whether a change (last − first) is an improvement for that direction. */
export function assessPromChange(direction: ImprovementDirection, delta: number): ChangeAssessment {
  if (!Number.isFinite(delta) || delta === 0) return "same";
  const improved = direction === "lower" ? delta < 0 : delta > 0;
  return improved ? "better" : "worse";
}

/** "8 → 5 → 3" (numbers in the given locale). */
export function formatPromTrend(values: readonly number[], locale = "pt-BR"): string {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return values.map((value) => fmt.format(value)).join(" → ");
}

/**
 * Chart rows: one row per point in timeline order, one numeric column per
 * instrument, so every recorded value is plotted (no per-timepoint collapse).
 */
export function promChartRows(points: readonly PromPoint[], labelFor: (point: PromPoint) => string) {
  return points.map((point) => ({ label: labelFor(point), [point.instrument]: point.score }));
}

// ─── Procedures ─────────────────────────────────────────────────────────────

/** Converts a date input value (YYYY-MM-DD) to an ISO instant at local noon. */
export function calendarDateToNoonIso(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Non-empty biologic technical-sheet entries, in insertion order. */
export function biologicDetailEntries(details: unknown): Array<[string, string]> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key, value]) => [key, String(value)]);
}

/**
 * Regenerative follow-up schedule.
 *
 * The base schedule applies to every regenerative case. Product-specific
 * checkpoints are added only when the case actually uses that product: the
 * 6-week hyaluronic-acid review ("6 semanas (HA)") belongs to viscosupplement
 * cases and must never appear for PRP-only (or other biologic) cases.
 */
import { SANE_INSTRUMENT_NAMES, SANE_SCALES, saneForCase, type SaneRegionDef } from "./regen-sane";

export type RegenFollowupSlot = {
  periodo: string;
  days: number;
  scales: string[];
  /** When set, the slot is scheduled only if the case uses one of these product codes. */
  products?: readonly string[];
};

export const HYALURONIC_ACID_PRODUCT_CODES = ["AH"] as const;

export const REGEN_FOLLOWUP_SCHEDULE: readonly RegenFollowupSlot[] = [
  { periodo: "Pré-op (Baseline)", days: 0, scales: ["VAS Dor"] },
  { periodo: "1 mês", days: 30, scales: ["VAS Dor"] },
  { periodo: "6 semanas (HA)", days: 42, scales: ["VAS Dor"], products: HYALURONIC_ACID_PRODUCT_CODES },
  { periodo: "3 meses", days: 90, scales: ["VAS Dor"] },
  { periodo: "6 meses ★", days: 180, scales: ["VAS Dor"] },
  { periodo: "12 meses", days: 365, scales: ["VAS Dor"] },
  { periodo: "24 meses", days: 730, scales: ["VAS Dor"] },
  { periodo: "4 anos", days: 1460, scales: ["VAS Dor"] },
];

/**
 * Follow-up slots that apply to a case using the given product codes. Cases
 * with a region SANE (the condition's region, or — for conditions without a
 * region — the single region of all application sites; see `saneForCase`)
 * also ask the patient that SANE single question at every slot (VAS + e.g.
 * SANE Joelho / SANE Ombro); otherwise VAS only.
 */
export function regenFollowupScheduleFor(
  productCodes: Iterable<string | null | undefined>,
  conditionCode?: string | null,
  productDetails?: unknown,
): RegenFollowupSlot[] {
  const used = new Set<string>();
  for (const code of productCodes) {
    if (typeof code === "string" && code.trim()) used.add(code.trim().toUpperCase());
  }
  const sane = saneForCase(conditionCode, productDetails);
  return REGEN_FOLLOWUP_SCHEDULE.filter(
    (slot) => !slot.products || slot.products.some((code) => used.has(code)),
  ).map((slot) => (sane ? { ...slot, scales: [...slot.scales, sane.scale] } : slot));
}

/**
 * Scales the patient answers through the regen follow-up link: the ones any
 * schedule can produce (VAS Dor, plus the region SANE — "SANE Joelho",
 * "SANE Ombro", "SANE Quadril", "SANE Cotovelo", "SANE Tornozelo e Pé",
 * "SANE Punho e Mão", "SANE Coluna"). Licensed or
 * retired instruments (KOOS, WOMAC, IKDC, ASES, DASH…) are never accepted;
 * rows already stored under old names are left untouched and still displayed.
 */
export const REGEN_PATIENT_SCALES: ReadonlySet<string> = new Set([
  ...REGEN_FOLLOWUP_SCHEDULE.flatMap((slot) => slot.scales),
  ...SANE_SCALES,
]);

export function isRegenPatientScale(scale: unknown): scale is string {
  return typeof scale === "string" && REGEN_PATIENT_SCALES.has(scale);
}

/** Legacy notifications may list retired scales: never ask the patient for them. */
export function filterRegenPatientScales(scales: readonly unknown[] | null | undefined): string[] {
  return [...new Set((scales ?? []).filter(isRegenPatientScale))];
}

const SANE_SCALE_SET: ReadonlySet<string> = new Set(SANE_SCALES);

/**
 * Scales a follow-up actually asks, computed from the case's current data at
 * read time (no migration): the stored scales (filtered), plus the case's
 * region SANE when the stored list has no SANE yet — e.g. an "outras"
 * condition scheduled before its application site mapped to a region. Only
 * current-format rows (with "VAS Dor") are extended, and a completed
 * follow-up is never reopened.
 */
export function effectiveRegenPatientScales(
  storedScales: readonly unknown[] | null | undefined,
  status: unknown,
  sane: SaneRegionDef | null,
): string[] {
  const scales = filterRegenPatientScales(storedScales);
  if (!sane || status === "completed" || !scales.includes("VAS Dor")
    || scales.some((scale) => SANE_SCALE_SET.has(scale))) return scales;
  return [...scales, sane.scale];
}

/**
 * Instruments the physician can record manually on a regen case (case page
 * PROM form): VAS and the region SANEs, each under either spelling
 * ("SANE_OMBRO" / "SANE Ombro"; stored under the manual code).
 */
export const REGEN_PROM_INSTRUMENTS = ["VAS", ...SANE_INSTRUMENT_NAMES] as [string, ...string[]];

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Adds `days` to a calendar date ("YYYY-MM-DD") without any timezone math.
 * Invalid or missing input falls back to `today` (also a calendar date).
 */
export function addDaysToCalendarDate(baseDate: string | null | undefined, days: number, today: string): string {
  const match = DATE_ONLY_RE.exec((baseDate ?? "").trim().slice(0, 10)) ?? DATE_ONLY_RE.exec(today);
  if (!match) throw new Error("invalid calendar date");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/** Today's calendar date ("YYYY-MM-DD") on the clinic calendar (America/Sao_Paulo). */
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Normalises a client value for a PostgreSQL `date` column into a calendar
 * date string ("YYYY-MM-DD"), independent of the server timezone.
 *
 * Never pass `new Date("YYYY-MM-DD")` to a `date` column: that is midnight
 * UTC, node-postgres serialises it in the server's local time and PostgreSQL
 * keeps the local day, so a server west of UTC (America/Sao_Paulo) stores the
 * previous day.
 *
 * - null/undefined/"" → null (no date);
 * - "YYYY-MM-DD" (a real calendar day) → as is;
 * - a full ISO timestamp → its day on the clinic calendar (America/Sao_Paulo);
 * - anything else → undefined (invalid: the caller answers 400).
 */
export function calendarDateParam(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = DATE_ONLY_RE.exec(trimmed);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const utc = new Date(Date.UTC(year, month - 1, day));
    const valid = utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
    return valid ? trimmed : undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return undefined;
  const instant = new Date(trimmed);
  return Number.isNaN(instant.getTime()) ? undefined : clinicToday(instant);
}

/**
 * Instant for a timestamp column from a client value: a bare calendar date
 * ("YYYY-MM-DD") becomes noon of that day on the clinic calendar
 * (America/Sao_Paulo, UTC−03:00, no DST since 2019), so it never renders as
 * the previous day; any other parseable value is used as the instant it is.
 */
export function instantParam(value: string): Date {
  const trimmed = value.trim();
  if (DATE_ONLY_RE.test(trimmed) && calendarDateParam(trimmed)) return new Date(`${trimmed}T12:00:00-03:00`);
  return new Date(trimmed);
}

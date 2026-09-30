/**
 * Calendar-date helpers (PostgreSQL `date` columns, clinic "today").
 *
 * The DocKnee pool returns `date` columns as "YYYY-MM-DD" strings (see
 * @workspace/db). These helpers keep every comparison and arithmetic on those
 * values as pure calendar math, independent of the server timezone.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CALENDAR_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

/** Clinic timezone: DocKnee clinics are in Brazil. */
export const CLINIC_TIME_ZONE = "America/Sao_Paulo";

/** Today's calendar date ("YYYY-MM-DD") on the clinic calendar (America/Sao_Paulo). */
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * "YYYY-MM-DD" key of a calendar-date value, or null. Accepts the raw string
 * ("2026-09-29"), a serialised timestamp of a date-only value
 * ("2026-09-29T00:00:00.000Z" → its Y/M/D prefix) and a Date (its UTC day, as
 * node-postgres produced them before the pool returned raw strings).
 */
export function toCalendarDateKey(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const match = CALENDAR_PREFIX_RE.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

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

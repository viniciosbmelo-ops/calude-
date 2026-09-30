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

/** Wall-clock offset (ms) of the clinic timezone at `instant` (local − UTC). */
function clinicOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a clinic calendar day ("YYYY-MM-DD") starts, i.e.
 * 00:00 in America/Sao_Paulo — independent of the server timezone.
 */
export function clinicDayStart(day: string): Date {
  const key = toCalendarDateKey(day);
  if (!key) throw new Error("invalid calendar date");
  const [year, month, date] = key.split("-").map(Number) as [number, number, number];
  const midnightAsUtc = Date.UTC(year, month - 1, date);
  const offset = clinicOffsetMs(new Date(midnightAsUtc));
  const candidate = midnightAsUtc - offset;
  const offsetAtCandidate = clinicOffsetMs(new Date(candidate));
  return new Date(offsetAtCandidate === offset ? candidate : midnightAsUtc - offsetAtCandidate);
}

/** [start, end) instants of a clinic calendar day. */
export function clinicDayRange(day: string): { start: Date; end: Date } {
  return { start: clinicDayStart(day), end: clinicDayStart(addDaysToCalendarDate(day, 1, day)) };
}

/** Day of week (0 = Sunday) of a calendar date ("YYYY-MM-DD"). */
export function calendarWeekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/**
 * Inclusive calendar-date range ("YYYY-MM-DD") of the clinic's current day,
 * week (Sunday–Saturday) or month.
 */
export function clinicPeriodRange(
  period: "dia" | "semana" | "mes",
  now: Date = new Date(),
): { from: string; to: string } {
  const today = clinicToday(now);
  if (period === "dia") return { from: today, to: today };
  if (period === "semana") {
    const from = addDaysToCalendarDate(today, -calendarWeekday(today), today);
    return { from, to: addDaysToCalendarDate(from, 6, from) };
  }
  const [year, month] = today.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = today.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

/** Whole years between a birth date and `today` (both calendar dates), or null. */
export function calendarAgeYears(birthDate: unknown, today: string): number | null {
  const dob = toCalendarDateKey(birthDate);
  if (!dob) return null;
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

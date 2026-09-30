/**
 * Helpers for the DD/MM/AAAA date field (DateInput) and the 24h HH:MM time
 * field (TimeInput). The public value contract is always the same one the
 * native inputs used — `YYYY-MM-DD` for dates, `HH:MM` for times and
 * `YYYY-MM-DDTHH:MM` for date+time — so forms and APIs don't change; only the
 * text the user sees/types is DD/MM/AAAA (independent of the browser locale).
 *
 * Everything here is pure string/number math: no `Date` parsing, so the result
 * never shifts a day with the timezone.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True for a real calendar date (31/02 and 29/02 on non-leap years are not). */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** Normalises a `YYYY-MM-DD` string (also accepts a full ISO timestamp prefix); "" when not a real date. */
export function normalizeIsoDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = ISO_DATE_RE.exec(String(value).slice(0, 10));
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isValidCalendarDate(y, mo, d) ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** Keeps only digits and formats them progressively as DD/MM/AAAA ("2909" → "29/09"). */
export function maskDateText(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** "29/09/2026" → "2026-09-29"; null when incomplete or not a real calendar date. */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidCalendarDate(y, mo, d)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "2026-09-29" → "29/09/2026"; "" for empty/invalid input. */
export function formatDisplayDate(iso: string | null | undefined): string {
  const n = normalizeIsoDate(iso);
  if (!n) return "";
  const [y, mo, d] = n.split("-");
  return `${d}/${mo}/${y}`;
}

export type DateTextStatus = "empty" | "partial" | "invalid" | "before-min" | "after-max" | "valid";

/**
 * Classifies the typed text. "partial" = still typing (fewer than 8 digits),
 * "invalid" = complete but not a real date (31/04, 29/02/2027…).
 */
export function evaluateDateText(text: string, min?: string, max?: string): { status: DateTextStatus; iso: string } {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0) return { status: "empty", iso: "" };
  if (digits.length < 8) {
    // Catch impossible prefixes early (day 32+, month 13+) so the field flags them while typing.
    const day = digits.length >= 2 ? Number(digits.slice(0, 2)) : null;
    const month = digits.length >= 4 ? Number(digits.slice(2, 4)) : null;
    if ((day !== null && (day < 1 || day > 31)) || (month !== null && (month < 1 || month > 12))) {
      return { status: "invalid", iso: "" };
    }
    if (day !== null && month !== null && day > daysInMonth(2000, month)) {
      return { status: "invalid", iso: "" };
    }
    return { status: "partial", iso: "" };
  }
  const iso = parseDisplayDate(maskDateText(digits));
  if (!iso) return { status: "invalid", iso: "" };
  const lo = normalizeIsoDate(min);
  const hi = normalizeIsoDate(max);
  if (lo && iso < lo) return { status: "before-min", iso };
  if (hi && iso > hi) return { status: "after-max", iso };
  return { status: "valid", iso };
}

/** Local-calendar `Date` (midnight) for a `YYYY-MM-DD` string — for the calendar widget only. */
export function isoToLocalDate(iso: string | null | undefined): Date | undefined {
  const n = normalizeIsoDate(iso);
  if (!n) return undefined;
  const [y, mo, d] = n.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

/** `Date` picked in the calendar → `YYYY-MM-DD` using its local calendar fields (no UTC shift). */
export function localDateToIso(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------------------------------------------------------------- time (24h)

/** Keeps only digits and formats them as HH:MM ("0930" → "09:30"). */
export function maskTimeText(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** "09:30" → "09:30"; null when incomplete or out of 00:00–23:59. */
export function parseTimeText(text: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  if (h > 23 || mi > 59) return null;
  return `${m[1]}:${m[2]}`;
}

/** Normalises "HH:MM" / "HH:MM:SS" to "HH:MM"; "" when invalid. */
export function normalizeTime(value: string | null | undefined): string {
  if (!value) return "";
  return parseTimeText(String(value).slice(0, 5)) ?? "";
}

/** Splits a datetime-local style value ("YYYY-MM-DDTHH:MM") into its parts. */
export function splitDateTime(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [d = "", t = ""] = String(value).split("T");
  return { date: normalizeIsoDate(d), time: normalizeTime(t) };
}

/** Joins date + time into a datetime-local style value; "" unless both are set (time defaults to 00:00). */
export function joinDateTime(date: string, time: string): string {
  const d = normalizeIsoDate(date);
  if (!d) return "";
  return `${d}T${normalizeTime(time) || "00:00"}`;
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Uppercases only the first character of a display string (locale-aware), so
 * long dates read "Segunda-feira, 28 de setembro" instead of CSS `capitalize`
 * title-casing every word ("… 28 De Setembro").
 */
export function capitalizeFirst(value: string, locale?: string): string {
  if (!value) return value;
  const first = String.fromCodePoint(value.codePointAt(0)!);
  return first.toLocaleUpperCase(locale) + value.slice(first.length);
}

/** Returns a calendar date in the user's local timezone, suitable for date inputs and API date fields. */
export function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a calendar-only "YYYY-MM-DD" string as a LOCAL date (midnight in the
 * browser timezone). `new Date("2026-09-28")` is UTC midnight per the ECMAScript
 * spec, which renders as 27/09/2026 in America/Sao_Paulo; this avoids that.
 * Returns null for anything that is not a valid date-only string.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const match = DATE_ONLY_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Converts a display value to a Date, treating date-only strings as local
 * calendar dates and everything else (timestamps, numbers, Dates) as before.
 */
export function toDisplayDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const dateOnly = parseDateOnly(value);
    if (dateOnly) return dateOnly;
  }
  return new Date(value);
}

/**
 * Formats a date-only value ("YYYY-MM-DD") for display without timezone
 * shifting. Defaults to dd/mm/yyyy in pt-BR and es. Returns `fallback` for
 * empty or unparseable input.
 */
export function formatDateOnly(
  value: Date | string | number | null | undefined,
  locale = "pt-BR",
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
  fallback = "",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const date = toDisplayDate(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

const ptBrNameCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});
const ptBrAccentTieCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "accent",
});

/**
 * Compares display names using Portuguese collation, ignoring case while
 * keeping accent-aware ordering deterministic for otherwise equal names.
 */
export function comparePtBrNames(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  if (!a && b) return 1;
  if (a && !b) return -1;
  return ptBrNameCollator.compare(a, b) || ptBrAccentTieCollator.compare(a, b);
}

export function sortByPtBrName<T>(
  items: readonly T[],
  getName: (item: T) => string | null | undefined,
  getTieBreaker?: (item: T) => string | number | null | undefined,
): T[] {
  return [...items].sort((a, b) => {
    const byName = comparePtBrNames(getName(a), getName(b));
    if (byName !== 0) return byName;
    if (!getTieBreaker) return 0;
    return String(getTieBreaker(a) ?? "").localeCompare(
      String(getTieBreaker(b) ?? ""),
      "pt-BR",
      { numeric: true, sensitivity: "base" },
    );
  });
}

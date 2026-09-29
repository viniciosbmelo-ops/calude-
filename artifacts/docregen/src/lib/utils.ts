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

const CALENDAR_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

/**
 * Parses a value that is KNOWN to be a calendar date (birth date, case date,
 * follow-up scheduled date, lab collection date…) into a local Date for that
 * same calendar day. Accepts "YYYY-MM-DD" and serialised timestamps of a
 * date-only column ("2026-09-29T00:00:00.000Z"), always using the Y/M/D parts
 * and never `new Date(iso)` (which shifts the day west of UTC). Date objects
 * keep their local calendar day. Returns null for empty or invalid input.
 */
export function parseCalendarDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value !== "string") return null;
  const match = CALENDAR_PREFIX_RE.exec(value.trim());
  if (!match) return null;
  return parseDateOnly(`${match[1]}-${match[2]}-${match[3]}`);
}

/** "YYYY-MM-DD" key of a calendar-date value (either serialisation), or null. */
export function toCalendarDateKey(value: Date | string | null | undefined): string | null {
  const date = parseCalendarDate(value);
  return date ? formatLocalDate(date) : null;
}

/**
 * The one formatter for calendar dates in DocRegen: dd/mm/yyyy in pt-BR/es by
 * default, never shifted by the browser timezone, never throws — returns
 * `fallback` ("—" by default) for empty or invalid input.
 */
export function formatCalendarDate(
  value: Date | string | null | undefined,
  locale = "pt-BR",
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
  fallback = "—",
): string {
  const date = parseCalendarDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return fallback;
  }
}

/**
 * Formats an instant (timestamp) or date for display without ever throwing.
 * Date-only strings are treated as calendar dates (see toDisplayDate).
 */
export function safeFormatDate(
  value: Date | string | number | null | undefined,
  locale = "pt-BR",
  options?: Intl.DateTimeFormatOptions,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    const date = toDisplayDate(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return fallback;
  }
}

const NAME_PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "del", "la", "y"]);

/**
 * Display casing for person names typed in any case ("MARIA DA SILVA" →
 * "Maria da Silva"), keeping Portuguese/Spanish particles lowercase except
 * as the first word. Hyphenated and apostrophe parts are capitalised too.
 */
export function formatPersonName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      if (index > 0 && NAME_PARTICLES.has(word)) return word;
      return word.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
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

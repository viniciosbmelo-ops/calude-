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

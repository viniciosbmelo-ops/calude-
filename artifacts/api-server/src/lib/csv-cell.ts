/**
 * Escape a value for safe inclusion in a CSV cell.
 *
 * - Wraps in double-quotes and escapes internal double-quotes per RFC 4180.
 * - Replaces control characters (CR, LF, tab…) with spaces to prevent newline smuggling.
 * - Spreadsheet formula injection (CWE-1236): a text value starting with `=`, `+`, `-`, `@`, tab or CR is
 *   prefixed with `'`, so Excel/LibreOffice/Sheets show it as text instead of evaluating it. Quoting alone does
 *   not stop evaluation. Numbers (typeof number) are never formulas and are left as is.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const prefix = typeof value === "string" && FORMULA_START.test(raw) ? "'" : "";
  const s = (prefix + raw)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/"/g, '""');
  return `"${s}"`;
}

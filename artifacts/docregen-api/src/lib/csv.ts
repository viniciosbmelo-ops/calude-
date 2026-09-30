/**
 * CSV helpers shared by every DocRegen export (LGPD portability, research).
 *
 * - RFC 4180 quoting when needed (comma, quote, leading/trailing space),
 *   internal quotes doubled;
 * - control characters (CR/LF/tab…) replaced by spaces — no row smuggling;
 * - spreadsheet formula injection: a cell starting with = + - @ (or a
 *   tab/CR, already stripped) is prefixed with an apostrophe so Excel/Sheets
 *   treat it as text. Plain negative numbers stay numeric.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let s = String(value).replace(/[\x00-\x1F\x7F]/g, " ");
  if (/^[=+\-@]/.test(s) && !/^-?\d+(?:[.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[",]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: ReadonlyArray<string | number | boolean | null | undefined>): string {
  return values.map(csvCell).join(",");
}

/** CSV document with CRLF line endings and a UTF-8 BOM (Excel). */
export function csvDocument(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return "﻿" + [header.map(csvCell).join(","), ...rows.map(csvRow)].join("\r\n");
}

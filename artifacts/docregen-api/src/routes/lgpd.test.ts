/**
 * Tests for the CSV helper shared by the LGPD portability export and the
 * research export (lib/csv.ts): RFC 4180 escaping, control-character
 * stripping and spreadsheet formula-injection protection.
 * Route behaviour is covered by lgpd-integration.test.ts.
 */
import { describe, it, expect } from "vitest";
import { csvCell, csvDocument, csvRow } from "../lib/csv";

describe("csvCell safety", () => {
  it("leaves plain values unquoted and quotes when needed", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("escapes double-quotes per RFC 4180", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("replaces newline, carriage return and tab characters", () => {
    for (const value of ["value\nwith\nnewlines", "a\rb", "a\tb"]) {
      const result = csvCell(value);
      expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
    }
    expect(csvCell("value\nwith\nnewlines")).toBe("value with newlines");
  });

  it("neutralizes spreadsheet formulas (=, +, -, @) with a leading apostrophe", () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
    expect(csvCell("\t=1")).toBe('" =1"'); // leading tab → space: not a formula, quoted for the space
  });

  it("keeps numbers (including negative) numeric", () => {
    expect(csvCell(42)).toBe("42");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(-3.3)).toBe("-3.3");
    expect(csvCell("-3.3")).toBe("-3.3");
  });

  it("returns empty string for null / undefined / non-finite", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("CSV documents", () => {
  it("round-trips names with commas and quotes", () => {
    const name = 'Silva, João "Zé" da';
    const cell = csvCell(name);
    expect(cell).toBe('"Silva, João ""Zé"" da"');
    expect(cell.slice(1, -1).replace(/""/g, '"')).toBe(name);
  });

  it("rows never bleed into each other and the document has a BOM + CRLF", () => {
    const doc = csvDocument(["a", "b"], [["x\r\ny", 1], ["=evil", null]]);
    expect(doc.startsWith("﻿")).toBe(true);
    const lines = doc.slice(1).split("\r\n");
    expect(lines).toEqual(["a,b", "x  y,1", "'=evil,"]);
    expect(csvRow([true, false])).toBe("true,false");
  });
});

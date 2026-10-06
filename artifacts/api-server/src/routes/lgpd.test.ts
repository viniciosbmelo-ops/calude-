/**
 * Tests for LGPD route helper functions — covers:
 *   - csvCell: safe escaping (RFC 4180 + control char stripping)
 *   - format validation logic
 *
 * Full route integration tests require a DB and are excluded here.
 */
import { describe, it, expect } from "vitest";

import { csvCell } from "../lib/csv-cell";

describe("csvCell safety", () => {
  it("wraps values in double quotes", () => {
    expect(csvCell("hello")).toBe('"hello"');
  });

  it("escapes double-quotes per RFC 4180", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("strips newline characters (formula injection prevention)", () => {
    const result = csvCell("value\nwith\nnewlines");
    expect(result).not.toContain("\n");
    expect(result).toBe('"value with newlines"');
  });

  it("strips carriage returns", () => {
    const result = csvCell("value\rwith\rCR");
    expect(result).not.toContain("\r");
  });

  it("strips tab characters", () => {
    const result = csvCell("val\twith\ttabs");
    expect(result).not.toContain("\t");
  });

  it("prevents CSV formula injection (=, +, -, @, tab, CR) with a leading apostrophe", () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe(`"'=cmd|' /C calc'!A0"`);
    expect(csvCell("+1+1")).toBe(`"'+1+1"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("\t=1")).toBe(`"' =1"`);
    expect(csvCell("\r=1")).toBe(`"' =1"`);
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const v of ["=1", "+1", "-1", "@a", "\t1", "\r1"]) {
      expect(csvCell(v)).not.toMatch(/[\x00-\x1F\x7F]/);
      expect(csvCell(v).startsWith(`"'`)).toBe(true);
    }
  });

  it("leaves safe text and numbers untouched", () => {
    expect(csvCell("Paciente = ok")).toBe('"Paciente = ok"');
    expect(csvCell("a-b")).toBe('"a-b"');
    expect(csvCell(-5)).toBe('"-5"');
  });

  it("returns empty string for null", () => {
    expect(csvCell(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(csvCell(undefined)).toBe("");
  });

  it("handles numeric values", () => {
    expect(csvCell(42)).toBe('"42"');
  });

  it("handles zero", () => {
    expect(csvCell(0)).toBe('"0"');
  });
});

describe("LGPD CSV format", () => {
  it("generates a valid CSV with proper header columns", () => {
    // Simulate what the route produces
    const header = "TIPO,ID,DESCRICAO,DATA,STATUS,DADO_EXTRA";
    const row = [
      csvCell("paciente"),
      csvCell(1),
      csvCell("João da Silva"),
      csvCell("2024-01-15T00:00:00.000Z"),
      csvCell("ativo"),
      csvCell(""),
    ].join(",");
    const csv = [header, row].join("\r\n");

    expect(csv).toContain("TIPO,ID,DESCRICAO,DATA,STATUS,DADO_EXTRA");
    expect(csv).toContain('"paciente"');
    expect(csv).toContain('"João da Silva"');
  });

  it("handles patient names with commas safely", () => {
    const name = 'Silva, João "Zé" da';
    const cell = csvCell(name);
    // Should be quoted and internal quotes doubled
    expect(cell).toBe('"Silva, João ""Zé"" da"');
    // Parsing the cell manually (unwrap quotes, unescape "")
    const inner = cell.slice(1, -1).replace(/""/g, '"');
    expect(inner).toBe(name);
  });

  it("multiple surgery rows do not bleed into each other", () => {
    const surgeries = [
      { id: 1, tiposProcedimento: ["LCA", "menisco"], dataCirurgia: "2023-05-01", status: "completo", patientId: 10, createdAt: new Date("2023-05-01") },
      { id: 2, tiposProcedimento: ["LCP"], dataCirurgia: null, status: "rascunho", patientId: 11, createdAt: new Date("2023-06-15") },
    ];
    const rows = surgeries.map(s =>
      [
        csvCell("cirurgia"),
        csvCell(s.id),
        csvCell((s.tiposProcedimento ?? []).join("|")),
        csvCell(s.dataCirurgia ?? s.createdAt.toISOString()),
        csvCell(s.status),
        csvCell(`pacienteId=${s.patientId}`),
      ].join(",")
    );
    expect(rows[0]).toContain('"LCA|menisco"');
    expect(rows[1]).toContain('"LCP"');
    expect(rows).toHaveLength(2);
  });
});

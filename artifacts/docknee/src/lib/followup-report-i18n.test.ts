import { afterEach, describe, expect, it, vi } from "vitest";
import { exportPdf, generateInsights, interpretFollowupScale } from "@/components/followup-report";
import { followupAuthoredText, followupPeriodText, followupReportText } from "@/locales/followup-report";

describe("Spanish follow-up report localization", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("localizes score interpretation without changing thresholds", () => {
    expect(interpretFollowupScale("ikdc", 86, "es")).toEqual({
      rating: "excellent",
      text: "Excelente — función de la rodilla completamente recuperada",
    });
    expect(interpretFollowupScale("vasDor", 7, "es")?.text).toContain("atención inmediata (≥7)");
  });

  it("localizes clinical insights while preserving measured scores", () => {
    const insights = generateInsights(
      { ikdc: 50, vasDor: 8 },
      { ikdc: 60, vasDor: 4 },
      "6 meses",
      ["LCA"],
      "es",
    ).map(({ text }) => text);

    expect(insights).toContain("Empeoramiento del dolor: VAS subió de 4 a 8. Investigar la causa (artrofibrosis, lesión asociada, infección).");
    expect(insights).toContain("Descenso del IKDC de 10.0 puntos. Controlar e investigar la causa del empeoramiento.");
    expect(insights.some((text) => text.includes("Evaluación a los 6 meses"))).toBe(true);
  });

  it("provides authored Spanish report headings, ranges, and actions", () => {
    expect(followupReportText("es", "assessedScales")).toBe("Escalas evaluadas — Contextualización por período");
    expect(followupReportText("es", "referencePeriod", { period: "6 meses" })).toBe("Referencia (6 meses)");
    expect(followupReportText("es", "failureRecorded", { detail: ": traumática" })).toBe("Fallo/nueva rotura registrado: traumática.");
    expect(followupAuthoredText("es", "0–3 (dor residual leve)")).toBe("0–3 (dolor residual leve)");
    expect(followupPeriodText("es", "1 ano")).toBe("1 año");
    expect(followupPeriodText("es", "control especial")).toBe("control especial");
    expect(followupReportText("es", "internalFootnote")).toContain("Este documento es de uso clínico interno.");
  });

  it("generates Spanish report HTML while preserving clinical and patient values", () => {
    vi.useFakeTimers();
    let html = "";
    const print = vi.fn();
    vi.stubGlobal("window", {
      open: () => ({
        document: { write: (value: string) => { html = value; }, close: vi.fn() },
        focus: vi.fn(),
        print,
      }),
    });

    exportPdf(
      { id: 1, tempo: "1 ano", ikdc: 50, vasDor: 7 },
      null,
      [{ id: 1, tempo: "1 ano", ikdc: 50, vasDor: 7 }],
      { patientNome: "Ana Silva", ligamentosAcometidos: ["LCA"] },
      "es",
    );
    vi.runAllTimers();

    expect(html).toContain("Escalas evaluadas — Contextualización por período");
    expect(html).toContain("Referencia (1 año)");
    expect(html).toContain("Dolor intenso (VAS ≥ 7)");
    expect(html).toContain("<strong>Paciente:</strong> Ana Silva");
    expect(html).not.toContain("Dentro do esperado");
    expect(print).toHaveBeenCalledOnce();
  });
});
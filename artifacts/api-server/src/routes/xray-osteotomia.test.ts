/**
 * Regression tests for the osteotomy recommendation ("padrao") logic.
 *
 * Bug report: for a mixed valgus deformity where the femoral component (mLDFA)
 * deviates more from normal than the tibial component (aMPTA), applying the
 * FULL correction to either bone alone overshoots the normal range on both —
 * so neither isolated technique passes its strict viability check, and the
 * app silently defaulted to recommending the TIBIAL option (array index 0)
 * regardless of which bone the deformity actually came from.
 *
 * The <5 mm threshold depends on the cortical base marked in Etapa 4. It must
 * not be inferred from the server's angular shortcut, which can incorrectly
 * replace a double-level recommendation with an isolated osteotomy.
 */
import { describe, it, expect } from "vitest";
import { computeOpcoesOsteotomia } from "./xray.js";

describe("computeOpcoesOsteotomia — recommendation before Miniaci measurement", () => {
  it("prefers DFO only for femoral valgus even when total HKA correction makes it non-viable", () => {
    const opcoes = computeOpcoesOsteotomia({
      eixoMecanico: { graus: 10.5, desvio: "Valgo" },
      mLDFA: { valor: 83.7 },
      aMPTA: { valor: 90 },
      JLCA: { valor: 4 },
    }, 0, 50);

    const padroes = opcoes.filter((o) => o.padrao === true);
    expect(padroes).toHaveLength(1);
    expect(padroes[0].id).toBe("dfo_fechamento_medial");
    expect(padroes[0].viavel).toBe(false);
    expect(padroes[0].alertas).toContainEqual(expect.stringMatching(/mLDFA pós-op .*acima de 90/));
    expect(opcoes.find((o) => String(o.id).startsWith("hto"))?.padrao).toBe(false);
    expect(opcoes.find((o) => String(o.id).startsWith("dupla"))?.padrao).toBe(false);
  });

  it("treats 84° and 90° as normal inclusive", () => {
    const femoralOnly = computeOpcoesOsteotomia({
      eixoMecanico: { graus: 6, desvio: "Varo" },
      mLDFA: { valor: 83.9 },
      aMPTA: { valor: 90 },
      JLCA: { valor: 0 },
    }, 0, 50);
    const tibialOnly = computeOpcoesOsteotomia({
      eixoMecanico: { graus: 6, desvio: "Valgo" },
      mLDFA: { valor: 84 },
      aMPTA: { valor: 90.1 },
      JLCA: { valor: 0 },
    }, 0, 50);

    expect(femoralOnly.find((o) => o.padrao === true)?.id).toBe("dfo");
    expect(tibialOnly.find((o) => o.padrao === true)?.id).toBe("hto_fechamento_medial");
  });

  it("keeps double osteotomy when the femoral component is larger", () => {
    const analysis: Record<string, unknown> = {
      eixoMecanico: { graus: 13.2, desvio: "Valgo" },
      mLDFA: { valor: 80.4 },
      aMPTA: { valor: 91.4 },
      JLCA: { valor: 0 },
    };

    const opcoes = computeOpcoesOsteotomia(analysis, 1.4, 55);
    const recomendada = opcoes.find((o) => o.padrao === true);

    expect(recomendada).toBeDefined();
    expect(recomendada?.id).toBe("dupla");
  });

  it("recommends isolated tibial osteotomy when the femur remains normal", () => {
    const analysis: Record<string, unknown> = {
      eixoMecanico: { graus: 13.2, desvio: "Valgo" },
      mLDFA: { valor: 85.0 }, // within the inclusive normal range
      aMPTA: { valor: 95.0 }, // large tibial deviation (8°)
      JLCA: { valor: 0 },
    };

    const opcoes = computeOpcoesOsteotomia(analysis, 1.4, 55);
    const recomendada = opcoes.find((o) => o.padrao === true);

    expect(recomendada).toBeDefined();
    expect(recomendada?.id).toBe("hto_fechamento_medial");
  });

  it("still recommends the isolated tibial correction when it is genuinely sufficient (no fallback needed)", () => {
    // Mild, purely tibial valgus — HTO isolated should legitimately pass viability.
    const analysis: Record<string, unknown> = {
      eixoMecanico: { graus: 6, desvio: "Valgo" },
      mLDFA: { valor: 87 }, // normal femur
      aMPTA: { valor: 93 },
      JLCA: { valor: 0 },
    };

    const opcoes = computeOpcoesOsteotomia(analysis, 0, 50);
    const recomendada = opcoes.find((o) => o.padrao === true);

    expect(recomendada).toBeDefined();
    expect(recomendada?.id).toBe("hto_fechamento_medial");
  });

  it("keeps double osteotomy preferred when only the angular estimate is below 5 mm", () => {
    // The tibial share is ~4.5° (the old 1°≈1 mm shortcut marked it as
    // <5 mm), but the actual Miniaci value is calculated later from the
    // cortical base marked in Etapa 4. The server must not disqualify double
    // osteotomy before that real measurement exists.
    const analysis: Record<string, unknown> = {
      eixoMecanico: { graus: 10.6, desvio: "Varo" },
      mLDFA: { valor: 93.0 },
      aMPTA: { valor: 82.6 },
      JLCA: { valor: 4.0 },
    };

    const opcoes = computeOpcoesOsteotomia(analysis, 0, 50);
    const dupla = opcoes.find((o) => String(o.id).startsWith("dupla"));

    expect(dupla).toBeDefined();
    expect(dupla?.padrao).toBe(true);
    expect(dupla?.minimaCorrecao).toBe(false);
    expect(dupla?.alertas).not.toContainEqual(expect.stringMatching(/< 5 mm/));
  });
});

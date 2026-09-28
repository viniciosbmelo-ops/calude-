import { describe, expect, it } from "vitest";
import {
  createLimbSnapshot,
  hasSubstantiveLimbDocumentation,
  readBilateralDocumentation,
  updateStoredLimbSnapshot,
  writeBilateralDocumentation,
} from "./bilateral-surgery";
import { buildSurgeryTextExport } from "./surgery-text-export";

describe("bilateral surgery documentation", () => {
  it("round-trips independent limbs and preserves unknown detailed fields", () => {
    const right = createLimbSnapshot({
      patientId: 4,
      hospital: "Compartilhado",
      diagnostico: "LCA direito",
      procedimentosDetalhados: JSON.stringify({ futureField: { value: 7 } }),
    });
    const left = createLimbSnapshot({
      patientId: 4,
      hospital: "Compartilhado",
      diagnostico: "Menisco esquerdo",
      procedimentosDetalhados: "{}",
    });
    const encoded = writeBilateralDocumentation(
      JSON.stringify({ unknownLegacyField: "preservar" }),
      { direito: right, esquerdo: left },
    );
    const parsed = readBilateralDocumentation(encoded);

    expect(JSON.parse(encoded).unknownLegacyField).toBe("preservar");
    expect(parsed?.byLimb.direito?.diagnostico).toBe("LCA direito");
    expect(parsed?.byLimb.esquerdo?.diagnostico).toBe("Menisco esquerdo");
    expect(parsed?.byLimb.direito?.patientId).toBeUndefined();
    expect(hasSubstantiveLimbDocumentation(parsed?.byLimb.direito)).toBe(true);
    expect(hasSubstantiveLimbDocumentation({ _wizardUi: { activeProcSections: [] } })).toBe(false);
  });

  it("renders separate localized knee sections in TXT", () => {
    const procedimentosDetalhados = writeBilateralDocumentation("{}", {
      direito: {
        diagnostico: "Diagnóstico D",
        cpmReconstruction: { abordagem: "lcm_isolado", lcmTecnica: "Lind" },
      },
      esquerdo: { diagnostico: "Diagnóstico E" },
    });
    const text = buildSurgeryTextExport({
      lado: "Bilateral",
      patient: { nome: "Paciente Teste" },
      procedimentosDetalhados,
    });

    expect(text).toContain("JOELHO DIREITO");
    expect(text).toContain("JOELHO ESQUERDO");
    expect(text).toContain("Diagnóstico D");
    expect(text).toContain("Diagnóstico E");
    expect(text).toContain("Lind");
  });

  it("atomically targets an inactive limb without changing the other knee", () => {
    const original = {
      direito: { diagnostico: "Direito", lcaAlgorithm: { old: true } },
      esquerdo: { diagnostico: "Esquerdo" },
    };
    const updated = updateStoredLimbSnapshot(original, "direito", {}, (snapshot) => ({
      ...snapshot,
      lcaAlgorithm: { score: 8, tecnica: "LCA + LET" },
      alinhamento: "Varo",
    }));

    expect(updated.direito).toMatchObject({
      diagnostico: "Direito",
      alinhamento: "Varo",
      lcaAlgorithm: { score: 8, tecnica: "LCA + LET" },
    });
    expect(updated.esquerdo).toEqual(original.esquerdo);
    expect(original.direito.lcaAlgorithm).toEqual({ old: true });
  });
});
import { describe, expect, it } from "vitest";
import { caseTypeLabel } from "@/locales/case-types";

describe("case type labels", () => {
  it("shows the catalog label instead of the stored key", () => {
    expect(caseTypeLabel("pt-BR", "SH_CUFF")).toBe("Manguito Rotador");
    expect(caseTypeLabel("pt-BR", "SH_BICEPS_SLAP")).toBe("Bíceps e SLAP");
    expect(caseTypeLabel("es", "SH_BICEPS_SLAP")).toBe("Bíceps y SLAP");
  });

  it("disambiguates labels shared by shoulder and elbow", () => {
    expect(caseTypeLabel("pt-BR", "EL_FRACTURE")).toBe("Fraturas (Cotovelo)");
    expect(caseTypeLabel("es", "SH_INSTABILITY")).toBe("Inestabilidad (Hombro)");
  });

  it("falls back to the raw value for unknown keys", () => {
    expect(caseTypeLabel("es", "LCA")).toBe("LCA");
  });
});

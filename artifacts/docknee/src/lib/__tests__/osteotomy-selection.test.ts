import { describe, expect, it } from "vitest";
import {
  getNivelOverrideForOsteotomia,
  preferredOsteotomiaIndex,
} from "../osteotomy-selection";

describe("osteotomy selection compatibility", () => {
  it("uses single-femoral anatomy instead of legacy HTO padrao", () => {
    const payload = [
      { id: "hto_fechamento_medial", padrao: true },
      { id: "dfo_fechamento_medial", padrao: false },
      { id: "dupla", padrao: false },
    ];
    expect(preferredOsteotomiaIndex(payload, "SINGLE_FEMORAL")).toBe(1);
  });

  it("maps DFO to FEMORAL_ANATOMICA for single-femoral anatomy", () => {
    expect(getNivelOverrideForOsteotomia("dfo_fechamento_medial", "SINGLE_FEMORAL"))
      .toBe("FEMORAL_ANATOMICA");
  });
});
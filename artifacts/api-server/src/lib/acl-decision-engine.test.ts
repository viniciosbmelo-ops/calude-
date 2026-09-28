import { describe, expect, it } from "vitest";
import { computeAclDecision } from "./acl-decision-engine";

function hyperextensionRule(degrees: number) {
  return computeAclDecision({
    idade: 40,
    enxerto: "Outro",
    revisao: false,
    hiperextensaoGraus: degrees,
  }).regras.find(rule => rule.id === "L4");
}

describe("LEAP hyperextension threshold", () => {
  it("does not strongly recommend LEAP below 6.5°", () => {
    const rule = hyperextensionRule(6.4);

    expect(rule?.forca).toBe("Deve ser considerado");
    expect(rule?.titulo).toBe("Hiperextensão entre 5° e < 6,5°");
  });

  it("strongly recommends LEAP at 6.5° without inventing a measured value", () => {
    const rule = hyperextensionRule(6.5);

    expect(rule?.forca).toBe("Fortemente recomendado");
    expect(rule?.titulo).toBe("Hiperextensão ≥ 6,5°");
    expect(rule?.titulo).not.toContain("(8°)");
  });
});
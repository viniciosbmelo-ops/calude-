import { describe, expect, it } from "vitest";
import {
  getKrirsDisplayJustification,
  getKrirsRiskLabel,
  getKrirsRiskLevel,
} from "./krirs-risk";

describe("KRIRS risk presentation", () => {
  it("converts legacy scores into the three risk classifications", () => {
    expect(getKrirsRiskLevel(2, false)).toBe("baixo");
    expect(getKrirsRiskLevel(3, false)).toBe("intermediario");
    expect(getKrirsRiskLevel(6, true)).toBe("alto");
    expect(getKrirsRiskLevel(99, true)).toBe("alto");
  });

  it("prefers the persisted classification for new records", () => {
    expect(getKrirsRiskLevel(null, false, "intermediario")).toBe("intermediario");
    expect(getKrirsRiskLevel(null, false, "baixo")).toBe("baixo");
  });

  it("does not expose legacy score wording in the justification", () => {
    expect(getKrirsDisplayJustification("Score KRIRS ≥6 — alto risco", "alto", "pt-BR"))
      .toBe("Alto risco de re-ruptura");
    expect(getKrirsDisplayJustification("Score KRIRS 3–5 — risco moderado", "intermediario", "es"))
      .toBe("Riesgo intermedio");
  });

  it("localizes the classification labels", () => {
    expect(getKrirsRiskLabel("baixo", "pt-BR")).toBe("Baixo risco");
    expect(getKrirsRiskLabel("baixo", "es")).toBe("Riesgo bajo");
  });
});
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LGPD Art. 11: the secretary console must not render or submit the sensitive clinical profile.
describe("secretary dashboard: sensitive clinical profile", () => {
  const source = readFileSync(new URL("./dashboard.tsx", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("does not reference the clinical profile fields or component", () => {
    for (const token of ["tabagismo", "diabetes", "nivelAtividade", "ladoDominante", "PatientClinicalFields", "patientClinicalCreateBody"]) {
      expect(source, token).not.toContain(token);
    }
  });

  it("does not read surgery records from the patient list (the API omits them for secretaries)", () => {
    expect(source).not.toMatch(/\.surgeries\b/);
    for (const token of ["dadosClinicos", "diagnostico", "beightonScore", "anamnese", "laudos"]) {
      expect(source, token).not.toContain(token);
    }
  });
});

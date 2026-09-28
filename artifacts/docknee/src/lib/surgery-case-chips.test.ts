import { describe, expect, it } from "vitest";
import { surgeryCaseTypeChips } from "./surgery-case-chips";

const label = (key: string) => ({ biceps_distal: "Bíceps Distal", manguito: "Manguito Rotador" } as Record<string, string>)[key] ?? key;

describe("surgeryCaseTypeChips", () => {
  it("drops the case-type chip when a procedure chip shows the same label", () => {
    expect(surgeryCaseTypeChips({ tipoCaso: "biceps_distal", tiposProcedimento: ["biceps_distal"] }, label))
      .toEqual({ caseTypeChip: null, procedureChips: ["Bíceps Distal"] });
  });

  it("keeps a distinct case-type chip when values differ", () => {
    expect(surgeryCaseTypeChips({ tipoCaso: "manguito", tiposProcedimento: ["biceps_distal"] }, label))
      .toEqual({ caseTypeChip: "Manguito Rotador", procedureChips: ["Bíceps Distal"] });
  });

  it("shows the case type alone when there are no procedures and dedupes procedures", () => {
    expect(surgeryCaseTypeChips({ tipoCaso: "manguito", tiposProcedimento: [] }, label).caseTypeChip).toBe("Manguito Rotador");
    expect(surgeryCaseTypeChips({ tipoCaso: null, tiposProcedimento: ["manguito", "manguito"] }, label).procedureChips).toEqual(["Manguito Rotador"]);
  });
});

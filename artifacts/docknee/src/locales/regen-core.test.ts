import { describe, expect, it } from "vitest";
import { regenCoreMessages } from "./regen-core";

describe("regenerative core locale catalogue", () => {
  it("keeps PT-BR and Spanish catalogues structurally identical", () => {
    expect(Object.keys(regenCoreMessages.es).sort()).toEqual(
      Object.keys(regenCoreMessages["pt-BR"]).sort(),
    );
  });

  it("keeps the Spanish dashboard, research, and consent actions localized", () => {
    expect(regenCoreMessages.es.newCase).toBe("Nuevo caso");
    expect(regenCoreMessages.es.searchCases).toContain("paciente");
    expect(regenCoreMessages.es.exportCsv).toBe("Exportar CSV");
    expect(regenCoreMessages.es.selectCaseFirst).toBe("Seleccione un caso primero");
  });

  it("does not translate persisted product codes or clinical abbreviations", () => {
    expect(regenCoreMessages.es.averageVas).toContain("VAS");
    expect(regenCoreMessages.es.averageKoos).toContain("KOOS");
  });

  it("localizes representative long-form, dialog, and orientation copy", () => {
    expect(regenCoreMessages.es.directedHistory).toBe("Anamnesis dirigida");
    expect(regenCoreMessages.es.deleteCaseTitle).toBe("¿Eliminar el caso regenerativo?");
    expect(regenCoreMessages.es.preChecklist).toContain("preprocedimiento");
    expect(regenCoreMessages.es.warningNotExpected).toContain("evaluación médica inmediata");
    expect(regenCoreMessages["pt-BR"].newRegenCase).toBe("Novo Caso Regenerativa");
  });
});
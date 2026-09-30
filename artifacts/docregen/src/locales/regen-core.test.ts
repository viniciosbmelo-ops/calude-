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
    expect(regenCoreMessages.es).not.toHaveProperty("averageKoos");
    expect(regenCoreMessages.es).not.toHaveProperty("averageWomac");
  });

  it("localizes representative long-form, dialog, and orientation copy", () => {
    expect(regenCoreMessages.es.directedHistory).toBe("Anamnesis dirigida");
    expect(regenCoreMessages.es.deleteCaseTitle).toBe("¿Eliminar el caso regenerativo?");
    expect(regenCoreMessages.es.preChecklist).toContain("preprocedimiento");
    expect(regenCoreMessages.es.warningNotExpected).toContain("evaluación médica inmediata");
    expect(regenCoreMessages["pt-BR"].newRegenCase).toBe("Novo Caso Regenerativa");
  });

  it("names the cases area 'Procedimentos' and the case's applications tab 'Aplicações'", () => {
    expect(regenCoreMessages["pt-BR"].regenerative).toBe("Procedimentos");
    expect(regenCoreMessages.es.regenerative).toBe("Procedimientos");
    expect(regenCoreMessages["pt-BR"].caseTabProcedures).toBe("Aplicações");
    expect(regenCoreMessages.es.caseTabProcedures).toBe("Aplicaciones");
    expect(regenCoreMessages["pt-BR"].registerProcedure).toBe("Registrar aplicação");
    expect(regenCoreMessages.es.registerProcedure).toBe("Registrar aplicación");
    expect(regenCoreMessages["pt-BR"].proceduresEmpty).toBe("Nenhuma aplicação registrada neste caso.");
    expect(regenCoreMessages.es.proceduresEmpty).toBe("No hay aplicaciones registradas en este caso.");
    expect(regenCoreMessages["pt-BR"].procedureCountPlural).toBe("{count} aplicações");
    // The medical concept keeps its wording.
    expect(regenCoreMessages["pt-BR"].regenerativeCase).toBe("Caso Regenerativo");
  });
});

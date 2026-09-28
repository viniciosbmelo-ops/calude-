import { describe, expect, it } from "vitest";
import { operationalPatientRecordMessages as messages } from "./operational-patient-record";

describe("patient record localization catalog", () => {
  it("provides representative Spanish patient-management copy", () => {
    expect(messages.es.patientCreated).toBe("Paciente registrado");
    expect(messages.es.confirmDeletion).toBe("Confirmar eliminación");
    expect(messages.es.attachedFiles).toBe("Archivos adjuntos");
    expect(messages.es.saveGeneratePdf).toBe("Guardar y generar PDF");
  });

  it("keeps persisted sex codes out of display labels", () => {
    expect(messages.es.male).toBe("Masculino");
    expect(messages.es.female).toBe("Femenino");
  });
});
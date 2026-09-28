import { describe, expect, it } from "vitest";
import { joiaMessages } from "./joia";

describe("JoIA localization", () => {
  it("provides explicit Spanish onboarding and interaction copy", () => {
    expect(joiaMessages.es.onboarding).toContain("informes en PDF");
    expect(joiaMessages.es.inputPlaceholder).toBe("Escriba su pregunta o solicite un informe...");
    expect(joiaMessages.es.microphoneUnavailable).toBe("Micrófono no disponible");
    expect(joiaMessages.es.microphoneDeviceUnavailable).toContain("micrófono");
    expect(joiaMessages.es.microphoneNoAudio).toContain("audio");
    expect(joiaMessages.es.responseError).toContain("Inténtelo de nuevo");
  });

  it("localizes authored report-shell labels without translating report data", () => {
    expect(joiaMessages.es.pdfPatientList).toBe("Listado de pacientes");
    expect(joiaMessages.es.pdfAggregateFollowup).toBe("Seguimiento agregado");
    expect(joiaMessages.es.pdfFilters).toBe("Filtros: {filters}");
    expect(joiaMessages.es.pdfReturnToSport).toBe("Retorno al deporte: {count} ({percent}%)");
  });
});
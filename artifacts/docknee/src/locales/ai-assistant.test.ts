import { describe, expect, it } from "vitest";
import { aiAssistantMessages } from "./ai-assistant";

describe("AI assistant localization", () => {
  it("provides explicit Spanish onboarding and interaction copy", () => {
    expect(aiAssistantMessages.es.onboarding).toContain("informes en PDF");
    expect(aiAssistantMessages.es.inputPlaceholder).toBe("Escriba su pregunta o solicite un informe...");
    expect(aiAssistantMessages.es.microphoneUnavailable).toBe("Micrófono no disponible");
    expect(aiAssistantMessages.es.microphoneDeviceUnavailable).toContain("micrófono");
    expect(aiAssistantMessages.es.microphoneNoAudio).toContain("audio");
    expect(aiAssistantMessages.es.responseError).toContain("Inténtelo de nuevo");
  });

  it("localizes authored report-shell labels without translating report data", () => {
    expect(aiAssistantMessages.es.pdfPatientList).toBe("Listado de pacientes");
    expect(aiAssistantMessages.es.pdfAggregateFollowup).toBe("Seguimiento agregado");
    expect(aiAssistantMessages.es.pdfFilters).toBe("Filtros: {filters}");
    expect(aiAssistantMessages.es.pdfReturnToSport).toBe("Retorno al deporte: {count} ({percent}%)");
  });
});
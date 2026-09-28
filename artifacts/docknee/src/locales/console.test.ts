import { describe, expect, it } from "vitest";
import { consoleMessages } from "./console";

describe("console localization catalog", () => {
  it("provides Spanish equivalents for the representative auth and agenda copy", () => {
    expect(consoleMessages.es.secretaryAccess).toBe("Acceso de la secretaria");
    expect(consoleMessages.es.loading).toBe("Cargando...");
    expect(consoleMessages.es.appointmentScheduled).toBe("¡Consulta agendada!");
  });

  it("keeps persisted appointment values separate from their visible labels", () => {
    expect(consoleMessages["pt-BR"].scheduled).toBe("agendado");
    expect(consoleMessages.es.scheduled).toBe("agendado");
  });
});
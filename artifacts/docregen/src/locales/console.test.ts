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

  it("keeps the same keys in both locales", () => {
    expect(Object.keys(consoleMessages.es).sort()).toEqual(Object.keys(consoleMessages["pt-BR"]).sort());
  });

  it("carries DocRegen branding and no surgical secretary tabs", () => {
    for (const messages of [consoleMessages["pt-BR"], consoleMessages.es]) {
      expect(messages.appointmentWhatsappMessage).toContain("DocRegen");
      expect(JSON.stringify(messages)).not.toMatch(/DocSholder|🦵/);
      expect(messages).not.toHaveProperty("surgeries");
      expect(messages).not.toHaveProperty("followupWhatsappMessage");
    }
    expect(consoleMessages["pt-BR"].regenProcedure).toBe("procedimento regenerativo");
  });

  it("offers the regenerative cases and alerts tabs with DocRegen reminders", () => {
    expect(consoleMessages["pt-BR"].regenTab).toBe("Regenerativa");
    expect(consoleMessages["pt-BR"].alertsTab).toBe("Alertas");
    for (const messages of [consoleMessages["pt-BR"], consoleMessages.es]) {
      expect(messages.regenAlertWhatsappMessage).toContain("{name}");
      expect(messages.regenAlertWhatsappMessage).toContain("{period}");
      expect(messages.regenAlertWhatsappMessage).toContain("DocRegen");
    }
  });
});

import { describe, expect, it } from "vitest";
import { resolveDoctorLocale } from "./locale";
import { message } from "./locale-catalog";
import { consentContentForLocale } from "../routes/regen";

describe("doctor-owned communication locale", () => {
  it("uses Spanish only for a Spanish doctor and safely defaults otherwise", () => {
    expect(resolveDoctorLocale("es")).toBe("es");
    expect(resolveDoctorLocale("es-ES")).toBe("es");
    expect(resolveDoctorLocale("pt-BR")).toBe("pt-BR");
    expect(resolveDoctorLocale(undefined)).toBe("pt-BR");
    expect(resolveDoctorLocale("en")).toBe("pt-BR");
  });

  it("renders prepared invitations in the resolved language", () => {
    expect(message("es", "preConsultInvite", { link: "https://example.test/a" }))
      .toContain("¡Hola!");
    expect(message("pt-BR", "regenFollowup", { patient: "Ana", doctor: "Dra. B", period: "30 dias", scales: "VAS", link: "x", identity: "" }))
      .toContain("Olá, Ana");
  });

  it("renders localized route errors without changing interpolated details", () => {
    expect(message("es", "mediaFileTooLarge", { limitMB: 25 }))
      .toBe("Archivo demasiado grande (máximo 25 MB para este tipo)");
    expect(message("es", "incorrectAttempts", { minutes: 3, suffix: "s" }))
      .toBe("Demasiados intentos incorrectos. Inténtelo de nuevo en 3 minutos.");
    expect(message("es", "invalidAnswers")).toBe("Respuestas no válidas.");
    expect(message("pt-BR", "invalidAnswers")).toBe("Respostas inválidas.");
    expect(message("es", "serviceEmailNotFound", { email: "Livre@Example.test" }))
      .toContain("\"Livre@Example.test\"");
  });

  it("selects localized consent declarations by doctor locale", () => {
    expect(consentContentForLocale("PRP", "es")?.title).toBe("Plasma rico en plaquetas (PRP)");
    expect(consentContentForLocale("BMAC", "es")?.items[0]).toContain("Procedimiento autólogo");
    expect(consentContentForLocale("PRP", "pt-BR")?.title).toBe("Plasma Rico em Plaquetas (PRP)");
    expect(consentContentForLocale("MFAT", "es")?.title).toBe("Grasa microfragmentada (MFAT)");
    expect(consentContentForLocale("AH", "es")?.items[1]).toContain("pseudosepsis");
    expect(consentContentForLocale("RADIOFREQUENCIA", "es")?.title).toBe("Radiofrecuencia (neurotomía/ablación)");
    expect(consentContentForLocale("BLOQUEIOS", "es")?.items[2]).toContain("3 infiltraciones");
    expect(consentContentForLocale("HIDROGEL", "es")?.title).toBe("Hidrogel (andamio polimérico)");
    expect(consentContentForLocale("PRF", "es")?.items).toHaveLength(5);
    expect(consentContentForLocale("COLAGENO", "es")?.items[1]).toContain("3 %");
    expect(consentContentForLocale("SVF", "es")?.title).toBe("Fracción vascular estromal (SVF)");
    expect(consentContentForLocale("LISADO", "es")?.title).toBe("Lisado plaquetario");
    expect(consentContentForLocale("LISADO", "es")?.items[1]).toContain("alogénico");
    expect(consentContentForLocale("NANOFAT", "es")?.title).toBe("Nanofat (Lipogems / grasa nanofragmentada)");
    expect(consentContentForLocale("NANOFAT", "es")?.items[2]).toContain("agujas finas");
    expect(consentContentForLocale("NANOFAT", "pt-BR")?.items[2]).toContain("agulhas finas");
  });
});
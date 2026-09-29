import { describe, expect, it } from "vitest";
import { preConsultationMessages } from "./public-patient-flows";

describe("pre-consultation public-flow catalog", () => {
  it("supplies Spanish copy for a question, option, validation, and completion state", () => {
    const messages = preConsultationMessages.es;

    expect(messages.q7).toBe("7. ¿Cuál es la intensidad de su dolor hoy?");
    expect(messages.optStairs).toBe("Subir/bajar escaleras");
    expect(messages.cpfDoesNotMatch).toBe("El CPF no corresponde a la invitación.");
    expect(messages.questionnaireSubmitted).toBe("¡Cuestionario enviado!");
  });

  it("keeps the exam upload questions (RX, MRI, CT, ultrasound)", () => {
    const messages = preConsultationMessages["pt-BR"];
    expect(messages.q20).toContain("Envie os exames");
    expect([messages.optXray, messages.optMri, messages.optCt, messages.optUltrasound])
      .toEqual(["Radiografia", "Ressonância magnética", "Tomografia computadorizada", "Ultrassonografia"]);
    expect(messages.uploadFormats).toContain("PDF");
  });

  it("drops the surgical-concern question and renumbers the expectations section", () => {
    for (const messages of [preConsultationMessages["pt-BR"], preConsultationMessages.es]) {
      expect(messages).not.toHaveProperty("q25");
      expect(messages.q23).toMatch(/^23\. /);
      expect(messages.q24).toMatch(/^24\. /);
      expect(messages.q23).not.toMatch(/cir[uú]rg/i);
    }
    expect(Object.keys(preConsultationMessages.es).sort()).toEqual(Object.keys(preConsultationMessages["pt-BR"]).sort());
  });
});

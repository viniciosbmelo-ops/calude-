import { describe, expect, it } from "vitest";
import { preConsultationMessages, publicPatientFlowMessages, surgicalOptionSpanish, surgicalScaleSpanish } from "./public-patient-flows";
import { displayScale, SCALES } from "@/pages/patient/[token]";

describe("pre-consultation public-flow catalog", () => {
  it("supplies Spanish copy for a question, option, validation, and completion state", () => {
    const messages = preConsultationMessages.es;

    expect(messages.q7).toBe("7. ¿Cuál es la intensidad de su dolor hoy?");
    expect(messages.optStairs).toBe("Subir/bajar escaleras");
    expect(messages.cpfDoesNotMatch).toBe("El CPF no corresponde a la invitación.");
    expect(messages.questionnaireSubmitted).toBe("¡Cuestionario enviado!");
  });
});

describe("surgical public-flow scale catalog", () => {
  it("offers only the pain scale, with no knee questionnaire left", () => {
    expect(Object.keys(SCALES)).toEqual(["VAS Dor"]);
    expect(Object.keys(surgicalScaleSpanish).every((key) => key.startsWith("VAS Dor."))).toBe(true);
    expect(JSON.stringify(SCALES)).not.toMatch(/joelho|Lysholm|IKDC|KOOS|Tegner/i);
    expect(surgicalOptionSpanish["Extrema/impossível"]).toBe("Extrema/imposible");
  });
});

describe("Spanish surgical patient-flow copy", () => {
  it("renders catalog progress, completion, and scale fallback copy without Portuguese", () => {
    const messages = publicPatientFlowMessages.es;
    const progress = messages.scalesProgress.replace("{completed}", "1").replace("{total}", "3");
    const completion = messages.completionDescription
      .replace("{total}", "3")
      .replace("{plural}", "s");
    const scale = displayScale(SCALES["VAS Dor"], "es");

    expect(progress).toBe("1 de 3 escalas");
    expect(completion).toContain("Sus resultados fueron enviados");
    expect(scale.title).toBe("Escala de dolor (VAS)");
    expect(scale.questions[0].label).toContain("región operada");
    expect([progress, completion, scale.title, scale.questions[0].label].join(" "))
      .not.toMatch(/Você|resultados foram|região|rodilla|joelho/);
  });

  it("has Spanish display copy for every authored surgical scale question and option", () => {
    Object.values(SCALES).forEach((scale) => {
      expect(surgicalScaleSpanish[`${scale.id}.title`]).toBeTruthy();
      expect(surgicalScaleSpanish[`${scale.id}.description`]).toBeTruthy();
      scale.questions.forEach((question) => {
        expect(surgicalScaleSpanish[`${scale.id}.${question.id}`]).toBeTruthy();
        question.options?.forEach((option) => {
          expect(
            surgicalScaleSpanish[`${scale.id}.${question.id}.${option.value}`]
              ?? surgicalOptionSpanish[option.label],
          ).toBeTruthy();
        });
      });
    });
  });
});
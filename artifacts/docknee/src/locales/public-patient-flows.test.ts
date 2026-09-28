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
  it("offers only the pain scale and SANE, with no knee questionnaire left", () => {
    expect(Object.keys(SCALES)).toEqual(["VAS Dor", "SANE"]);
    expect(Object.keys(surgicalScaleSpanish).every((key) => key.startsWith("VAS Dor.") || key.startsWith("SANE."))).toBe(true);
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
describe("SANE patient scale", () => {
  it("is a single 0–100 integer slider scored as the raw answer", () => {
    const sane = SCALES["SANE"];
    expect(sane.maxScore).toBe(100);
    expect(sane.questions).toHaveLength(1);
    expect(sane.questions[0]).toMatchObject({ id: "sane", type: "slider", min: 0, max: 100, step: 1 });
    expect(sane.calcScore({ sane: 85 })).toBe(85);
  });

  it("names the operated joint in Portuguese", () => {
    expect(displayScale(SCALES["SANE"], "pt-BR", "shoulder").questions[0].label).toBe(
      "Como você avalia seu ombro hoje, em porcentagem do normal? (0 a 100%, sendo 100% totalmente normal)",
    );
    const elbow = displayScale(SCALES["SANE"], "pt-BR", "elbow").questions[0].label;
    expect(elbow).toContain("seu cotovelo");
    expect(elbow).not.toMatch(/ombro|\{joint\}/);
  });

  it("names the operated joint in Spanish without Portuguese", () => {
    const shoulder = displayScale(SCALES["SANE"], "es", "shoulder");
    const elbow = displayScale(SCALES["SANE"], "es", "elbow");
    expect(shoulder.title).toBe("SANE (Evaluación Numérica Única)");
    expect(shoulder.questions[0].label).toContain("su hombro");
    expect(elbow.questions[0].label).toContain("su codo");
    expect([shoulder.title, shoulder.description, elbow.questions[0].label].join(" "))
      .not.toMatch(/ombro|cotovelo|você|porcentagem|\{joint\}/);
  });

  it("falls back to a neutral joint phrase when the region is unknown", () => {
    expect(displayScale(SCALES["SANE"], "pt-BR", null).questions[0].label).toContain("sua articulação operada");
    expect(displayScale(SCALES["SANE"], "es").questions[0].label).toContain("su articulación operada");
  });

  it("leaves the VAS wording unchanged", () => {
    expect(displayScale(SCALES["VAS Dor"], "pt-BR", "elbow").questions[0].label).toBe(SCALES["VAS Dor"].questions[0].label);
  });
});

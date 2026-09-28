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
  it("supplies Spanish copy for every Tegner activity option", () => {
    const expectedOptions = [
      "0 — Baja por incapacidad o pensión debido a la rodilla",
      "1 — Actividades sedentarias; trabajo de oficina",
      "2 — Actividades ligeras; caminar en terreno plano",
      "3 — Natación o caminata por el bosque",
      "4 — Ciclismo, esquí alpino, trotar 2 veces por semana",
      "5 — Trotar al menos 5 veces por semana; fútbol recreativo",
      "6 — Tenis, bádminton; balonmano recreativo; trotar (mín. 1 vez por semana)",
      "7 — Fútbol / balonmano en división inferior",
      "8 — Fútbol, balonmano, squash (élite juvenil o máster)",
      "9 — Fútbol, balonmano, squash (división superior)",
      "10 — Fútbol o balonmano (nivel nacional / internacional)",
    ];

    expectedOptions.forEach((label, value) => {
      expect(surgicalScaleSpanish[`Tegner.tegner.${value}`]).toBe(label);
    });
  });

  it("supplies explicit Spanish option copy for each supported radio scale", () => {
    expect(surgicalScaleSpanish["Lysholm.bloqueio.15"]).toBe("Sin bloqueo");
    expect(surgicalScaleSpanish["IKDC.atividade_atual.4"]).toContain("Actividades muy intensas");
    expect(surgicalScaleSpanish["Kujala.flexao.5"]).toBe("Normal (más de 130°)");
    expect(surgicalScaleSpanish["Marx.correr.4"]).toBe("Diariamente (todos los días)");
    expect(surgicalOptionSpanish["Extrema/impossível"]).toBe("Extrema/imposible");
    expect(surgicalOptionSpanish["Muito intensa/impossível"]).toBe("Muy intensa/imposible");
  });
});

describe("Spanish surgical patient-flow copy", () => {
  it("renders catalog progress, completion, and scale fallback copy without Portuguese", () => {
    const messages = publicPatientFlowMessages.es;
    const progress = messages.scalesProgress.replace("{completed}", "1").replace("{total}", "3");
    const completion = messages.completionDescription
      .replace("{total}", "3")
      .replace("{plural}", "s");
    const scale = displayScale(SCALES["Tegner"], "es");

    expect(progress).toBe("1 de 3 escalas");
    expect(completion).toContain("Sus resultados fueron enviados");
    expect(scale.title).toBe("Escala de actividad de Tegner");
    expect(scale.questions[0].options?.[0].label).toBe(
      "0 — Baja por incapacidad o pensión debido a la rodilla",
    );
    expect([progress, completion, scale.title, scale.questions[0].options?.[0].label].join(" "))
      .not.toMatch(/Você|resultados foram|Licença|joelho|Escala de Atividade/);
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
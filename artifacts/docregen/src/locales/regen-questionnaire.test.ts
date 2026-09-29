import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { publicPatientFlowMessages } from "./public-patient-flows";
import { getRegenScales } from "./regen-questionnaire";

describe("Spanish regenerative questionnaire copy", () => {
  it("provides Spanish text for the pain scale without naming a specific joint", () => {
    const question = getRegenScales("es")["VAS Dor"].questions.find(({ id }) => id === "vas");

    expect(question?.label).toContain("región tratada");
    expect(JSON.stringify(getRegenScales("es")["VAS Dor"])).not.toMatch(/rodilla/i);
    expect(JSON.stringify(getRegenScales("pt-BR")["VAS Dor"])).not.toMatch(/joelho/i);
  });

  it("asks the SANE-joelho single question 0–100 for knee cases (answer id 'sane')", () => {
    const pt = getRegenScales("pt-BR")["SANE Joelho"];
    const es = getRegenScales("es")["SANE Joelho"];
    expect(pt.questions).toEqual([expect.objectContaining({ id: "sane", type: "slider", min: 0, max: 100, step: 1 })]);
    expect(pt.questions[0]!.label).toBe(
      "Em uma escala de 0 a 100, sendo 100 um joelho completamente normal, como você avalia seu joelho hoje?",
    );
    expect(es.questions[0]!.label).toContain("100 es una rodilla completamente normal");
    expect(pt.calcScore({ sane: 70 })).toBe(70);
  });

  it("provides Spanish validation, loading, progress, completion, and navigation copy", () => {
    expect(publicPatientFlowMessages.es.enterDob).toBe("Informe su fecha de nacimiento.");
    expect(publicPatientFlowMessages.es.incorrectDob).toBe("La fecha de nacimiento es incorrecta. Verifique los datos.");
    expect(publicPatientFlowMessages.es.regenConnectionError).toContain("conexión");
    expect(publicPatientFlowMessages.es.loadingQuestionnaires).toBe("Cargando cuestionarios...");
    expect(publicPatientFlowMessages.es.scalesProgressAria).toBe("{completed} de {total} escalas completadas");
    expect(publicPatientFlowMessages.es.nextScale).toBe("Siguiente escala");
    expect(publicPatientFlowMessages.es.completionDescription).toContain("Sus resultados fueron enviados");
  });

  it("localizes every displayed Spanish Regen scale while preserving response identifiers and values", () => {
    const spanishScales = getRegenScales("es");
    const portugueseScales = getRegenScales("pt-BR");

    Object.entries(spanishScales).forEach(([scaleId, spanishScale]) => {
      const portugueseScale = portugueseScales[scaleId];
      expect(spanishScale.title).toBeTruthy();
      expect(spanishScale.description).toBeTruthy();
      expect(spanishScale.questions).toHaveLength(portugueseScale.questions.length);

      spanishScale.questions.forEach((question, index) => {
        const portugueseQuestion = portugueseScale.questions[index];
        expect(question.label).toBeTruthy();
        expect(question.id).toBe(portugueseQuestion.id);
        expect(question.options?.map(({ value }) => value)).toEqual(
          portugueseQuestion.options?.map(({ value }) => value),
        );
        question.options?.forEach(({ label }) => expect(label).toBeTruthy());
      });
    });
  });

  it("keeps the Regen page's user-visible fallbacks catalog-backed and accessible", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../pages/patient/regen-token.tsx"), "utf8");

    expect(source).toContain('publicRegenServerError(data, t("incorrectCpf"))');
    expect(source).toContain('publicRegenServerError(data, t("saveError"))');
    expect(source).toContain('setSubmitError(t("regenConnectionError"))');
    expect(source).toContain("getRegenScales(questionnaireLocale)");
    expect(source).toContain("normalizeDoctorLocale(info.doctorLocale ?? locale)");
    expect(source).toContain("info.periodoLabel ?? info.periodo");
    expect(source).not.toContain('publicPatientFlowMessages["pt-BR"]');
    expect(source).toContain("aria-label={q.label}");
    expect(source).toContain('aria-valuetext={t("scalesProgressAria"');
    expect(source).toContain('role="alert"');
    expect(source).not.toContain('"Data de nascimento incorreta."');
  });
});
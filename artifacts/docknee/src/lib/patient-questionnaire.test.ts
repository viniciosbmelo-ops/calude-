import { describe, expect, it } from "vitest";
import { patientQuestionnaireProgress, patientScaleList } from "./patient-questionnaire";

const isPatientScale = (name: string) => name === "VAS Dor" || name === "SANE";

describe("patient questionnaire progress", () => {
  it("ignores the clinician's Constant response when deciding completion", () => {
    const scales = patientScaleList(["VAS Dor", "SANE"], isPatientScale);
    // Situação do bug: CONSTANT (médico) + VAS (paciente) = 2 respostas, mas SANE pendente.
    const progress = patientQuestionnaireProgress(scales, ["CONSTANT", "VAS Dor"]);
    expect(progress.allDone).toBe(false);
    expect(progress.completed).toEqual(["VAS Dor"]);
    expect(progress.pending).toEqual(["SANE"]);
    expect(progress.firstPendingIdx).toBe(1);
  });

  it("completes by scale identity, not by count", () => {
    const scales = patientScaleList(["VAS Dor", "SANE"], isPatientScale);
    expect(patientQuestionnaireProgress(scales, ["VAS Dor", "VAS Dor"]).allDone).toBe(false);
    expect(patientQuestionnaireProgress(scales, ["SANE", "CONSTANT", "VAS Dor"]).allDone).toBe(true);
    expect(patientQuestionnaireProgress(scales, ["SANE", "CONSTANT", "VAS Dor"]).completed).toEqual(["VAS Dor", "SANE"]);
  });

  it("only lists scales sent to the patient that the form supports", () => {
    expect(patientScaleList(["Lysholm", "VAS Dor", "CONSTANT", "VAS Dor", "SANE"], isPatientScale)).toEqual(["VAS Dor", "SANE"]);
    expect(patientScaleList(null, isPatientScale)).toEqual([]);
  });

  it("is never done when there are no patient scales", () => {
    const progress = patientQuestionnaireProgress([], ["CONSTANT"]);
    expect(progress.allDone).toBe(false);
    expect(progress.firstPendingIdx).toBe(-1);
  });
});

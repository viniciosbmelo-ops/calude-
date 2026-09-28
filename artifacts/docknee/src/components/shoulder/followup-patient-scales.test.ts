import { describe, expect, it } from "vitest";
import { followupPainDisplay, followupPatientSane } from "./followup-patient-scales";

describe("follow-up card: clinician vs patient scales", () => {
  it("shows both VAS values when the patient's answer differs from the clinician's", () => {
    expect(followupPainDisplay(2, [{ escala: "VAS Dor", score: 3 }])).toEqual({ kind: "both", clinician: 2, patient: 3 });
  });

  it("shows a single value when they match or the patient did not answer", () => {
    expect(followupPainDisplay(3, [{ escala: "VAS Dor", score: 3 }])).toEqual({ kind: "single", value: 3 });
    expect(followupPainDisplay(2, [])).toEqual({ kind: "single", value: 2 });
    expect(followupPainDisplay(null, undefined)).toEqual({ kind: "single", value: null });
  });

  it("labels the patient's VAS when the clinician has none", () => {
    expect(followupPainDisplay(null, [{ escala: "VAS Dor", score: 5 }])).toEqual({ kind: "patientOnly", patient: 5 });
  });

  it("reads the patient's SANE", () => {
    expect(followupPatientSane([{ escala: "VAS Dor", score: 3 }, { escala: "SANE", score: 80 }])).toBe(80);
    expect(followupPatientSane([{ escala: "VAS Dor", score: 3 }])).toBeNull();
  });
});

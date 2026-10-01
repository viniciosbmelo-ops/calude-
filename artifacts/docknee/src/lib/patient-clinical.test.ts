import { describe, expect, it } from "vitest";
import { LADO_DOMINANTE_VALORES, NIVEL_ATIVIDADE_VALORES, TABAGISMO_VALORES } from "@workspace/clinical/web";
import { operationalPatientRecordMessages as messages } from "@/locales/operational-patient-record";
import { surgeryShoulderMessages } from "@/locales/surgery-shoulder";
import {
  PATIENT_CLINICAL_FIELDS, PATIENT_CLINICAL_LABEL_KEYS, PATIENT_CLINICAL_OPTIONS, PATIENT_CLINICAL_VALUE_KEYS,
  emptyPatientClinicalForm, hasPatientClinicalData, patientClinicalCreateBody, patientClinicalDisplay, patientClinicalFormFrom,
  patientClinicalUpdateBody, patientEditHref, shouldOpenPatientEdit,
} from "./patient-clinical";

describe("perfil clínico do paciente: formulário", () => {
  it("opções são os enums do núcleo clínico (mesmos da API e dos algoritmos)", () => {
    expect(PATIENT_CLINICAL_OPTIONS.ladoDominante).toEqual(LADO_DOMINANTE_VALORES);
    expect(PATIENT_CLINICAL_OPTIONS.tabagismo).toEqual(TABAGISMO_VALORES);
    expect(PATIENT_CLINICAL_OPTIONS.nivelAtividade).toEqual(NIVEL_ATIVIDADE_VALORES);
    expect(PATIENT_CLINICAL_OPTIONS.diabetes).toEqual(["sim", "nao"]);
  });

  it("novo paciente: só os campos informados vão no corpo", () => {
    expect(patientClinicalCreateBody(emptyPatientClinicalForm())).toEqual({});
    expect(patientClinicalCreateBody({ ladoDominante: "R", tabagismo: "", diabetes: "nao", nivelAtividade: "competitivo" }))
      .toEqual({ ladoDominante: "R", diabetes: false, nivelAtividade: "competitivo" });
  });

  it("edição: ida e volta pelo paciente da API; vazio vira null para limpar", () => {
    const patient = { id: 1, ladoDominante: "ambidestro", tabagismo: "ex_tabagista", diabetes: true, nivelAtividade: "trabalhador_bracal" };
    const form = patientClinicalFormFrom(patient);
    expect(form).toEqual({ ladoDominante: "ambidestro", tabagismo: "ex_tabagista", diabetes: "sim", nivelAtividade: "trabalhador_bracal" });
    const { id: _id, ...perfil } = patient;
    expect(patientClinicalUpdateBody(form)).toEqual(perfil);
    expect(patientClinicalUpdateBody(emptyPatientClinicalForm()))
      .toEqual({ ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null });
  });

  it("valores nulos ou fora do enum (texto legado) ficam vazios", () => {
    expect(patientClinicalFormFrom({ ladoDominante: null, tabagismo: "sim", diabetes: null, nivelAtividade: "Sedentário" })).toEqual(emptyPatientClinicalForm());
    expect(patientClinicalFormFrom(undefined)).toEqual(emptyPatientClinicalForm());
    expect(hasPatientClinicalData({ nivelAtividade: "Sedentário" })).toBe(false);
    expect(hasPatientClinicalData({ diabetes: false })).toBe(true);
  });
});

describe("perfil clínico do paciente: leitura e link de edição", () => {
  it("exibe os quatro campos na ordem, com chave nula quando não informado", () => {
    expect(patientClinicalDisplay({ tabagismo: "atual", diabetes: false })).toEqual([
      { field: "ladoDominante", labelKey: "dominantSide", valueKey: null },
      { field: "tabagismo", labelKey: "smoking", valueKey: "smokingCurrent" },
      { field: "diabetes", labelKey: "diabetes", valueKey: "no" },
      { field: "nivelAtividade", labelKey: "activityLevel", valueKey: null },
    ]);
  });

  it("link do formulário da cirurgia abre o modal de edição do prontuário", () => {
    expect(patientEditHref(42)).toBe("/patients/42?edit=1");
    expect(shouldOpenPatientEdit("?edit=1")).toBe(true);
    expect(shouldOpenPatientEdit("?tab=docs")).toBe(false);
    expect(shouldOpenPatientEdit("")).toBe(false);
  });

  it("toda chave de rótulo existe em pt-BR e es (paridade)", () => {
    const keys = new Set<string>(["clinicalProfile", "clinicalProfileHelp", "notInformed", "clearSelection"]);
    for (const f of PATIENT_CLINICAL_FIELDS) {
      keys.add(PATIENT_CLINICAL_LABEL_KEYS[f]);
      for (const k of Object.values(PATIENT_CLINICAL_VALUE_KEYS[f])) keys.add(k);
    }
    for (const k of keys) {
      expect((messages["pt-BR"] as Record<string, string>)[k], `pt-BR ${k}`).toBeTruthy();
      expect((messages.es as Record<string, string>)[k], `es ${k}`).toBeTruthy();
    }
    for (const k of ["preopPatientProfile", "preopPatientProfileHelp", "preopEditPatient", "preopSelectPatient"]) {
      expect((surgeryShoulderMessages["pt-BR"] as Record<string, string>)[k], `pt-BR ${k}`).toBeTruthy();
      expect((surgeryShoulderMessages.es as Record<string, string>)[k], `es ${k}`).toBeTruthy();
    }
    expect(messages.es.smokingFormer).toBe("Exfumador");
  });
});

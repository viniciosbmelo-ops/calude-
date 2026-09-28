import { describe, expect, it } from "vitest";
import { physioClinicalLabel, physioMessages } from "@/locales/physio";
import {
  ASSESSMENT_META, COMMON_FIELDS, RED_FLAG_LABELS, computedLabel, computedValueLabel, isControlledComputedValue,
} from "@/lib/rehab-assessments";

describe("physiotherapy locale catalog", () => {
  it("keeps the PT-BR and Spanish catalogs structurally complete", () => {
    expect(Object.keys(physioMessages.es).sort()).toEqual(Object.keys(physioMessages["pt-BR"]).sort());
  });

  it("provides representative Spanish access, form, validation and subscription copy", () => {
    expect(physioMessages.es.inviteTitle).toBe("Invitación de derivación");
    expect(physioMessages.es.diagnosisTreatment).toContain("Diagnóstico");
    expect(physioMessages.es.patientCreateError).toBe("Error al registrar al paciente");
    expect(physioMessages.es.manageSubscription).toBe("Gestionar suscripción");
  });

  it("translates labels without changing persisted enum values", () => {
    const persisted = { assessmentType: "retorno_esporte", option: "nao_apto", unit: "kgf" };
    expect(physioClinicalLabel("es", "Retorno ao esporte")).toBe("Retorno al deporte");
    expect(physioClinicalLabel("es", "Não apto")).toBe("No apto");
    expect(persisted).toEqual({ assessmentType: "retorno_esporte", option: "nao_apto", unit: "kgf" });
  });

  it("localizes assessment names, fields and options", () => {
    expect(Object.keys(ASSESSMENT_META)).toEqual(["retorno_esporte"]);
    expect(physioClinicalLabel("es", ASSESSMENT_META.retorno_esporte.label)).toBe("Retorno al deporte");
    expect(physioClinicalLabel("es", ASSESSMENT_META.retorno_esporte.fields[0].label)).toBe("Decisión");
    expect(physioClinicalLabel("es", ASSESSMENT_META.retorno_esporte.fields[0].options![2].label)).toBe("No apto");
    expect(physioClinicalLabel("es", COMMON_FIELDS[0].label)).toBe("Observaciones");
    expect(RED_FLAG_LABELS).toEqual({});
    expect(physioClinicalLabel("es", computedValueLabel("dentro_da_meta", true))).toBe("Sí");
  });

  it("keeps computed measurements and unknown professional text unchanged", () => {
    expect(computedValueLabel("escore", 87.4)).toBe("87.4");
    expect(computedValueLabel("campo_livre", "Texto do profissional")).toBe("Texto do profissional");
    expect(computedValueLabel("campo_livre", "Bom")).toBe("Bom");
    expect(computedValueLabel("campo_livre", "Não")).toBe("Não");
    expect(isControlledComputedValue("campo_livre", "Bom")).toBe(false);
    expect(isControlledComputedValue("campo_livre", "Não")).toBe(false);
    expect(isControlledComputedValue("classificacao", "bom")).toBe(true);
    expect(computedLabel("campo_desconhecido")).toBe("campo_desconhecido");
  });

  it("preserves user text and clinical codes without a catalog entry", () => {
    expect(physioClinicalLabel("es", "SH_CUFF")).toBe("SH_CUFF");
    expect(physioClinicalLabel("es", "Texto escrito pelo paciente")).toBe("Texto escrito pelo paciente");
  });
});
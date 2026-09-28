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

  it("localizes assessment names, fields, options, indicators and red flags", () => {
    expect(physioClinicalLabel("es", ASSESSMENT_META.adm.label)).toBe("ADM (amplitud de movimiento)");
    expect(physioClinicalLabel("es", ASSESSMENT_META.hop.label)).toBe("Pruebas de salto");
    expect(physioClinicalLabel("es", ASSESSMENT_META.tug.label)).toBe("TUG (levantarse y caminar cronometrado)");
    expect(physioClinicalLabel("es", ASSESSMENT_META.sts_30s.label)).toBe("Sentarse y levantarse en 30 s");
    expect(physioClinicalLabel("es", ASSESSMENT_META.dor_carga.fields[0].label)).toBe("EVA en sentadilla declinada unipodal (0–10)");
    expect(physioClinicalLabel("es", ASSESSMENT_META.retorno_esporte.fields[0].label)).toBe("Decisión");
    expect(physioClinicalLabel("es", ASSESSMENT_META.retorno_esporte.fields[0].options![2].label)).toBe("No apto");
    expect(physioClinicalLabel("es", COMMON_FIELDS[0].label)).toBe("Observaciones");
    expect(physioClinicalLabel("es", RED_FLAG_LABELS.quadriceps_lsi_below_90)).toBe("LSI de cuádriceps < 90 %");
    expect(physioClinicalLabel("es", RED_FLAG_LABELS.hop_lsi_below_90)).toBe("LSI de salto < 90 %");
    expect(physioClinicalLabel("es", computedLabel("lsi_hop_medio"))).toBe("LSI medio de las pruebas de salto");
    expect(physioClinicalLabel("es", computedValueLabel("classificacao", "bom"))).toBe("Bueno");
    expect(physioClinicalLabel("es", computedValueLabel("dentro_da_meta", true))).toBe("Sí");
  });

  it("keeps computed measurements and unknown professional text unchanged", () => {
    expect(computedValueLabel("lsi_quadriceps", 87.4)).toBe("87.4");
    expect(computedValueLabel("campo_livre", "Texto do profissional")).toBe("Texto do profissional");
    expect(computedValueLabel("campo_livre", "Bom")).toBe("Bom");
    expect(computedValueLabel("campo_livre", "Não")).toBe("Não");
    expect(isControlledComputedValue("campo_livre", "Bom")).toBe(false);
    expect(isControlledComputedValue("campo_livre", "Não")).toBe(false);
    expect(isControlledComputedValue("classificacao", "bom")).toBe(true);
    expect(computedLabel("codigo_lca")).toBe("codigo_lca");
  });

  it("preserves user text and clinical codes without a catalog entry", () => {
    expect(physioClinicalLabel("es", "LCA")).toBe("LCA");
    expect(physioClinicalLabel("es", "Texto escrito pelo paciente")).toBe("Texto escrito pelo paciente");
  });
});
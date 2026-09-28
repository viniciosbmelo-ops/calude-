import { describe, expect, it } from "vitest";
import { complianceFlagText } from "@/locales/regen-compliance";
import { patientAgeFromDob, prpComplianceProduct } from "@/lib/regen-compliance";

describe("regenerative compliance localization", () => {
  it("localizes known orthopedic compliance flags", () => {
    expect(complianceFlagText("es", {
      code: "HS01",
      severity: "block",
      message: "Infecção ativa — procedimento contraindicado. Trate a infecção antes de prosseguir.",
    })).toBe("Infección activa — procedimiento contraindicado. Trate la infección antes de continuar.");
  });

  it("preserves dynamic clinical values and unknown flags", () => {
    const flag = {
      code: "HS03",
      severity: "warning" as const,
      message: "Diabetes com HbA1c 8.4% > 7,5% — controle glicêmico subótimo reduz eficácia biológica. Otimize antes do procedimento.",
    };
    expect(complianceFlagText("es", flag)).toBe(
      "Diabetes con HbA1c 8.4% > 7,5% — el control glucémico subóptimo reduce la eficacia biológica. Optimícelo antes del procedimiento.",
    );
    expect(complianceFlagText("es", {
      code: "CUSTOM",
      severity: "info",
      message: "Texto clínico livre 8.4%",
    })).toBe("Texto clínico livre 8.4%");
    expect(complianceFlagText("pt-BR", flag)).toBe(flag.message);
  });

  it("covers every compliance rule and retains its measured value", () => {
    expect(complianceFlagText("es", {
      code: "HS06",
      severity: "warning",
      message: "IMC 41.2 kg/m² — obesidade grau III; eficácia reduzida e maior risco de complicações técnicas.",
    })).toContain("IMC 41.2 kg/m²");
    expect(complianceFlagText("es", {
      code: "LB01",
      severity: "warning",
      message: "Contagem plaquetária 127 × 10³/µL < 150 — concentrado plaquetário com menor potência biológica esperada.",
    })).toContain("Recuento plaquetario 127 × 10³/µL");
    expect(complianceFlagText("es", {
      code: "LB02",
      severity: "info",
      message: "3 analito(s) laboratorial(is) fora de referência — revise antes de prosseguir com o procedimento.",
    })).toContain("3 analito(s) de laboratorio");
    expect(complianceFlagText("es", {
      code: "WN01",
      severity: "warning",
      message: "Paciente pediátrico (< 18 anos) — evidência limitada.",
    })).toContain("Paciente pediátrico (< 18 años)");
    expect(complianceFlagText("es", {
      code: "WN02",
      severity: "warning",
      message: "Evento adverso registrado.",
    })).toContain("Evento adverso registrado");
    expect(complianceFlagText("es", {
      code: "WN03",
      severity: "info",
      message: "IMC 34.6 kg/m² — sobrepeso/obesidade; considere otimização do peso.",
    })).toContain("IMC 34.6 kg/m²");
  });

  it("derives pediatric age and selects a PRP-family product for rule evaluation", () => {
    expect(patientAgeFromDob("2010-09-10", new Date(2026, 7, 27))).toBe(15);
    expect(patientAgeFromDob("2010-08-20", new Date(2026, 7, 27))).toBe(16);
    expect(patientAgeFromDob("invalid", new Date(2026, 7, 27))).toBeNull();
    expect(prpComplianceProduct(["AH", "LP_PRP", "BMAC"])).toBe("LP_PRP");
    expect(prpComplianceProduct(["AH", "BMAC"])).toBeUndefined();
  });
});
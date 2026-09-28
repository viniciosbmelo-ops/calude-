import { describe, expect, it } from "vitest";
import { buildSurgicalConsentDocument, generateSurgicalConsentPDF } from "./surgery-consent-pdf";

describe("surgical consent document", () => {
  it("combines relevant consent sections without duplicating shared content", () => {
    const document = buildSurgicalConsentDocument(
      {
        dataCirurgia: "2026-08-24",
        lado: "Direito",
        diagnostico: "Rotura completa do manguito rotador e fratura do úmero proximal",
        tiposProcedimento: ["SH_CUFF", "SH_BICEPS_SLAP", "SH_FRACTURE"],
        procedimentoRealizado: "Reparo do manguito rotador, Tenodese do cabo longo do bíceps",
        patient: { nome: "Maria José da Silva", cpf: "123.456.789-00", dataNascimento: "1980-01-10" },
      },
      { nome: "Dr. João da Silva", crm: "12345", crmEstado: "SP" },
    );

    expect(document.procedureLabel).toBe("Reparo do manguito rotador; Tenodese do cabo longo do bíceps");
    expect(document.families).toEqual(["fratura", "tendao"]);
    expect(document.sections.map((section) => section.title)).toEqual([
      "Tratamento cirúrgico de fratura",
      "Reparo ou reconstrução tendínea",
    ]);
    expect(document.laterality).toBe("Direito");
    expect(document.procedureDate).toBe("24/08/2026");
    expect(document.doctorCrm).toBe("CRM SP/12345");
  });

  it("never mentions the knee in any section", () => {
    const document = buildSurgicalConsentDocument({
      tiposProcedimento: ["SH_CUFF", "SH_FRACTURE", "SH_ORTHOBIO", "SH_INSTABILITY", "EL_STIFF_OA"],
    });
    expect(JSON.stringify(document)).not.toMatch(/joelho|rodilla|patel|menisc|ligamentar/i);
  });

  it("uses patient laterality as fallback and supplies a generic section for incomplete drafts", () => {
    const document = buildSurgicalConsentDocument({
      patient: { nome: "Paciente", lado: "Esquerdo" },
      tiposProcedimento: [],
    });

    expect(document.laterality).toBe("Esquerdo");
    expect(document.families).toEqual(["outros"]);
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0].title).toBe("Outros procedimentos de ombro e cotovelo");
    expect(document.procedureLabel).toBe("Procedimento cirúrgico");
  });

  it("falls back to case-type names and localizes generic copy", () => {
    const document = buildSurgicalConsentDocument(
      { tiposProcedimento: ["EL_DISTAL_BICEPS", "EL_INSTABILITY"] },
      undefined,
      "es",
    );

    expect(document.procedureLabel).toContain("; ");
    expect(document.families).toEqual(["tendao", "outros"]);
    expect(document.sections[1].title).toBe("Otros procedimientos de hombro y codo");
  });

  it("renders a combined consent term on one A4 page", async () => {
    const { doc } = await generateSurgicalConsentPDF(
      {
        dataCirurgia: "2026-08-24",
        hospital: "Hospital Central",
        lado: "Direito",
        diagnostico: "Caso cirúrgico combinado do ombro",
        tiposProcedimento: ["SH_CUFF", "SH_FRACTURE", "SH_ORTHOBIO", "SH_INSTABILITY"],
        procedimentoRealizado: "Reparo do manguito rotador, Osteossíntese do úmero proximal, Bankart artroscópico",
        patient: { nome: "Maria José da Silva", cpf: "123.456.789-00", dataNascimento: "1980-01-10" },
      },
      { nome: "Dr. João da Silva", crm: "12345", crmEstado: "SP" },
    );

    expect(doc.getNumberOfPages()).toBe(1);
  });
});

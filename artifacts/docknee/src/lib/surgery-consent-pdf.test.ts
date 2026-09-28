import { describe, expect, it } from "vitest";
import { buildSurgicalConsentDocument, generateSurgicalConsentPDF } from "./surgery-consent-pdf";

describe("surgical consent document", () => {
  it("combines relevant consent sections without duplicating shared content", () => {
    const document = buildSurgicalConsentDocument(
      {
        dataCirurgia: "2026-08-24",
        lado: "Direito",
        diagnostico: "Gonartrose medial e lesão osteocondral",
        tiposProcedimento: ["Artroplastias", "Lesões Osteocondrais", "Osteotomia"],
        procedimentosDetalhados: JSON.stringify({
          artroplastia: { tipo: "TKA" },
          osteotomia: { tibial: true },
          osteocondral: { procedimentos: ["Mosaicoplastia"] },
        }),
        patient: { nome: "Maria José da Silva", cpf: "123.456.789-00", dataNascimento: "1980-01-10" },
      },
      { nome: "Dr. João da Silva", crm: "12345", crmEstado: "SP" },
    );

    expect(document.procedureLabel).toContain("Artroplastia Total do Joelho");
    expect(document.procedureLabel).toContain("Mosaicoplastia");
    expect(document.families).toEqual(["artroplastia", "osteotomia", "osteocondral"]);
    expect(document.sections.map((section) => section.title)).toEqual([
      "Artroplastia do joelho",
      "Osteotomia do joelho",
      "Tratamento de lesão osteocondral",
    ]);
    expect(document.laterality).toBe("Direito");
    expect(document.procedureDate).toBe("24/08/2026");
    expect(document.doctorCrm).toBe("CRM SP/12345");
  });

  it("uses patient laterality as fallback and supplies a generic section for incomplete drafts", () => {
    const document = buildSurgicalConsentDocument({
      patient: { nome: "Paciente", lado: "Esquerdo" },
      tiposProcedimento: [],
    });

    expect(document.laterality).toBe("Esquerdo");
    expect(document.families).toEqual(["outros"]);
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0].title).toBe("Outros procedimentos do joelho");
  });

  it("localizes generated procedure labels without changing stored procedure values", () => {
    const document = buildSurgicalConsentDocument(
      {
        tiposProcedimento: ["Artroplastias", "Lesão Ligamentar", "Lesões Osteocondrais"],
        ligamentosAcometidos: ["LCA"],
        procedimentosDetalhados: JSON.stringify({ artroplastia: { tipo: "TKA" }, osteocondral: { procedimentos: ["Mosaicoplastia"] } }),
      },
      undefined,
      "es",
    );

    expect(document.procedureLabel).toContain("Artroplastia total de rodilla");
    expect(document.procedureLabel).toContain("Reconstrucción/reparación de LCA");
    expect(document.procedureLabel).toContain("Mosaicoplastia");
  });

  it("renders a combined consent term on one A4 page", async () => {
    const { doc } = await generateSurgicalConsentPDF(
      {
        dataCirurgia: "2026-08-24",
        hospital: "Hospital Central",
        lado: "Direito",
        diagnostico: "Caso cirúrgico combinado do joelho",
        tiposProcedimento: [
          "Artroplastias",
          "Lesão Ligamentar",
          "Lesão Meniscal",
          "Instabilidade Patelar",
          "Osteotomia",
          "Lesões Osteocondrais",
          "Fraturas",
          "Rupturas Tendíneas",
          "Ortobiológicos",
          "Outros Procedimentos",
        ],
        ligamentosAcometidos: ["LCA", "LCP"],
        procedimentosDetalhados: JSON.stringify({
          artroplastia: { tipo: "TKA" },
          osteotomia: { tibial: true },
          osteocondral: { procedimentos: ["Mosaicoplastia"] },
          patelar: { tecnicas: ["Reconstrução do MPFL"] },
          fraturas: ["Fratura de Patela"],
          tendoes: ["Ruptura do Tendão Patelar"],
          outrosProcedimentos: ["Procedimento complementar"],
          ortobiologico: { prp: true },
        }),
        patient: { nome: "Maria José da Silva", cpf: "123.456.789-00", dataNascimento: "1980-01-10" },
      },
      { nome: "Dr. João da Silva", crm: "12345", crmEstado: "SP" },
    );

    expect(doc.getNumberOfPages()).toBe(1);
  });
});
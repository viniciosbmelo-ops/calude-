import { describe, expect, it } from "vitest";
import { generateProntuarioPDF } from "./prontuario-pdf";

describe("prontuário PDF localization", () => {
  it("uses explicitly supplied Spanish locale while preserving the filename", async () => {
    const { doc, filename } = await generateProntuarioPDF(
      {
        tipo: "laudo",
        titulo: "Informe de seguimiento",
        conteudo: "Contenido clínico ingresado por el usuario.",
        data: "2026-08-24",
        pacienteNome: "María García",
        pacienteDataNascimento: "1980-01-10",
        medicoNome: "Dra. Ana López",
        medicoCrm: "12345",
        medicoCrmEstado: "SP",
        cid: "M23.2",
        tempoAfastamento: "10 días",
      },
      "es",
    );

    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
    expect(doc.output()).toContain("INFORME M");
    expect(doc.output()).not.toContain("LAUDO M");
    expect(filename).toBe("laudo-maría-24-08-2026.pdf");
  });
});
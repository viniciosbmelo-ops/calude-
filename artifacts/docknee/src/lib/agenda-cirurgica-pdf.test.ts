import { describe, expect, it } from "vitest";
import { generateAgendaPDF } from "@/pages/agenda-cirurgica";

describe("Spanish surgical agenda PDF", () => {
  it("uses the explicit locale while preserving record values", () => {
    const { doc } = generateAgendaPDF([{
      id: 1,
      patientId: 2,
      data: "2025-03-18",
      hora: "08:30",
      tipoCirurgia: "Procedimento informado pelo médico",
      hospital: "Hospital Central",
      planoSaude: "Plan Uno",
      codigosCbhpm: JSON.stringify([{ codigo: "30733041", descricao: "Descrição cadastrada", quantidade: 1 }]),
      materiais: JSON.stringify([{ nome: "Material X", quantidade: 2, fornecedor: "Proveedor Y" }]),
      destinatarios: null,
      status: "confirmado",
      observacoes: "Texto del usuario",
      patientNome: "Ana Pérez",
      patientTelefone: null,
    }], "Esta semana", "José Médico", new Date(2025, 2, 17), "es");

    const pdfCommands = ((doc as unknown as { internal: { pages: string[][] } }).internal.pages)
      .flat()
      .join("\n");

    expect(pdfCommands).toContain("AGENDA QUIR");
    expect(pdfCommands).toContain("Total de procedimientos: 1");
    expect(pdfCommands).toContain("Confirmada");
    expect(pdfCommands).toContain("Procedimento informado pelo m");
    expect(pdfCommands).toContain("30733041");
    expect(pdfCommands).not.toContain("Total de procedimentos:");
  });
});
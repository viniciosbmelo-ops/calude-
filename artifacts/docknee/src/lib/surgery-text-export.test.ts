import { describe, expect, it, vi } from "vitest";
import {
  buildSurgeryTextExport,
  copySurgeryText,
  downloadSurgeryText,
  getSurgeryTextFilename,
  selectSurgeryText,
} from "./surgery-text-export";
import {
  CPM_LCM_RECONSTRUCTION_TECHNIQUES,
  displaySurgeryTechniqueOption,
} from "@/locales/surgery-new-techniques";
import { reportCatalogLabel } from "@/locales/reporting-catalogs";

describe("surgery text export", () => {
  const surgery = {
    id: 42,
    doctorId: 9,
    patientId: 7,
    dataCirurgia: "2026-08-21",
    hospital: "Hospital Central",
    tiposProcedimento: ["Reconstrução do LCA", "Sutura meniscal"],
    procedimentoRealizado: "Reconstrução anatômica do LCA.",
    patient: {
      id: 7,
      doctorId: 9,
      nome: "MARIA JOSÉ DA SILVA",
      sexo: "Feminino",
      lado: "Direito",
      telefone: "(11) 99999-9999",
      cpf: "123.456.789-00",
      dataNascimento: "1980-01-10",
      endereco: "Rua do Teste, 123",
      createdAt: "2026-08-20T10:00:00.000Z",
    },
    exameLigamentar: {
      id: 8,
      surgeryId: 42,
      lachman: "2+",
      pivotShift: false,
    },
    procedimentoMeniscal: {
      surgeryId: 42,
      tecnicasSutura: ["All-inside"],
      pontosPorTecnica: "{\"All-inside\":3}",
    },
    rxAnaliseJson: "{\"eixoMecanico\":{\"graus\":5,\"classificacao\":\"varo\"}}",
    followups: [{ id: 5, surgeryId: 42, periodo: "6 semanas", observacoes: "Boa evolução." }],
  };

  it("creates readable sections without technical identifiers or raw JSON", () => {
    const content = buildSurgeryTextExport(surgery);

    expect(content).toContain("IDENTIFICAÇÃO DO PACIENTE");
    expect(content).toContain("Nome: MARIA JOSÉ DA SILVA");
    expect(content).toContain("Pontos por técnica:");
    expect(content).toContain("All inside: 3");
    expect(content).toContain("Pivot Shift: Não");
    expect(content).toContain("PLANEJAMENTO RADIOGRÁFICO");
    expect(content).not.toContain("[object Object]");
    expect(content).not.toContain("Doctor Id");
    expect(content).not.toContain("Surgery Id");
    expect(content).not.toContain("Created At");
  });

  it("uses initials in privacy mode and a safe filename", () => {
    const content = buildSurgeryTextExport(surgery, { privacyMode: true });

    expect(content).toContain("Nome: M. J. D. S.");
    expect(content).toContain("Sexo: Feminino");
    expect(content).toContain("Lado: Direito");
    expect(content).not.toContain("Nome: MARIA JOSÉ DA SILVA");
    expect(content).not.toContain("(11) 99999-9999");
    expect(content).not.toContain("123.456.789-00");
    expect(content).not.toContain("1980-01-10");
    expect(content).not.toContain("Rua do Teste, 123");
    expect(getSurgeryTextFilename(surgery)).toBe("PROCEDIMENTO-MARIA-JOSE-DA-SILVA-2026-08-21-42.txt");
    expect(getSurgeryTextFilename(surgery, true)).toBe("PROCEDIMENTO-PACIENTE-2026-08-21-42.txt");
  });

  it("localizes generated Spanish headings, labels, booleans, and dates", () => {
    const content = buildSurgeryTextExport(surgery, { locale: "es" });

    expect(content).toContain("RESUMEN COMPLETO DEL PROCEDIMIENTO");
    expect(content).toContain("IDENTIFICACIÓN DEL PACIENTE");
    expect(content).toContain("Nombre: MARIA JOSÉ DA SILVA");
    expect(content).toContain("Fecha del procedimiento: 21/08/2026");
    expect(content).toContain("Sexo: Femenino");
    expect(content).toContain("Lado: Derecho");
    expect(content).toContain("Procedimientos: Reconstrucción del LCA; Sutura meniscal");
    expect(content).toContain("Período: 6 semanas");
    expect(content).toContain("Pivot Shift: No");
    expect(content).toContain("PLANIFICACIÓN RADIOGRÁFICA");
    expect(content).toContain("SEGUIMIENTOS POSOPERATORIOS");
    expect(content).not.toContain("RESUMO COMPLETO DO PROCEDIMENTO");
  });

  it("localizes known fracture controls but preserves unknown free text", () => {
    const content = buildSurgeryTextExport({
      ...surgery,
      diagnostico: "Dor descrita livremente pelo cirurgião",
      distalFemurFracture: {
        controleDanos: true,
        acesso: ["Duplo (medial e lateral)", "Acesso criado pelo cirurgião"],
        cirurgia: ["Haste intramedular retrógrada"],
        complicacoesAgudas: ["Infecção", "Evento clínico personalizado"],
      },
    }, { locale: "es" });

    expect(content).toContain("Control de daños: Sí");
    expect(content).toContain("Acceso: Doble (medial y lateral); Acesso criado pelo cirurgião");
    expect(content).toContain("Cirugía: Clavo intramedular retrógrado");
    expect(content).toContain("Complicaciones agudas: Infección; Evento clínico personalizado");
    expect(content).toContain("Diagnóstico: Dor descrita livremente pelo cirurgião");
  });

  it("keeps the CPM LCM Lind option canonical in Portuguese and Spanish TXT exports", () => {
    expect(CPM_LCM_RECONSTRUCTION_TECHNIQUES).toEqual([
      "Canuto",
      "Laprade",
      "Stannard",
      "Lind",
      "Outra",
    ]);
    expect(displaySurgeryTechniqueOption("pt-BR", "Lind")).toBe("Lind");
    expect(displaySurgeryTechniqueOption("es", "Lind")).toBe("Lind");
    expect(reportCatalogLabel("pt-BR", "Lind")).toBe("Lind");
    expect(reportCatalogLabel("es", "Lind")).toBe("Lind");

    const saved = {
      ...surgery,
      cpmReconstruction: {
        abordagem: "lcm_isolado",
        lcmTecnica: "Lind",
      },
    };
    expect(buildSurgeryTextExport(saved)).toContain("Lind");
    expect(buildSurgeryTextExport(saved, { locale: "es" })).toContain("Lind");
  });

  it("serializes the LOA femoral fixation with a human-readable label", () => {
    const content = buildSurgeryTextExport({
      ...surgery,
      reforco: JSON.stringify({
        loa: true,
        loaEnxerto: "Semitendíneo",
        loaFixacao: "Âncora de Sutura",
      }),
    });

    expect(content).toContain("Fixação femoral do LOA: Âncora de Sutura");
  });

  it("keeps saved LEAP false and zero inputs visible without recalculation", () => {
    const content = buildSurgeryTextExport({
      ...surgery,
      aclLeapDecision: {
        pivotShift: 0,
        ptsGraus: 0,
        revisao: false,
        leapIndicado: false,
        resultado: {
          leapIndicado: false,
          regras: [{ presente: false, nota: 0 }],
        },
      },
    });

    expect(content).toContain("Pivot Shift: 0");
    expect(content).toContain("PTS (graus): 0");
    expect(content).toContain("Revisão: Não");
    expect(content).toContain("Indicação LEAP: Não");
    expect(content).toContain("Presente: Não");
    expect(content).toContain("Nota: 0");
  });

  it("exports a J Sign grade only when the saved result is positive", () => {
    const positive = buildSurgeryTextExport({
      ...surgery,
      examePatelar: { jSign: true, jSignGrau: 3 },
    });
    expect(positive).toContain("J Sign: Sim");
    expect(positive).toContain("Grau do J Sign: 3");

    const negative = buildSurgeryTextExport({
      ...surgery,
      examePatelar: { jSign: false, jSignGrau: 4 },
    });
    expect(negative).toContain("J Sign: Não");
    expect(negative).not.toContain("Grau do J Sign");
  });

  it("localizes saved LEAP controls while preserving its free-text rationale", () => {
    const content = buildSurgeryTextExport({
      ...surgery,
      aclLeapDecision: {
        leapIndicado: "Não",
        forcaMaxima: "Fortemente recomendado",
        justificativa: "Não recomendado pelo cirurgião — texto livre.",
        resultado: { leapIndicado: "Sim" },
      },
    }, { locale: "es" });

    expect(content).toContain("Indicación LEAP: No");
    expect(content).toContain("Fuerza máxima: Fuertemente recomendado");
    expect(content).toContain("Justificación: Não recomendado pelo cirurgião — texto livre.");
    expect(content).toContain("Indicación LEAP: Sí");
  });

  it("renders bilateral saved clinical data under its owning knee only", () => {
    const content = buildSurgeryTextExport({
      ...surgery,
      lado: "Bilateral",
      aclLeapDecision: {
        idade: 99,
        resultado: { regras: [{ justificativa: "FLAT_SHOULD_NOT_RENDER" }] },
      },
      procedimentosDetalhados: JSON.stringify({
        bilateral: {
          schemaVersion: 1,
          byLimb: {
            direito: {
              tipoCaso: "Lesão Ligamentar",
              aclLeapDecision: {
                idade: 20,
                leapIndicado: true,
                resultado: { regras: [{ justificativa: "RIGHT_SIDE_REASONING" }] },
              },
            },
            esquerdo: {
              tipoCaso: "Lesão Ligamentar",
              aclLeapDecision: {
                idade: 40,
                leapIndicado: false,
                resultado: { regras: [{ justificativa: "LEFT_SIDE_REASONING" }] },
              },
            },
          },
        },
      }),
      followups: [{ periodo: "6 semanas", observacoes: "Acompanhamento compartilhado" }],
    });

    expect(content).toContain("JOELHO DIREITO");
    expect(content).toContain("RIGHT_SIDE_REASONING");
    expect(content).toContain("JOELHO ESQUERDO");
    expect(content).toContain("LEFT_SIDE_REASONING");
    expect(content).toContain("Acompanhamento compartilhado");
    expect(content).not.toContain("FLAT_SHOULD_NOT_RENDER");
  });

  it("keeps bilateral J Sign grades independent by limb", () => {
    const content = buildSurgeryTextExport({
      ...surgery,
      lado: "Bilateral",
      procedimentosDetalhados: JSON.stringify({
        bilateral: {
          schemaVersion: 1,
          byLimb: {
            direito: { examePatelar: { jSign: true, jSignGrau: 1 } },
            esquerdo: { examePatelar: { jSign: true, jSignGrau: 4 } },
          },
        },
      }),
    });
    const right = content.indexOf("JOELHO DIREITO");
    const left = content.indexOf("JOELHO ESQUERDO");
    expect(right).toBeGreaterThanOrEqual(0);
    expect(left).toBeGreaterThan(right);
    expect(content.slice(right, left)).toContain("Grau do J Sign: 1");
    expect(content.slice(right, left)).not.toContain("Grau do J Sign: 4");
    expect(content.slice(left)).toContain("Grau do J Sign: 4");
    expect(content.slice(left)).not.toContain("Grau do J Sign: 1");
  });

  it("copies through the user-activated clipboard helper and exposes selection fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copySurgeryText("Acentuação: joelho — lado direito");
    expect(writeText).toHaveBeenCalledWith("Acentuação: joelho — lado direito");

    const textarea = {
      value: "linha 1\nlinha 2",
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    } as unknown as HTMLTextAreaElement;
    expect(selectSurgeryText(textarea)).toBe(true);
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, textarea.value.length);
    vi.unstubAllGlobals();
  });

  it("downloads UTF-8 text and cleans up the object URL", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:text-export");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const remove = vi.fn();
    const link = { href: "", download: "", style: {}, click, remove };
    const appendChild = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { appendChild } });
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });

    try {
      await expect(downloadSurgeryText("Acentuação\nsegunda linha", "procedimento.txt")).resolves.toBe("downloaded");
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(link.download).toBe("procedimento.txt");
      expect(click).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:text-export");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the text filename path-safe when date or id contain separators", () => {
    expect(getSurgeryTextFilename({
      patient: { nome: "Ana / Joana" },
      dataCirurgia: "2026/08/21",
      id: "../42",
    })).toBe("PROCEDIMENTO-ANA-JOANA-2026-08-21-42.txt");
  });
});
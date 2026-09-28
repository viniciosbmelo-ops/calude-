import { describe, expect, it } from "vitest";
import {
  generateSurgeryPDF,
  resolveSavedOcdResult,
  splitSurgeryPdfGeneratedText,
} from "./surgery-pdf";
import { removeMeniscalSideDetails } from "./meniscal-details";
import {
  surgeryPdfAuthoredText,
  surgeryPdfControlledText,
  surgeryPdfOcdText,
} from "@/locales/surgery-pdf";
import type { BioReadyResult } from "./regen-bioready";

const freeText = "Paciente refere dor após futebol; manter expressão 'Não informado' exatamente.";

const bioReady: BioReadyResult = {
  score: 55,
  isIncomplete: false,
  grade: "optimize",
  gradeLabel: "Otimizar antes do proc.",
  gradeColor: "#D97706",
  gradeBg: "#FFFBEB",
  dataCompleteness: 0.8,
  factors: [{
    id: "smoking",
    label: "Tabagismo",
    category: "Estilo de vida",
    score: 0,
    maxScore: 10,
    status: "red",
    detail: "Fumante ativo",
    modifiable: true,
    recommendation: "Abstinência ao tabaco mínima de 4–6 semanas antes do procedimento — o tabagismo ativo reduz isquemia local e prejudica a resposta biológica.",
  }],
  topRecommendations: [
    "Abstinência ao tabaco mínima de 4–6 semanas antes do procedimento — o tabagismo ativo reduz isquemia local e prejudica a resposta biológica.",
  ],
};

function assertPdfTextStaysAboveFooter(doc: { internal: { pages: unknown[] } }) {
  const pages = doc.internal.pages.slice(1) as string[][];
  const textY = pages.flatMap((page) => page
    .map((operation) => operation.match(/(-?\d+(?:\.\d+)?) Td$/)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number));
  // jsPDF's page stream uses points measured from the bottom. The footer is
  // around 20pt; clinical content should remain above the 276mm content edge
  // (about 59pt), even when a value spans multiple pages.
  const clinicalTextY = textY.filter((value) => value > 25);
  expect(clinicalTextY.every((value) => value >= 55 && value <= 820)).toBe(true);
  expect(textY.some((value) => value > 25 && value < 50)).toBe(false);
}

describe("surgery PDF localization", () => {
  it("localizes authored copy, controlled procedures, BioReady and OCD algorithm text", () => {
    expect(surgeryPdfAuthoredText("es", "2. Classificacao do Caso"))
      .toBe("2. Clasificación del caso");
    expect(surgeryPdfAuthoredText("es", "BioReady Score® — Prontidao Biologica"))
      .toBe("BioReady Score® — Preparación biológica");
    expect(surgeryPdfAuthoredText("es", "Exame Fisico Ligamentar"))
      .toBe("Examen físico ligamentario");
    expect(surgeryPdfAuthoredText("es", "Tamanho")).toBe("Tamaño");
    expect(surgeryPdfAuthoredText("es", "Grau ICRS")).toBe("Grado ICRS");
    expect(surgeryPdfControlledText("es", "Artroplastia Total do Joelho (ATJ)"))
      .toBe("Artroplastia total de rodilla (ATJ)");
    expect(surgeryPdfControlledText("es", "Otimizar antes do proc."))
      .toBe("Optimizar antes del procedimiento");
    expect(surgeryPdfOcdText("es", "CANDIDATO A DISCUSSÃO DE RESTAURAÇÃO FOCAL"))
      .toBe("CANDIDATO A DISCUSIÓN DE RESTAURACIÓN FOCAL");
  });

  it("keeps Portuguese fallback and never guesses unknown/free clinical text", () => {
    expect(surgeryPdfAuthoredText("pt-BR", "Resumo Cirurgico")).toBe("Resumo Cirurgico");
    expect(surgeryPdfControlledText("pt-BR", "Sim")).toBe("Sim");
    const collisionText = "qualidade ruim, corticoide e cartilagem — Não informado pelo paciente";
    expect(surgeryPdfControlledText("es", collisionText)).toBe(collisionText);
    expect(surgeryPdfControlledText("es", "≥ 6,5° — Hiperlaxidade"))
      .toBe("≥ 6,5° — Hiperlaxitud");
    expect(surgeryPdfControlledText("es", "Ortobiologico")).toBe("Ortobiológico");
    expect(surgeryPdfControlledText("es", "Reparo do LCA")).toBe("Reparación del LCA");
    expect(surgeryPdfControlledText("es", "Fêmur")).toBe("Fémur");
  });

  it("generates a Spanish surgical PDF while preserving clinical free text", async () => {
    const { doc, filename } = await generateSurgeryPDF({
      dataCirurgia: "2026-08-27",
      tipoCaso: "Artroplastias",
      diagnostico: freeText,
      alinhamento: "Varo",
      tiposProcedimento: ["Artroplastias"],
      observacoes: freeText,
      patient: {
        nome: "María García",
        sexo: "F",
        cpf: "123.456.789-00",
        dataNascimento: "1980-01-10",
        lado: "Direito",
      },
      procedimentosDetalhados: JSON.stringify({
        artroplastia: {
          tipo: "TKA",
          alinhamentoMembro: "Varo",
          instabilidade: "Coronal",
          instabilidadeGrau: "Nao informado",
          flexaoGraus: "120",
          extensaoGraus: "0",
          fixacao: "Cimentada",
          garrote: "Sim",
          txa: "Sim",
          calcosFemoral: ["Medial", "Lateral"],
          calcosTibial: ["Medial"],
          coneMetafisario: "Sim",
          coneMetafisarioLocal: "Fêmur",
          observacoes: freeText,
        },
      }),
    }, bioReady, "es");

    const output = doc.output();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
    expect(output).toContain("Resumen quir");
    expect(output).toContain("Paciente refere dor");
    expect(output).toContain("Derecho");
    expect(output).not.toContain("Direito");
    expect(output).toContain("Nao informado");
    expect(output).not.toContain("No informado");
    expect(output).toContain("Flexi");
    expect(output).toContain("Cu");
    expect(output).not.toContain("Flexao:");
    expect(output).not.toContain("Calcos Femorais");
    expect(output).not.toContain("Resumo Cirurgico");
    expect(filename).toBe("DocKnee_Resumo_María_García_2026-08-27.pdf");
  });

  it("renders the saved DocKnee AI Decision with false, zero and saved reasoning", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      patient: { nome: "Paciente LEAP" },
      aclLeapDecision: {
        idade: 25,
        sexo: "F",
        enxertoPlanejado: "HT",
        pivotShift: 0,
        lachman: 0,
        hiperextensaoGraus: 6.5,
        revisao: false,
        esqueletoImaturo: false,
        lesaoCronica: false,
        esportePivot: false,
        ptsGraus: 0,
        contralateralLca: false,
        tabagismo: false,
        atrasoCirurgicoDias: 0,
        tunelComprometido: false,
        leapIndicado: true,
        forcaMaxima: "Fortemente recomendado",
        resultado: {
          leapIndicado: true,
          forcaMaxima: "Fortemente recomendado",
          driversNaoModificaveis: [{ id: "age", label: "Idade ≤ 25 anos", presente: true }],
          regras: [{
            id: "L4",
            modulo: "leap",
            forca: "Fortemente recomendado",
            evidencia: ["N-II/III"],
            titulo: "Hiperextensão ≥ 6,5°",
            alavanca: "LEAP (LET/ALLR)",
            justificativa: "Raciocínio salvo: limiar de 6,5° atingido.",
          }],
          fatoresAcessoriosCount: 0,
          camadaSeguranca: null,
          execucaoTecnica: null,
        },
      },
    }, undefined, "es");

    const output = doc.output();
    expect(output).toContain("DOCKNEE AI DECISION");
    expect(output).toContain("Entradas cl");
    expect(output).toContain("No");
    expect(output).not.toMatch(/\bfalse\b/);
    expect(output).toContain("0");
    expect(output).toContain("6.5");
    expect(output).toContain(">= 6,5");
    expect(output).toContain("Raci");
    expect(output).not.toContain("Fortemente recomendado");
    expect(output).toContain("Fuertemente recomendado");
  });

  it("classifies a saved measured PTS value with the shared displayed thresholds", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      exameLigamentar: { slopeTibialPts: 10 },
    });

    const output = doc.output();
    expect(output).toContain("Slope Tibial Posterior");
    expect(output).toContain("10");
    expect(output).toContain("Normal");
    expect(output).toContain("<=11");
    expect(output).not.toContain("Limítrofe");
  });

  it("splits a long saved LEAP rationale without drawing below the footer", async () => {
    const rules = Array.from({ length: 18 }, (_, index) => ({
      id: `LONG-${index}`,
      modulo: "leap",
      forca: "Recomendado",
      evidencia: ["N-V"],
      titulo: `Regra salva ${index}`,
      alavanca: "LEAP",
      justificativa: `${"Justificativa clínica salva — ".repeat(32)}fim da regra ${index}.`,
    }));
    const { doc } = await generateSurgeryPDF({
      tiposProcedimento: ["Lesão Ligamentar"],
      patient: { nome: "Paciente Paginação" },
      aclLeapDecision: {
        idade: 30,
        revisao: false,
        pivotShift: 0,
        leapIndicado: true,
        resultado: {
          leapIndicado: true,
          regras: rules,
          disclaimers: {
            naoCalibrado: "Ressalva salva.",
            populacao: "População salva.",
            vies: "Viés salvo.",
          },
        },
      },
    });

    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    assertPdfTextStaysAboveFooter(doc);
  });

  it("localizes saved boolean inputs as Sim/Não in Portuguese", async () => {
    const { doc } = await generateSurgeryPDF({
      tiposProcedimento: ["Lesão Ligamentar"],
      patient: { nome: "Paciente Booleano" },
      aclLeapDecision: {
        revisao: false,
        leapIndicado: false,
        resultado: { leapIndicado: false, regras: [{ presente: false }] },
      },
    });
    const output = doc.output();
    expect(output).toContain("Não");
    expect(output).not.toMatch(/\bfalse\b/);
  });

  it("renders the optional J Sign grade and omits stale grades on negative results", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Instabilidade Patelofemoral",
      tiposProcedimento: ["Instabilidade Patelofemoral"],
      patient: { nome: "Paciente J Sign" },
      examePatelar: { jSign: true, jSignGrau: 2 },
    });
    const positiveOutput = doc.output();
    expect(positiveOutput).toContain("J Sign");
    expect(positiveOutput).toContain("Grau do J Sign");
    expect(positiveOutput).toContain("2");

    const { doc: negativeDoc } = await generateSurgeryPDF({
      tipoCaso: "Instabilidade Patelofemoral",
      tiposProcedimento: ["Instabilidade Patelofemoral"],
      patient: { nome: "Paciente J Sign Negativo" },
      examePatelar: { jSign: false, jSignGrau: 4 },
    });
    expect(negativeDoc.output()).not.toContain("Grau do J Sign");
  });

  it("keeps bilateral LEAP decisions side-owned and omits the flat compatibility row", async () => {
    const rightDecision = {
      idade: 20,
      revisao: false,
      pivotShift: 3,
      leapIndicado: true,
      resultado: { regras: [{ id: "RIGHT_ONLY", justificativa: "RIGHT_SIDE_REASONING" }] },
    };
    const leftDecision = {
      idade: 40,
      revisao: false,
      pivotShift: 0,
      leapIndicado: false,
      resultado: { regras: [{ id: "LEFT_ONLY", justificativa: "LEFT_SIDE_REASONING" }] },
    };
    const { doc } = await generateSurgeryPDF({
      lado: "Bilateral",
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      patient: { nome: "Paciente Bilateral" },
      // This is the active-limb compatibility projection and must not be
      // attributed to either side.
      aclLeapDecision: {
        idade: 99,
        revisao: false,
        leapIndicado: true,
        resultado: { regras: [{ justificativa: "FLAT_SHOULD_NOT_RENDER" }] },
      },
      procedimentosDetalhados: JSON.stringify({
        bilateral: {
          schemaVersion: 1,
          byLimb: {
            direito: { tipoCaso: "Lesão Ligamentar", aclLeapDecision: rightDecision },
            esquerdo: { tipoCaso: "Lesão Ligamentar", aclLeapDecision: leftDecision },
          },
        },
      }),
    });

    const output = doc.output();
    expect(output).toContain("RIGHT_SIDE_REASONING");
    expect(output).toContain("LEFT_SIDE_REASONING");
    expect(output).not.toContain("FLAT_SHOULD_NOT_RENDER");
  });

  it("resolves persisted nested OCD results before the legacy top-level projection", () => {
    const nested = { classification: "NESTED" };
    const legacy = { classification: "LEGACY" };
    expect(resolveSavedOcdResult({
      exameOsteocondral: { ocdResult: nested },
      ocdAnalysis: legacy,
    })).toBe(nested);
    expect(resolveSavedOcdResult({ ocdAnalysis: legacy })).toBe(legacy);
  });

  it("keeps saved OCD zero and false clinical inputs visible", async () => {
    const { doc } = await generateSurgeryPDF({
      tiposProcedimento: ["Lesões Osteocondrais"],
      patient: { nome: "Paciente OCD" },
      exameOsteocondral: {
        sintomatica: false,
        falhaConservador: false,
        artroseDifusa: false,
        objetivo: "Avaliação sintética",
        tamanhoMm2: 0,
        bancoTecidosDisponivel: false,
        ocdResult: { classification: "OC-SMALL", clinicalStatus: "INDETERMINADO" },
      },
    }, undefined, "es");
    const output = doc.output();
    expect(output).toContain("0 cm");
    expect(output).toContain("No");
    expect(output).toContain("OC-SMALL");
  });

  it("renders ligament, osteotomy, osteochondral and meniscal branches in Spanish", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar", "Lesão Meniscal", "Lesões Osteocondrais", "Osteotomia"],
      ligamentosAcometidos: ["LCA", "LCP", "LCM", "CPL"],
      patient: { nome: "Paciente", sexo: "M", lado: "Esquerdo" },
      exameLigamentar: {
        lachman: 2,
        gavetaNeutra: 2,
        pivotShift: 2,
        aderTest: true,
        gavetaRotInterna: true,
        estresseValgo30: 2,
        estresseVaro30: 1,
        gavetaPosterior: 2,
        quadricepsAtivo: true,
        gavetaRotatoria: true,
        hiperextensao: ">6.5",
      },
      lcaAlgorithm: {
        krirsScore: 7,
        tecnicaRecomendada: "ACL + LET ou LAL",
        justificativa: "Score KRIRS ≥6 — alto risco",
      },
      enxerto: "Tendão Patelar (BTB)",
      fixacaoFemoral: "Parafuso bioabsorvível",
      fixacaoTibial: "Botão cortical",
      cpmReconstruction: {
        abordagem: "lcm_lop",
        lcmTecnica: "Reconstrução com Enxerto",
        lcmEnxerto: "Semitendíneo",
        lcmFixacaoProximal: "Âncoras de Sutura",
        lopTecnica: "Reparo Primário",
      },
      cplReconstruction: {
        tecnica: "Laprade",
        enxertos: [{ nome: "Semitendíneo", diametro: "7 mm" }],
        fixacaoFemoral1: "Parafuso bioabsorvível",
        fixacaoFemoral2: "Botão cortical",
        fixacaoFibular: "Parafuso de Interferência",
        fixacaoTibial: "Âncora",
      },
      lcpReconstruction: {
        grauLesao: "III",
        tecnica: "Transtibial — Banda Dupla",
        enxerto: "Tendão Quadricipital",
        fixacaoFemoral: "Parafuso bioabsorvível",
        fixacaoTibial: "Botão cortical",
      },
      exameOsteocondral: {
        etiologia: "traumatica",
        localizacao: "cfe_medial",
        tamanhoMm2: 2,
        icrsGrau: "IV",
        padrao: "osteocondral",
        profundidade: "osso_exposto",
        osseoStatus: "fragmento",
        continencia: "nao_contida",
        estabilidadeOcd: "instavel",
        bancoTecidosDisponivel: true,
        edemaOsseo: true,
        cistoSubcondral: true,
        fragmentoSolto: true,
        lesaoMeniscalAssociada: true,
        lesaoLigamentarAssociada: true,
        desvioAxial: true,
        rmDisponivel: true,
        ocdResult: {
          classification: "OC-LARGE",
          clinicalStatus: "CANDIDATO A DISCUSSÃO DE RESTAURAÇÃO FOCAL",
          biomechanicalGate: {
            present: true,
            factors: ["Alinhamento varo/valgo"],
            action: "Avaliar e, quando indicado, corrigir o fator mecânico antes ou em conjunto com a restauração condral.",
          },
          recommendations: [{
            procedure: "OCA — aloenxerto osteocondral fresco",
            status: "CONSIDERAR / APROPRIADO NO CENÁRIO",
            rationale: "Defeito osteocondral maior ou com perda óssea relevante favorece solução que restaure cartilagem e osso.",
          }],
        },
      },
      procedimentoMeniscal: {
        sutura: true,
        ladoMedial: true,
        lesaoRaiz: true,
        tecnicasSutura: ["All-inside"],
        numPontos: 3,
        estimuloBiologico: true,
        estimuloOrtobiologico: true,
      },
      procedimentosDetalhados: JSON.stringify({
        osteotomia: { tibial: true, tibialLado: "Medial", tibialTipo: "Abertura" },
        osteocondral: {
          procedimentos: ["Aloenxerto Osteocondral Fresco"],
          fixacaoOcdTipo: "Parafuso bioabsorvível",
        },
      }),
    }, undefined, "es");

    const output = doc.output();
    expect(output).toContain("Sutura meniscal");
    expect(output).toContain("Grado III");
    expect(output).toContain("CANDIDATO A DISCUSI");
    expect(output).toContain("Osteotom");
    expect(output).toContain("Caj");
    expect(output).toContain("Peroneo");
    expect(output).toContain("Quiste subcondral");
    expect(output).toContain("Grado ICRS");
    expect(output).not.toContain("Sutura Meniscal");
    expect(output).not.toContain("Grau III");
    expect(output).not.toContain("Classificacao de Cartilagem");
    expect(output).not.toContain("Gaveta Rot. Interna");
    expect(output).not.toContain("Fibular (LCL + LPF)");
    expect(output).not.toContain("Cisto Subcondral");
    expect(output).not.toContain("Hiperlaxidade");
    expect(output).not.toContain("Exame Fisico Ligamentar");
    expect(output).not.toContain("Grau ICRS");
    expect(output).toContain("Ortobiol");
  });

  it("localizes the LCA repair branch without changing its stored values", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      ligamentosAcometidos: ["LCA"],
      tipoLca: "Reparo",
      localizacaoLesaoLca: "Proximal",
      fixacaoReparoLca: "Âncora de sutura",
      internalBrace: "Sim",
      exameLigamentar: { hiperextensao: "<5", lachman: 1 },
      lcaAlgorithm: {
        krirsScore: 2,
        tecnicaRecomendada: "ACL Isolado",
        justificativa: "Nao informado",
      },
      patient: { nome: "Paciente" },
    }, undefined, "es");
    const output = doc.output();
    expect(output).toContain("Reparaci");
    expect(output).not.toContain("Reparo do LCA");
    expect(output).not.toContain("Hiperlaxidade");
    expect(output).toContain("Nao informado");
    expect(output).not.toContain("No informado");
  });

  it("wraps long CPL and LCP generated descriptions after localization in both locales", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      patient: { nome: "Paciente" },
    });
    const cpl = "Laprade (anatomica) — LCL+T.Popl. (2 femorais) / LCL+LPF (fibular) / LPF (tibial)";
    const lcp = "Grau III — >10 mm | Tibia posterior aos condiles | Indicacao cirurgica";

    const esCpl = splitSurgeryPdfGeneratedText(doc, "es", cpl, 70);
    const ptCpl = splitSurgeryPdfGeneratedText(doc, "pt-BR", cpl, 70);
    const esLcp = splitSurgeryPdfGeneratedText(doc, "es", lcp, 70);
    const ptLcp = splitSurgeryPdfGeneratedText(doc, "pt-BR", lcp, 70);

    expect(esCpl.length).toBeGreaterThan(1);
    expect(ptCpl.length).toBeGreaterThan(1);
    expect(esLcp.length).toBeGreaterThan(1);
    expect(ptLcp.length).toBeGreaterThan(1);
    expect(esCpl.join(" ")).toContain("anatómica");
    expect(ptCpl.join(" ")).toContain("anatomica");
    expect(esLcp.join(" ")).toContain("Grado III");
    expect(ptLcp.join(" ")).toContain("Grau III");
  });

  it("preserves exact catalog-collision text in exam, meniscal and reinforcement free fields", async () => {
    const collisionProcedure = "Artroplastia do Joelho";
    const legacyReinforcement = "Otimizar antes do proc.";
    const { doc: clinicalDoc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar", "Lesão Meniscal"],
      ligamentosAcometidos: ["LCA"],
      reforco: JSON.stringify({
        lal: true,
        lalBanda: "Nao informado",
        lalEnxerto: collisionProcedure,
      }),
      exameLigamentar: {
        observacoesExame: "Nao informado",
        notaClinica: collisionProcedure,
      },
      procedimentoMeniscal: {
        sutura: true,
        observacoesExame: "Nao informado",
      },
      patient: { nome: "Paciente" },
    }, undefined, "es");
    const clinicalOutput = clinicalDoc.output();
    expect(clinicalOutput).toContain("Nao informado");
    expect(clinicalOutput).toContain(collisionProcedure);
    expect(clinicalOutput).not.toContain("No informado");
    expect(clinicalOutput).not.toContain("Artroplastia de rodilla");

    const { doc: legacyDoc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      ligamentosAcometidos: ["LCA"],
      reforco: legacyReinforcement,
      patient: { nome: "Paciente" },
    }, undefined, "es");
    const legacyOutput = legacyDoc.output();
    expect(legacyOutput).toContain(legacyReinforcement);
    expect(legacyOutput).not.toContain("Optimizar antes del procedimiento");
  });

  it("renders the persisted LOA femoral fixation in Portuguese and Spanish", async () => {
    const reinforcement = JSON.stringify({
      loa: true,
      loaEnxerto: "Semitendíneo",
      loaFixacao: "Âncora de Sutura",
    });
    const { doc: ptDoc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      ligamentosAcometidos: ["LCA"],
      reforco: reinforcement,
      patient: { nome: "Paciente LOA" },
    });
    const { doc: esDoc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      ligamentosAcometidos: ["LCA"],
      reforco: reinforcement,
      patient: { nome: "Paciente LOA" },
    }, undefined, "es");

    expect(ptDoc.output()).toContain("Fixacao Femoral");
    expect(ptDoc.output()).toContain("Âncora de Sutura");
    expect(esDoc.output()).toContain("Fijaci");
    expect(esDoc.output()).toContain("Anclaje de sutura");
  });

  it("renders the Portuguese PDF unchanged as the fallback", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Meniscal",
      tiposProcedimento: ["Lesão Meniscal"],
      patient: { nome: "Paciente", lado: "Direito" },
      procedimentoMeniscal: { sutura: true, lesaoRaiz: true },
    });
    const output = doc.output();
    expect(output).toContain("Resumo Cirurgico");
    expect(output).toContain("Sutura Meniscal");
    expect(output).not.toContain("Resumen quir");
  });

  it("preserves the CPM LCM Lind technique in Portuguese and Spanish PDFs", async () => {
    const saved = {
      tipoCaso: "Lesão Ligamentar",
      tiposProcedimento: ["Lesão Ligamentar"],
      ligamentosAcometidos: ["CPM"],
      cpmReconstruction: {
        abordagem: "lcm_isolado",
        lcmTecnica: "Lind",
      },
      patient: { nome: "Paciente CPM" },
    };
    const { doc: ptDoc } = await generateSurgeryPDF(saved);
    const { doc: esDoc } = await generateSurgeryPDF(saved, undefined, "es");

    expect(ptDoc.output()).toContain("Lind");
    expect(esDoc.output()).toContain("Lind");
  });

  it("renders independent medial and lateral meniscal details in new PDFs", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Meniscal",
      tiposProcedimento: ["Lesão Meniscal"],
      patient: { nome: "Paciente", lado: "Direito" },
      procedimentoMeniscal: {
        sutura: true,
        ladoMedial: true,
        ladoLateral: true,
        detalhesMedial: {
          sutura: true,
          lesaoRampa: true,
          tecnicasSutura: ["All-inside"],
          pontosPorTecnica: JSON.stringify({ "All-inside": 2 }),
        },
        detalhesLateral: {
          sutura: false,
          lesaoRaiz: true,
          fixacaoRaiz: "Endoboton",
          meniscectomia: true,
        },
      },
    });

    const output = doc.output();
    expect(output).toContain("Medial");
    expect(output).toContain("Lateral");
    expect(output).toContain("Lesao Rampa");
    expect(output).toContain("Raiz Posterior");
    expect(output).toContain("All-inside");
    expect(output).toContain("Endoboton");
    expect(output).not.toContain("Sutura + Meniscectomia Parcial");
  });

  it("renders bilateral legacy flat details once without attributing them to both sides", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Meniscal",
      tiposProcedimento: ["Lesão Meniscal"],
      patient: { nome: "Paciente" },
      procedimentoMeniscal: {
        sutura: true,
        ladoMedial: true,
        ladoLateral: true,
        lesaoRampa: true,
        tecnicasSutura: ["All-inside"],
      },
    });

    const output = doc.output();
    expect(output.match(/Lesao Rampa/g)).toHaveLength(1);
    expect(output.match(/All-inside/g)).toHaveLength(1);
  });

  it("renders explicit side objects even when legacy side flags are missing or stale", async () => {
    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Meniscal",
      tiposProcedimento: ["Lesão Meniscal"],
      patient: { nome: "Paciente" },
      procedimentoMeniscal: {
        ladoLateral: true,
        detalhesMedial: {
          sutura: true,
          lesaoRampa: true,
        },
      },
    });

    const output = doc.output();
    expect(output).toContain("Medial");
    expect(output).toContain("Lesao Rampa");
    expect(output).not.toContain("Lateral");
  });

  it("omits a deselected explicit side from newly generated PDFs", async () => {
    const procedimentoMeniscal = removeMeniscalSideDetails({
      ladoMedial: true,
      ladoLateral: true,
      detalhesMedial: { sutura: true, lesaoRampa: true },
      detalhesLateral: { sutura: false, meniscectomia: true, lesaoRaiz: true },
    }, "medial");

    const { doc } = await generateSurgeryPDF({
      tipoCaso: "Lesão Meniscal",
      tiposProcedimento: ["Lesão Meniscal"],
      patient: { nome: "Paciente" },
      procedimentoMeniscal,
    });

    const output = doc.output();
    expect(procedimentoMeniscal.detalhesMedial).toBeNull();
    expect(output).not.toContain("Medial");
    expect(output).not.toContain("Lesao Rampa");
    expect(output).toContain("Lateral");
    expect(output).toContain("Meniscectomia");
  });
});
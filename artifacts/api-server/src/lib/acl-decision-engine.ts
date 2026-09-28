// DocSholder AI Decision — Módulo LCA (LEAP Rules Engine v0.3)
// Fonte: attached_assets/DocSholder_AI_Decision_Modulo_LCA_RulesEngine_v0.1_1783537202180.md
// Camada de suporte à decisão QUALITATIVA — não calcula probabilidade calibrada de falha.

export type Forca =
  | "Fortemente recomendado"
  | "Recomendado"
  | "Deve ser considerado"
  | "Pode ser considerado"
  | "Alerta";

export type Evidencia = "N-I" | "N-II/III" | "N-V" | "VIÉS-IND";

export interface AclDecisionRegra {
  id: string;
  modulo: "leap" | "pts" | "graft" | "revision" | "behavioral";
  forca: Forca;
  evidencia: Evidencia[];
  titulo: string;
  alavanca: string;
  justificativa: string;
  contraindicado?: string;
}

export interface AclDecisionInput {
  idade: number;
  sexo?: string;
  enxerto?: "HT" | "QT" | "BTB" | "Aloenxerto" | "Outro" | string;
  pivotShift?: number;
  lachman?: number;
  hiperextensaoGraus?: number;
  revisao: boolean;
  esqueletoImaturo?: boolean;
  lesaoCronica?: boolean;
  esportePivot?: boolean;
  ptsGraus?: number;
  contralateralLca?: boolean;
  tabagismo?: boolean;
  atrasoCirurgicoDias?: number;
  earlyRtsPivot?: boolean;
  tunelComprometido?: boolean;
  aloenxertoJovem?: boolean;
  allIsoladaConduta?: boolean;
  segondFratura?: boolean;
  notchEstreito?: boolean;
  lesaoAlcImagem?: boolean;
  meniscalConcomitante?: boolean;
  graftDiametroMm?: number;
}

export interface AclDecisionResult {
  disclaimers: {
    naoCalibrado: string;
    populacao: string;
    vies: string;
  };
  driversNaoModificaveis: { id: string; label: string; presente: boolean }[];
  regras: AclDecisionRegra[];
  leapIndicado: boolean;
  forcaMaxima: Forca | null;
  fatoresAcessorios: { id: string; label: string; presente: boolean }[];
  fatoresAcessoriosCount: number;
  camadaSeguranca: {
    reassurance: string[];
    caveats: string[];
    consentComplications: string[];
  } | null;
  execucaoTecnica: {
    nota: string;
    itens: string[];
  } | null;
}

const FORCA_ORDEM: Forca[] = [
  "Alerta",
  "Pode ser considerado",
  "Deve ser considerado",
  "Recomendado",
  "Fortemente recomendado",
];

function maisForte(a: Forca | null, b: Forca): Forca {
  if (!a) return b;
  return FORCA_ORDEM.indexOf(b) > FORCA_ORDEM.indexOf(a) ? b : a;
}

function isFlexor(enxerto?: string): boolean {
  return enxerto === "HT";
}
function isNaoFlexor(enxerto?: string): boolean {
  return enxerto === "QT" || enxerto === "BTB";
}

export function computeAclDecision(input: AclDecisionInput): AclDecisionResult {
  const {
    idade,
    sexo,
    enxerto,
    pivotShift = 0,
    lachman = 0,
    hiperextensaoGraus = 0,
    revisao,
    esqueletoImaturo = false,
    lesaoCronica = false,
    esportePivot = false,
    ptsGraus = 0,
    contralateralLca = false,
    tabagismo = false,
    atrasoCirurgicoDias = 0,
    earlyRtsPivot = false,
    tunelComprometido = false,
    segondFratura = false,
    notchEstreito = false,
    lesaoAlcImagem = false,
    meniscalConcomitante = false,
    graftDiametroMm,
  } = input;

  const aloenxertoJovem = input.aloenxertoJovem ?? (enxerto === "Aloenxerto" && idade <= 25);

  const regras: AclDecisionRegra[] = [];

  // ── Drivers não modificáveis (2A) — não disparam conduta isoladamente ──
  const driversNaoModificaveis = [
    { id: "age", label: "Idade ≤ 25 anos", presente: idade <= 25 },
    { id: "female", label: "Sexo feminino", presente: sexo === "F" },
    { id: "notch", label: "Chanfradura estreita (notch)", presente: notchEstreito },
    { id: "contralateral", label: "História de LCA contralateral", presente: contralateralLca },
  ];

  // ── L1/L2 — idade + enxerto (primária) ──
  if (!revisao && idade <= 25 && isFlexor(enxerto)) {
    regras.push({
      id: "L1",
      modulo: "leap",
      forca: "Fortemente recomendado",
      evidencia: ["N-I", "N-V"],
      titulo: "≤25 anos + enxerto flexor (HT)",
      alavanca: "LEAP (LET/ALLR)",
      justificativa:
        "Unanimidade (100%) no consenso; STABILITY (RCT): ACLR+LET reduz falha clínica de 40% para 25% (redução de 67% na ruptura, 11% vs 4%; n=618, idade média 18,9).",
    });
  } else if (!revisao && idade <= 25 && isNaoFlexor(enxerto)) {
    regras.push({
      id: "L2",
      modulo: "leap",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: "≤25 anos + enxerto não-flexor (QT/BTB)",
      alavanca: "LEAP — rebaixado para considerar",
      justificativa: "Consenso forte, porém rebaixado em relação ao HT: o efeito protetor do LEAP é mais robusto quando o enxerto é flexor.",
    });
  }

  // ── L3 — Pivot shift grau 3 ──
  if (pivotShift >= 3) {
    regras.push({
      id: "L3",
      modulo: "leap",
      forca: "Fortemente recomendado",
      evidencia: ["N-V"],
      titulo: "Pivot shift grau 3 (crash)",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Instabilidade rotatória de alto grau — consenso forte independente do contexto (primária ou revisão).",
    });
  }

  // ── L4 — Hiperextensão (dois níveis) ──
  if (hiperextensaoGraus >= 5) {
    const altoRisco = hiperextensaoGraus >= 6.5;
    const altoRiscoComFlexor = altoRisco && isFlexor(enxerto);
    regras.push({
      id: "L4",
      modulo: "leap",
      forca: altoRisco ? "Fortemente recomendado" : "Deve ser considerado",
      evidencia: ["N-II/III", "N-V"],
      titulo: altoRisco
        ? altoRiscoComFlexor
          ? "Hiperextensão ≥ 6,5° com enxerto HT — alto risco"
          : "Hiperextensão ≥ 6,5°"
        : "Hiperextensão entre 5° e < 6,5°",
      alavanca: altoRiscoComFlexor
        ? "Migrar enxerto para BTB/QT + LEAP (não apenas reforçar)"
        : "LEAP + fixar/tensionar em extensão",
      justificativa: altoRiscoComFlexor
        ? "Helito 2024 (Arthroscopy): cutoff de 6,5° → 14,6× mais risco de ruptura do enxerto de flexores, com pior estabilidade e função. Ressalva: estudo monocêntrico, grupo pró-LEAP/ALL, sem validação externa."
        : altoRisco
          ? "Hiperextensão a partir de 6,5° é um fator de risco importante para falha do LCA; avaliar LEAP no contexto dos demais fatores clínicos e técnicos."
          : "Hiperextensão entre 5° e < 6,5° é um fator adicional: considerar LEAP conforme enxerto, idade, instabilidade rotatória e demais fatores de risco.",
    });
    if (idade <= 25 && isFlexor(enxerto)) {
      regras.push({
        id: "L4b",
        modulo: "leap",
        forca: "Alerta",
        evidencia: ["N-V"],
        titulo: "Hiperlaxidez/hiperextensão + enxerto flexor isolado",
        alavanca: "Evitar reconstrução isolada com flexores sem qualquer procedimento extra-articular",
        justificativa: "Survey ISAKOS 2025 (discussão): falha 21,7–24,4% (Helito 2019; Larson 2017) vs ~4% na população geral quando HT é usado isolado neste perfil.",
      });
    }
  }

  // ── L5 — Revisão ──
  if (revisao) {
    regras.push({
      id: "L5",
      modulo: "leap",
      forca: "Recomendado",
      evidencia: ["N-II/III", "N-V"],
      titulo: "Revisão de LCA",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Meta-análise de Grassi: redução relativa de 54% na falha em revisão, sem aumento de complicações.",
    });
  }

  // ── L6 — Esqueleticamente imaturo ──
  if (esqueletoImaturo) {
    regras.push({
      id: "L6",
      modulo: "leap",
      forca: "Fortemente recomendado",
      evidencia: ["N-V"],
      titulo: "Esqueleticamente imaturo",
      alavanca: "LEAP (adaptado para poupar a fise)",
      justificativa: "Ruptura em seguimento longo pode chegar a 32% neste grupo (Kayaalp).",
    });
  }

  // ── L7 — Deficiência crônica sintomática ──
  if (lesaoCronica) {
    regras.push({
      id: "L7",
      modulo: "leap",
      forca: "Recomendado",
      evidencia: ["N-V"],
      titulo: "Deficiência crônica sintomática de LCA",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Consenso — aplica-se tanto à primária quanto à revisão.",
    });
  }

  // ── L8 — Retorno a esporte de pivô ──
  if (esportePivot) {
    regras.push({
      id: "L8",
      modulo: "leap",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: "Retorno a esporte de pivô",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Consenso forte para pacientes que pretendem retornar a esportes de pivô/corte.",
    });
  }

  // ── L9 — Lachman grau 3 ──
  if (lachman >= 3) {
    regras.push({
      id: "L9",
      modulo: "leap",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: "Lachman grau 3",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Consenso forte associando frouxidão anteroposterior severa à indicação de reforço extra-articular.",
    });
  }

  // ── L10 — PTS > 12° ──
  if (ptsGraus > 12) {
    regras.push({
      id: "L10",
      modulo: "leap",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: `PTS > 12° (${ptsGraus}°)`,
      alavanca: "LEAP (considerar) — ver módulo PTS para alternativa de osteotomia",
      justificativa: "Slope tibial posterior elevado é driver forte de falha; ver §5 (módulo PTS) para comparação com osteotomia de correção de slope.",
    });
  }

  // ── L11 — Contralateral ──
  if (contralateralLca) {
    regras.push({
      id: "L11",
      modulo: "leap",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: "História de LCA contralateral",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Consenso (statement 17) — maior risco de nova lesão no joelho operado.",
    });
  }

  // ── Fatores acessórios (não disparam LEAP isoladamente — §4) — usados no L12 ──
  const fatoresAcessorios = [
    { id: "graftLt8mm", label: "Enxerto < 8 mm (isolado)", presente: !!graftDiametroMm && graftDiametroMm < 8 },
    { id: "segond", label: "Fratura de Segond", presente: segondFratura },
    { id: "notch", label: "Sinal do notch femoral lateral profundo", presente: notchEstreito },
    { id: "alcImagem", label: "Lesão do complexo anterolateral em RM/US", presente: lesaoAlcImagem },
    { id: "pivotShift2", label: "Pivot shift grau 2 isolado", presente: pivotShift === 2 },
    { id: "femaleAthlete", label: "Atleta feminina", presente: sexo === "F" && esportePivot },
    { id: "meniscalConcomitante", label: "Procedimento meniscal concomitante", presente: meniscalConcomitante },
  ];
  const fatoresAcessoriosCount = fatoresAcessorios.filter((f) => f.presente).length;

  // ── L12 — ≥2 fatores relativos combinados ──
  if (fatoresAcessoriosCount >= 2) {
    regras.push({
      id: "L12",
      modulo: "leap",
      forca: "Pode ser considerado",
      evidencia: ["N-V"],
      titulo: `${fatoresAcessoriosCount} fatores relativos combinados`,
      alavanca: "LEAP pode cruzar o limiar mesmo sem um fator determinante isolado",
      justificativa: "Statement 36 do consenso — a soma de fatores sem consenso individual pode justificar LEAP quando avaliados em conjunto.",
    });
  }

  // ── Módulo PTS (P1) ──
  if (ptsGraus >= 10.1) {
    regras.push({
      id: "P1",
      modulo: "pts",
      forca: "Deve ser considerado",
      evidencia: ["N-II/III", "N-I", "N-V"],
      titulo: `PTS ≥ 10,1° (${ptsGraus}°) — ${ptsGraus >= 12 ? "risco ainda maior (≥12°)" : "risco elevado"}`,
      alavanca: "1ª linha: LEAP (subgrupo STABILITY/Firth) · Alternativa: Osteotomia de correção de slope (PLO), sobretudo em revisão/re-revisão",
      justificativa: "PTS >10,1° confere 11× risco de falha (maior ainda com ≥12°; slope medial ≥16° prediz falhas múltiplas). A osteotomia é mecanicamente mais direcionada, mas sua evidência de redução de falha é de nível baixo (opinião de especialista) — reservar a casos selecionados de revisão/re-revisão com slope marcadamente elevado.",
    });
  }

  // ── Módulo enxerto/diâmetro (G1/G2) ──
  if (graftDiametroMm !== undefined && graftDiametroMm < 8) {
    regras.push({
      id: "G1",
      modulo: "graft",
      forca: "Alerta",
      evidencia: ["N-V"],
      titulo: `Predição de enxerto HT < 8 mm (${graftDiametroMm} mm)`,
      alavanca: "Migrar para QT/BTB (mais previsíveis) OU multi-strand 6–8 fitas OU internal brace como load-sharing",
      justificativa: "Diâmetro <8 mm é preditor forte de falha; cada 0,5 mm reduz risco (Itoh 2024).",
      contraindicado: "Não somar LEAP apenas por diâmetro isolado; não usar híbrido só para \"engordar\" o enxerto (Mirzayan 2023: híbrido ≥8mm não reduz revisão vs HT <8mm).",
    });
  }
  if (!revisao && isFlexor(enxerto) && idade <= 25 && hiperextensaoGraus >= 5) {
    regras.push({
      id: "G2",
      modulo: "graft",
      forca: hiperextensaoGraus >= 6.5 ? "Fortemente recomendado" : "Recomendado",
      evidencia: ["N-II/III"],
      titulo: hiperextensaoGraus >= 6.5
        ? "Hipermobilidade/hiperextensão ≥ 6,5° + enxerto HT planejado em jovem"
        : "Hiperextensão entre 5° e < 6,5° + enxerto HT planejado em jovem",
      alavanca: hiperextensaoGraus >= 6.5
        ? "Migrar de HT para BTB/QT (não apenas reforçar)"
        : "Preferir BTB/QT ou reforçar o enxerto HT",
      justificativa: "Hipermobilidade → ~4× rerruptura HT vs BTB (Lindskog 2025); HE ≥6,5° → 14,6× ruptura HT (Helito 2024); HT isolado em hiperlaxo falha 21,7–24,4% (Helito 2019).",
      contraindicado: "Nunca deixar HT isolado sem procedimento extra-articular neste grupo.",
    });
  }

  // ── Módulo revisão (R1-R4) ──
  if (revisao && tunelComprometido) {
    regras.push({
      id: "R1",
      modulo: "revision",
      forca: "Recomendado",
      evidencia: ["N-II/III"],
      titulo: "Túnel femoral/tibial comprometido (tamanho/posição)",
      alavanca: "Staged bone grafting antes da revisão; reposicionar túnel",
      justificativa: "Túneis comprometidos são os principais preditores de falha na revisão (MARS AutoPrognosis).",
    });
  }
  if (revisao && aloenxertoJovem) {
    regras.push({
      id: "R2",
      modulo: "revision",
      forca: "Recomendado",
      evidencia: ["N-II/III"],
      titulo: "Uso de aloenxerto em paciente jovem",
      alavanca: "Preferir autoenxerto",
      justificativa: "Aloenxerto tem OR 3,3 de falha (MARS); risco de revisão 2–4× em <25 anos.",
    });
  }
  if (revisao && (pivotShift >= 2 || fatoresAcessoriosCount >= 1)) {
    regras.push({
      id: "R3",
      modulo: "revision",
      forca: "Recomendado",
      evidencia: ["N-II/III"],
      titulo: "Revisão + instabilidade rotacional",
      alavanca: "LEAP (LET/ALLR)",
      justificativa: "Meta-análise de Grassi: redução relativa de 54% na falha, sem aumento de complicações.",
    });
  }
  if (revisao && input.allIsoladaConduta) {
    regras.push({
      id: "R4",
      modulo: "revision",
      forca: "Alerta",
      evidencia: ["N-I"],
      titulo: "Reconstrução isolada do LAL como conduta única na revisão",
      alavanca: "Cautela — benefício inconsistente",
      justificativa: "RCT de Sørensen: negativo para reconstrução isolada do ALL em revisão a 2 anos.",
    });
  }

  // ── Módulo comportamental/biológico (B1-B3) ──
  if (tabagismo) {
    regras.push({
      id: "B1",
      modulo: "behavioral",
      forca: "Recomendado",
      evidencia: ["N-II/III"],
      titulo: "Tabagismo",
      alavanca: "Cessação pré-operatória (aconselhamento)",
      justificativa: "Fumantes: falha 3× (Hendrikx 2025).",
    });
  }
  if (atrasoCirurgicoDias > 75) {
    regras.push({
      id: "B2",
      modulo: "behavioral",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: `Atraso cirúrgico (${atrasoCirurgicoDias} dias)`,
      alavanca: "Discutir timing cirúrgico com o paciente",
      justificativa: "Atraso >75 dias associado a mais falha; janela de decisão individual (Kayaalp).",
    });
  }
  if (earlyRtsPivot) {
    regras.push({
      id: "B3",
      modulo: "behavioral",
      forca: "Deve ser considerado",
      evidencia: ["N-V"],
      titulo: "Retorno precoce ao pivô na janela de ligamentização (6–12 semanas)",
      alavanca: "Protelar RTS; reabilitação por critério, não por tempo",
      justificativa: "Kayaalp — retorno precoce nesta janela associado a maior risco.",
    });
  }

  let leapIndicado = false;
  let forcaMaxima: Forca | null = null;
  for (const r of regras) {
    if (r.modulo === "leap") {
      leapIndicado = true;
      forcaMaxima = maisForte(forcaMaxima, r.forca);
    }
  }

  const camadaSeguranca = leapIndicado
    ? {
        reassurance: [
          "Taxa global de complicações baixa (statement 30).",
          "Sem aumento de osteoartrose do compartimento lateral no curto/médio prazo (statement 31).",
          "Sem necessidade de mudança no protocolo de reabilitação (statement 33).",
          "Sem efeito negativo no retorno ao esporte (statement 34).",
        ],
        caveats: [
          "Unanimidade de 100% vem do mesmo painel pró-LEAP com apoio da indústria (Arthrex) — as afirmações mais tranquilizadoras vêm da fonte mais conflituada.",
          "\"Sem aumento de OA\" refere-se a curto/médio prazo (~2 anos); a preocupação histórica de sobreconstrangimento lateral era degenerativa de longo prazo, ainda não respondida.",
          "Contradição interna: o substudo funcional do STABILITY (Getgood 2020) mostrou função inferior e menor torque/potência de quadríceps aos 6 meses no grupo ACLR+LET, normalizando aos 12 meses — possível déficit funcional transitório do quadríceps.",
        ],
        consentComplications: [
          "Dor lateral",
          "Convergência de túneis",
          "Remoção de material (mais frequente no grupo LET)",
          "Lesão do LCL",
          "Inibição do quadríceps",
          "Rigidez",
        ],
      }
    : null;

  const execucaoTecnica = leapIndicado
    ? {
        nota: "Auxílio da Técnica — orientações de execução intraoperatória após a indicação de LEAP. LET ≈ ALLR (equivalentes, sem superioridade de uma técnica sobre a outra).",
        itens: [
          "ITB (banda iliotibial): passar o enxerto profundo ao LCL.",
          "ITB: fixação em rotação neutra, baixa tensão, entre 0–60° de flexão.",
          "ALLR: ponto femoral proximal e posterior ao epicôndilo femoral lateral.",
          "ALLR: fixação em extensão completa + rotação neutra.",
          "Método de fixação: grampo, parafuso, sutura ou âncora — todos aceitáveis.",
          "Pediátrico: adaptar técnica para poupar a fise.",
        ],
      }
    : null;

  return {
    disclaimers: {
      naoCalibrado: "Este módulo não calcula probabilidade calibrada de falha — apenas identifica drivers de risco e alavancas modificáveis com evidência de modificação do desfecho.",
      populacao: "Nenhum modelo de risco numérico (NKLR, MOON, MARS AutoPrognosis) está validado para a população brasileira; teto de discriminação AUC ~0,67–0,70.",
      vies: "O motor do LEAP (indicações e camada de segurança) é derivado de um consenso Delphi com apoio declarado da indústria (Arthrex) e painel com predisposição pró-LEAP nas próprias limitações do estudo.",
    },
    driversNaoModificaveis,
    regras,
    leapIndicado,
    forcaMaxima,
    fatoresAcessorios,
    fatoresAcessoriosCount,
    camadaSeguranca,
    execucaoTecnica,
  };
}

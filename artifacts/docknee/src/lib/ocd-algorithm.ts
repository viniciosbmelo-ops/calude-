/**
 * DocKnee Cartilage Algorithm v1.0 — TypeScript port
 * Ferramenta de apoio à decisão clínica. NÃO é modelo preditivo validado.
 * A decisão final é sempre do cirurgião.
 */

export interface OcdInput {
  // Gate
  symptomatic: boolean | null;
  conservativeFailure: boolean | null;
  diffuseOA: boolean | null;
  // Paciente
  age?: number | null;
  bmi?: number | null;
  sportLevel?: string;
  objective?: "quick_return" | "long_term" | "balanced" | "";
  symptomLevel?: number | null;
  symptomDurationMonths?: number | null;
  // Diagnóstico
  etiology?: string;
  etiologyCode?: string;
  lesionPattern?: "chondral" | "osteochondral" | "";
  location?: string;
  locationCode?: string;
  sizeCm2?: number | null;
  depth?: string;
  containment?: string;
  icrsGrade?: string;
  boneStatus?: "preserved" | "compromised" | "significant_loss" | "";
  boneCode?: string;
  mriAvailable?: boolean | null;
  /** Confirmação explícita de disponibilidade de banco de tecidos para OCA. */
  bancoTecidosDisponivel?: boolean | null;
  arthroscopyNeededToCharacterize?: boolean;
  // Biomecânica
  biomechanicalStatus?: "corrected" | "present" | "unknown" | "";
  alignmentAbnormal?: boolean;
  /** undefined = não informado; false = ausente (conhecido); true = presente */
  unstableLigament?: boolean;
  /** undefined = não informado; false = ausente (conhecido); true = presente */
  meniscalDeficiency?: boolean;
  patellarInstability?: boolean;
  patellofemoralOverload?: boolean;
  ttTgAbnormal?: boolean;
  trochlearDysplasia?: boolean;
  patellofemoralUnassessed?: boolean;
  /** Ligamentos afetados quando unstableLigament=true, ex: ["LCA","LCM"] */
  ligamentosAfetados?: string[];
  // Histórico
  failedPriorProcedure?: boolean;
  bipolarOrMultiple?: boolean;
  priorProcedures?: boolean | string;
}

export interface OcdRecommendation {
  procedure: string;
  status: string;
  rationale: string;
  priority: number;
}

export interface OcdOutput {
  ok: boolean;
  errors?: string[];
  version: string;
  disclaimer: string;
  classification: string;
  clinicalStatus: string;
  pathway: "osteochondral" | "chondral" | "arthrosis";
  redFlags: string[];
  biomechanicalGate: { present: boolean; factors: string[]; action: string };
  recommendations: OcdRecommendation[];
  completenessProfile: { score: number; label: string };
  nextDataNeeded: string[];
  warnings: string[];
}

const PROCEDURES = {
  DEBRIDEMENT: "Desbridamento artroscópico",
  DEBRIDEMENT_ORTHO: "Desbridamento + ortobiológicos",
  BMS: "Estimulação de medula óssea (BMS / nanofraturas)",
  OAT: "OAT/OATS — transplante osteocondral autólogo",
  OCA: "OCA — aloenxerto osteocondral fresco",
  REGENERATIVE: "Restauração/regeneração condral baseada em células/matriz (ex.: ACI/MACI)",
  PJAC: "Aloenxerto condral particulado/juvenil (PJAC), quando disponível",
  MINCED: "Cartilagem particulada (minced cartilage / Autocart)",
  SCAFFOLD: "Scaffold / matriz condral",
  SANDWICH: "Reconstrução osteocondral em estágios (abordagem tipo sandwich)",
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function has(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "" && v !== false;
}
/** True when a boolean field has been explicitly answered (true OR false), not just absent. */
function knownBool(v: boolean | undefined | null): boolean {
  return v === true || v === false;
}

function sizeBand(area: number | null): "<2" | "2-4" | ">4" {
  if (area === null) return "<2";
  if (area < 2) return "<2";
  if (area <= 4) return "2-4";
  return ">4";
}

function buildClassification(i: OcdInput): string {
  const area = num(i.sizeCm2);
  return [
    i.etiologyCode || "E?",
    i.lesionPattern === "osteochondral" ? "OC" : i.lesionPattern === "chondral" ? "C" : "?",
    i.icrsGrade ? `ICRS${i.icrsGrade}` : "ICRS?",
    i.locationCode || "LOC?",
    area !== null ? `${area}cm²` : "?cm²",
    i.boneCode || "B?",
    i.biomechanicalStatus === "corrected" ? "M0"
      : i.biomechanicalStatus === "present" ? "M1" : "M?",
  ].join("-");
}

function buildRedFlags(i: OcdInput): string[] {
  const r: string[] = [];
  if (i.boneStatus === "significant_loss") r.push("Perda óssea subcondral significativa.");
  if (i.icrsGrade === "4" || i.icrsGrade === "4A" || i.icrsGrade === "4B")
    r.push("Lesão de espessura total / comprometimento subcondral (ICRS 4).");
  if (i.diffuseOA) r.push("Artrose difusa/avançada — algoritmo de restauração focal não é o caminho principal.");
  if (i.biomechanicalStatus === "present") r.push("Fator biomecânico relevante não corrigido.");
  if (i.meniscalDeficiency) r.push("Deficiência meniscal relevante.");
  if (i.unstableLigament) {
    const ligs = i.ligamentosAfetados?.length ? ` (${i.ligamentosAfetados.join(", ")})` : "";
    r.push(`Instabilidade ligamentar relevante${ligs}.`);
  }
  if (i.failedPriorProcedure) r.push("Falha de procedimento condral/osteocondral prévio.");
  if (i.bipolarOrMultiple) r.push("Lesões bipolares ou múltiplas.");
  if (i.patellofemoralUnassessed) r.push("Lesão patelofemoral sem avaliação biomecânica/anatômica adequada.");
  return r;
}

function buildBiomechanicalGate(i: OcdInput) {
  const factors: string[] = [];
  if (i.alignmentAbnormal) factors.push("Alinhamento varo/valgo");
  if (i.unstableLigament) {
    const ligs = i.ligamentosAfetados?.length ? ` (${i.ligamentosAfetados.join(", ")})` : "";
    factors.push(`Instabilidade ligamentar${ligs}`);
  }
  if (i.meniscalDeficiency) factors.push("Insuficiência/deficiência meniscal");
  if (i.patellarInstability) factors.push("Instabilidade patelar");
  if (i.patellofemoralOverload) factors.push("Sobrecarga patelofemoral");
  if (i.ttTgAbnormal) factors.push("TT-TG alterado / fator de tracking");
  if (i.trochlearDysplasia) factors.push("Displasia troclear");
  return {
    present: factors.length > 0,
    factors,
    action: factors.length > 0
      ? "Avaliar e, quando indicado, corrigir o fator mecânico antes ou em conjunto com a restauração condral."
      : "Nenhum fator mecânico relevante informado.",
  };
}

/** Boolean fields in OcdInput that count as filled even when their value is `false` */
const BOOL_COMPLETENESS_FIELDS = new Set<keyof OcdInput>([
  "meniscalDeficiency", "unstableLigament", "alignmentAbnormal",
  "patellarInstability", "ttTgAbnormal", "trochlearDysplasia", "mriAvailable",
  "bancoTecidosDisponivel",
]);

function scoreCompleteness(i: OcdInput, warnings: string[]): number {
  const fields: (keyof OcdInput)[] = [
    "age", "bmi", "sportLevel", "objective", "symptomLevel", "symptomDurationMonths",
    "location", "sizeCm2", "depth", "containment", "icrsGrade", "boneStatus",
    "meniscalDeficiency", "unstableLigament", "alignmentAbnormal", "patellarInstability",
    "ttTgAbnormal", "trochlearDysplasia", "priorProcedures", "mriAvailable",
    "bancoTecidosDisponivel",
  ];
  const filled = fields.filter((k) =>
    BOOL_COMPLETENESS_FIELDS.has(k) ? knownBool(i[k] as boolean | undefined | null) : has(i[k])
  ).length;
  let s = Math.round((filled / fields.length) * 100);
  if (warnings.length) s = Math.max(0, s - 5 * Math.min(warnings.length, 4));
  return s;
}

function buildRecommendations(i: OcdInput): { pathway: OcdOutput["pathway"]; recommendations: OcdRecommendation[] } {
  const area = num(i.sizeCm2);
  const band = sizeBand(area);
  const pf = i.location === "patella" || i.location === "trochlea";
  const bone =
    i.lesionPattern === "osteochondral" ||
    i.boneStatus === "significant_loss" ||
    i.boneStatus === "compromised";
  const quick = i.objective === "quick_return";
  const long = i.objective === "long_term" || i.objective === "balanced";

  const rec: OcdRecommendation[] = [];
  function add(proc: string, status: string, rationale: string, priority = 0) {
    // OCA requires an explicit confirmation of fresh tissue-bank availability.
    if (proc === PROCEDURES.OCA && i.bancoTecidosDisponivel !== true) return;
    rec.push({ procedure: proc, status, rationale, priority });
  }

  if (i.diffuseOA) {
    return {
      pathway: "arthrosis",
      recommendations: [{
        procedure: "Tratamento da artrose / estratégia de preservação ou artroplastia conforme estágio, sintomas e demanda",
        status: "FORA DO ALGORITMO DE RESTAURAÇÃO FOCAL",
        rationale: "A presença de artrose difusa/avançada muda o problema clínico de um defeito focal para doença articular mais ampla.",
        priority: 100,
      }],
    };
  }

  if (bone) {
    if (area !== null && area < 2 && !pf) {
      add(PROCEDURES.OAT, "CONSIDERAR / APROPRIADO NO CENÁRIO", "Defeito osteocondral pequeno com osso comprometido é cenário clássico para solução osteocondral autóloga em casos selecionados.", 90);
      add(PROCEDURES.OCA, "INCERTO — REQUER JULGAMENTO CLÍNICO", "Alternativa quando OAT não é adequada por características do defeito, disponibilidade ou demanda.", 60);
    } else {
      add(PROCEDURES.OCA, "CONSIDERAR / APROPRIADO NO CENÁRIO", "Defeito osteocondral maior ou com perda óssea relevante favorece solução que restaure cartilagem e osso.", 95);
      add(PROCEDURES.OAT, "INCERTO — REQUER JULGAMENTO CLÍNICO", "Pode ser considerada em defeitos selecionados, especialmente quando tamanho e localização permitem cobertura adequada.", 70);
      if (i.boneStatus === "significant_loss") {
        add(PROCEDURES.SANDWICH, "CONSIDERAR EM CASOS SELECIONADOS", "Perda óssea relevante pode exigir reconstrução óssea em estágios antes ou associada à restauração condral.", 80);
      }
    }
    if (pf) {
      add(PROCEDURES.REGENERATIVE, "CONSIDERAR EM CENÁRIOS SELECIONADOS", "No compartimento patelofemoral, estratégias baseadas em células/matriz podem ser consideradas conforme localização, contenção e biomecânica.", 65);
    }
  } else {
    // Condral
    if (quick) {
      add(PROCEDURES.DEBRIDEMENT_ORTHO, "CONSIDERAR / APROPRIADO NO CENÁRIO", "O consenso ICRS-FIFA-Aspetar 2026 dá maior peso a desbridamento + ortobiológicos quando a prioridade é retorno mais rápido, dependendo do cenário.", 95);
      add(PROCEDURES.DEBRIDEMENT, "ALTERNATIVA", "Pode ser considerado conforme morfologia, sintomas e objetivo, sem prometer recuperação acelerada.", 65);
    }
    if (long || !quick) {
      if (band === "<2") {
        add(PROCEDURES.REGENERATIVE, "CONSIDERAR / APROPRIADO NO CENÁRIO", "Defeito condral focal pequeno, sintomático e sem comprometimento ósseo pode ser candidato a estratégia de restauração/regeneração em casos selecionados.", 90);
        add(PROCEDURES.MINCED, "OPÇÃO SELECIONADA", "Técnicas particuladas podem ser consideradas conforme contenção, localização, disponibilidade e experiência.", 65);
        add(PROCEDURES.BMS, "INCERTO — REQUER JULGAMENTO CLÍNICO", "BMS tem evidência/adequação variável e não deve ser tratada como escolha automática.", 35);
      } else if (band === "2-4") {
        add(PROCEDURES.REGENERATIVE, "CONSIDERAR / APROPRIADO NO CENÁRIO", "Defeitos de 2–4 cm² podem ser tratados com estratégias restauradoras selecionadas; tamanho, localização e biomecânica modificam a escolha.", 92);
        add(PROCEDURES.MINCED, "OPÇÃO SELECIONADA", "Pode ser considerada em defeitos selecionados.", 60);
        add(PROCEDURES.BMS, "INCERTO — REQUER JULGAMENTO CLÍNICO", "Resultados e adequação variam com tamanho, localização e contexto; não usar como default.", 25);
      } else {
        add(PROCEDURES.REGENERATIVE, "CONSIDERAR / APROPRIADO NO CENÁRIO", "Defeito condral grande favorece estratégia de restauração/regeneração apropriada ao tamanho, localização e características do leito.", 95);
        add(PROCEDURES.OCA, "INCERTO — REQUER JULGAMENTO CLÍNICO", "Pode ser opção se houver características osteocondrais ou quando outras estratégias não forem apropriadas.", 55);
        add(PROCEDURES.BMS, "NÃO FAVORECIDO NESTE CENÁRIO", "Não deve ser a estratégia padrão para defeito condral grande.", 10);
      }
    }
    if (pf) {
      add(PROCEDURES.REGENERATIVE, "CONSIDERAR / APROPRIADO NO CENÁRIO", "No compartimento patelofemoral, a decisão depende fortemente de alinhamento, tracking, estabilidade, contenção e morfologia.", 88);
      add(PROCEDURES.OAT, "INCERTO — REQUER JULGAMENTO CLÍNICO", "Não é escolha automática para patela/tróclea; avaliar indicação anatômica específica.", 30);
    }
  }

  // Penalizar por fatores biomecânicos e histórico
  if (i.biomechanicalStatus === "present") {
    rec.forEach((x) => (x.rationale += " Fator biomecânico não corrigido reduz a adequação de uma restauração isolada; corrigir/avaliar a causa mecânica."));
  }
  if (i.failedPriorProcedure) {
    rec.forEach((x) => (x.rationale += " Há procedimento prévio com falha; escolha deve considerar leito subcondral, tecido remanescente e estratégia de revisão."));
  }

  rec.sort((a, b) => b.priority - a.priority);
  return { pathway: bone ? "osteochondral" : "chondral", recommendations: rec.slice(0, 6) };
}

export function runOcdAlgorithm(input: OcdInput): OcdOutput {
  const warnings: string[] = [];
  if (input.symptomatic === false)
    warnings.push("Lesão sem relevância clínica/sintomática informada: restauração focal não deve ser indicada apenas por imagem.");
  if (input.conservativeFailure === false)
    warnings.push("Não houve falha de tratamento conservador otimizado.");
  if (input.mriAvailable === false)
    warnings.push("RM não disponível/confirmatória: caracterização do defeito está incompleta.");
  if (input.bancoTecidosDisponivel === false)
    warnings.push("Banco de tecidos não disponível: OCA (aloenxerto osteocondral fresco) não será recomendado.");
  if (input.arthroscopyNeededToCharacterize)
    warnings.push("Caracterização definitiva pode depender de avaliação artroscópica.");

  const gate = buildBiomechanicalGate(input);
  const reds = buildRedFlags(input);
  const { pathway, recommendations } = buildRecommendations(input);
  const completeness = scoreCompleteness(input, warnings);

  let clinicalStatus: string;
  if (!input.symptomatic) clinicalStatus = "NÃO INDICAR RESTAURAÇÃO FOCAL APENAS POR IMAGEM";
  else if (!input.conservativeFailure) clinicalStatus = "TRATAMENTO CONSERVADOR OTIMIZADO / REAVALIAÇÃO";
  else if (input.diffuseOA) clinicalStatus = "TRATAR COMO DOENÇA ARTICULAR DIFUSA / ARTROSE";
  else if (gate.present) clinicalStatus = "CORRIGIR / AVALIAR FATOR BIOMECÂNICO ANTES OU EM CONJUNTO";
  else clinicalStatus = "CANDIDATO A DISCUSSÃO DE RESTAURAÇÃO FOCAL";

  const nextDataNeeded: string[] = [
    ...(!has(input.icrsGrade) ? ["Grau ICRS"] : []),
    ...(!has(input.containment) ? ["Contenção do defeito"] : []),
    ...(!has(input.depth) ? ["Profundidade"] : []),
    ...(!has(input.boneStatus) ? ["Estado do osso subcondral"] : []),
    // For booleans, false = "answered: absent" — only flag when genuinely not informed (undefined)
    ...(!knownBool(input.meniscalDeficiency) ? ["Status meniscal"] : []),
    ...(!knownBool(input.alignmentAbnormal) ? ["Alinhamento mecânico"] : []),
    ...(!knownBool(input.unstableLigament) ? ["Estabilidade ligamentar"] : []),
    // When ligament instability is present but no ligament specified
    ...(input.unstableLigament && !input.ligamentosAfetados?.length ? ["Qual ligamento instável?"] : []),
    ...(!knownBool(input.bancoTecidosDisponivel) ? ["Confirmação de disponibilidade do banco de tecidos para OCA"] : []),
  ];

  return {
    ok: true,
    version: "1.0",
    disclaimer:
      "Ferramenta de apoio à decisão clínica — não substitui julgamento clínico. Regras não são validadas como modelo preditivo.",
    classification: buildClassification(input),
    clinicalStatus,
    pathway,
    redFlags: reds,
    biomechanicalGate: gate,
    recommendations,
    completenessProfile: {
      score: completeness,
      label: "Completude dos dados para decisão (não é score prognóstico)",
    },
    nextDataNeeded,
    warnings,
  };
}

// ─── helpers to map formData → OcdInput ────────────────────────────────────

const ETIOLOGY_CODES: Record<string, string> = {
  traumatica: "T",
  pos_traumatica: "PT",
  degenerativa: "D",
  OCD: "OCD",
  iatrogenica: "I",
  indeterminada: "E?",
};

const LOCATION_MAP: Record<string, string> = {
  CFM: "medial_femoral_condyle",
  CFL: "lateral_femoral_condyle",
  PTM: "medial_tibial_plateau",
  PTL: "lateral_tibial_plateau",
  "Tróclea": "trochlea",
  Patela: "patella",
};

const LOCATION_CODES: Record<string, string> = {
  CFM: "MFC", CFL: "LFC", PTM: "MTP", PTL: "LTP", "Tróclea": "TRO", Patela: "PAT",
};

const BONE_STATUS_MAP: Record<string, OcdInput["boneStatus"]> = {
  preserved: "preserved",
  compromised: "compromised",
  significant_loss: "significant_loss",
};

const BONE_CODES: Record<string, string> = {
  preserved: "B0",
  compromised: "B1",
  significant_loss: "B2",
};

/**
 * Extra context from the parent formData so the algorithm can cross-reference
 * data already captured in other wizard steps (alignment, ligament, meniscal).
 */
export interface OcdFormContext {
  /** formData.alinhamentoFrontal — "Neutro" | "Varo" | "Valgo" | etc. */
  alinhamentoFrontal?: string | null;
  /** formData.grauMedida — numeric degree of deviation */
  grauMedida?: number | string | null;
  /** true when "Lesão Meniscal" is one of the selected procedure types */
  isMeniscal?: boolean;
  /** true when "Lesão Ligamentar" is one of the selected procedure types */
  isLigamentar?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exameLigamentar?: Record<string, any> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOcdInputFromForm(
  exam: Record<string, any>,
  ctx: OcdFormContext = {},
): OcdInput {
  const etiology = exam.etiologia || "";
  const locRaw = exam.localizacao || "";
  const bone = exam.osseoStatus || "";

  // ── Alignment ──────────────────────────────────────────────────────────────
  // Priority: OCD switch (desvioAxial) > Step 3 alignment tab
  const alignFromSwitch = !!exam.desvioAxial;
  const step3Known = ctx.alinhamentoFrontal != null && ctx.alinhamentoFrontal !== "";
  const alignFromStep3 =
    step3Known && ctx.alinhamentoFrontal!.toLowerCase() !== "neutro";
  // alignmentAbnormal is undefined (unknown) when neither switch nor step-3 provided info
  const alignmentKnown = alignFromSwitch || step3Known;
  const alignmentAbnormal = alignmentKnown ? (alignFromSwitch || alignFromStep3) : undefined;

  // ── Meniscal deficiency ────────────────────────────────────────────────────
  // Switch OR case type includes meniscal = known-present; not set = known-absent (false)
  const meniscalDeficiency: boolean = !!exam.lesaoMeniscalAssociada || !!ctx.isMeniscal;

  // ── Ligament instability ───────────────────────────────────────────────────
  // Switch OR case type includes ligament = known-present; not set = known-absent (false)
  const unstableLigament: boolean = !!exam.lesaoLigamentarAssociada || !!ctx.isLigamentar;

  // ── Biomechanical status ───────────────────────────────────────────────────
  const biomechanicalFactors =
    (alignmentAbnormal === true) ||
    unstableLigament ||
    !!exam.instabilidadePatelar ||
    !!exam.sobrecargaPatelofemoral ||
    !!exam.ttTgAlterado ||
    !!exam.displasiaToglentar;
  const biomechanicalStatus: OcdInput["biomechanicalStatus"] =
    biomechanicalFactors ? "present"
    : exam.fatorBiomecanicoCorrido ? "corrected"
    : alignmentKnown && !alignmentAbnormal && !unstableLigament ? "corrected"
    : "";

  return {
    symptomatic: exam.sintomatica ?? null,
    conservativeFailure: exam.falhaConservador ?? null,
    diffuseOA: exam.artroseDifusa ?? null,
    age: num(exam.idade),
    bmi: num(exam.imc),
    sportLevel: exam.nivelEsportivo,
    objective: exam.objetivo || "",
    symptomLevel: num(exam.nivelSintomas),
    symptomDurationMonths: num(exam.duracaoSintomas),
    etiology,
    etiologyCode: ETIOLOGY_CODES[etiology] || "E?",
    lesionPattern: exam.padrao || "",
    location: LOCATION_MAP[locRaw] || locRaw,
    locationCode: LOCATION_CODES[locRaw] || "LOC?",
    sizeCm2: num(exam.tamanhoMm2),
    depth: exam.profundidade,
    containment: exam.continencia,
    icrsGrade: exam.icrsGrau || "",
    boneStatus: BONE_STATUS_MAP[bone] || "",
    boneCode: BONE_CODES[bone] || "B?",
    mriAvailable: exam.rmDisponivel ?? null,
    bancoTecidosDisponivel: exam.bancoTecidosDisponivel ?? null,
    biomechanicalStatus,
    alignmentAbnormal,
    unstableLigament,
    meniscalDeficiency,
    ligamentosAfetados: Array.isArray(exam.ligamentosOCD) ? exam.ligamentosOCD as string[] : undefined,
    patellarInstability: !!exam.instabilidadePatelar,
    patellofemoralOverload: !!exam.sobrecargaPatelofemoral,
    ttTgAbnormal: !!exam.ttTgAlterado,
    trochlearDysplasia: !!exam.displasiaToglentar,
    patellofemoralUnassessed: !!exam.patelofemoralSemAvaliacao,
    failedPriorProcedure: !!exam.procedimentoPrevioFalhou,
    bipolarOrMultiple: !!exam.bipolareMultipla,
    priorProcedures: !!exam.procedimentoPrevioFalhou,
  };
}

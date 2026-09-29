/**
 * DocRegen — BioReady Score® (Score de Prontidão Biológica)
 *
 * Algoritmo puro (sem IA) que integra dados clínicos, laboratoriais e funcionais
 * em um score único 0–100 com 10 fatores de peso igual (cada um vale até 10 pts).
 *
 * Dois schemas de anamnese coexistem no banco:
 *
 *  Schema "novo"  (novo.tsx / camelCase booleans):
 *    tabagismo:bool, alcool:bool, diabetes:bool, diabetesHba1c:number,
 *    diabetesTipo:string, resistIns:bool, autoimune:bool, infeccaoRecente:bool,
 *    horasSono:number, qualidadeSono:string, apneia:bool,
 *    sedentario:bool, exercRegular:bool,
 *    proteina:string, ultraproc:bool,
 *    medicCorticoide:bool, medicAINE|medicAines:bool, medicImunosupr:bool, medicAnticoag:bool,
 *    glp1Agonistas:bool, prpPrev:bool, prpResposta:string,
 *    infiltPrev:bool, infiltQual:string, obesidadeImc:number
 *
 *  Schema "caso"  (caso.tsx / snake_case + Pills strings):
 *    tabagismo:"sim"|"não"|"ex-fumante", alcool:"não"|"social"|"frequente",
 *    diabetes:"não"|"pré-diabetes"|"DM1"|"DM2", diabetes_hba1c:number,
 *    resistencia_insulina:bool, autoimune:bool, infeccao_recente:bool,
 *    sono_horas:number, sono_qualidade:"boa"|"regular"|"ruim", apneia:bool,
 *    sedentarismo:bool, exercicio_regular:bool,
 *    proteina:"adequada"|"insuficiente", ultraprocessados:string,
 *    corticoides:bool, aines:bool, imunossupressores:bool, anticoagulantes:bool,
 *    glp1_agonistas:bool, prp_ha_previo:bool, prp_ha_resposta:string,
 *    infiltracoes_anteriores:bool, infiltracoes_tipo:string, infiltracoes_numero:number,
 *    obesidade_imc:number
 *
 * normalizeAnam() merges both into one canonical Anam type.
 * IMPORTANT: absent boolean fields stay as `undefined` (not false) so that
 * missing information is scored as "na" rather than "normal/negative".
 *
 * Classificação final:
 *   90–100 → Excelente candidato
 *   70–89  → Bom candidato
 *   50–69  → Otimizar antes do procedimento
 *   < 50   → Adiar e corrigir fatores
 */

// ─── Schema-agnostic helpers ──────────────────────────────────────────────────

/** Returns `true|false` only if at least one of the keys exists in `raw`; else `undefined`. */
function pickBool(raw: Record<string, any>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined) {
      return !!raw[k];
    }
  }
  return undefined;
}

/** Returns the first non-empty number found under any of the keys; else `undefined`. */
function pickNum(raw: Record<string, any>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (!isNaN(n)) return n;
    }
  }
  return undefined;
}

/** Returns the first non-empty string found under any of the keys; else `undefined`. */
function pickStr<T extends string>(raw: Record<string, any>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v !== "") return v as T;
  }
  return undefined;
}

// ─── Canonical anamnese type ──────────────────────────────────────────────────

interface Anam {
  /** "sim" | "não" | "ex-fumante" */
  tabagismo?:            "sim" | "não" | "ex-fumante";
  /** "não" | "social" | "frequente" */
  alcool?:               "não" | "social" | "frequente";
  obesity?:              boolean;
  obesityBmi?:           number;
  sleepHours?:           number;
  sleepQuality?:         "boa" | "regular" | "ruim";
  sleepApnea?:           boolean;
  sedentary?:            boolean;
  regularExercise?:      boolean;
  protein?:              "adequada" | "insuficiente";
  /** "raramente" | "às vezes" | "frequente" */
  ultraprocessed?:       "raramente" | "às vezes" | "frequente";
  insulinResistance?:    boolean;
  autoimmune?:           boolean;
  autoimuneQual?:        string;
  recentInfection?:      boolean;
  corticosteroids?:      boolean;
  nsaids?:               boolean;
  immunosuppressants?:   boolean;
  anticoagulants?:       boolean;
  glp1Agonists?:         boolean;
  priorPrpHa?:           boolean;
  priorResponse?:        "boa" | "parcial" | "sem resposta";
  priorInfiltrations?:   boolean;
  priorInfiltrationsType?: string;
  priorInfiltrationsCount?: number;
  /** HbA1c from anamnese (backup when not in main case fields) */
  hba1c?:                number;
  /** "não" | "pré-diabetes" | "DM1" | "DM2" — binary bool in novo maps to "DM2" */
  diabetesType?:         "não" | "pré-diabetes" | "DM1" | "DM2";
}

/**
 * Reads either the novo.tsx (camelCase bool) or caso.tsx (snake_case / Pills string) schema.
 * Uses `pickBool` so that absent fields stay `undefined` rather than being coerced to `false`.
 */
function normalizeAnam(raw: Record<string, any> | undefined): Anam {
  if (!raw) return {};
  const a: Anam = {};

  // ── Tabagismo ──────────────────────────────────────────────────────────────
  // novo: tabagismo=true/false
  // caso: tabagismo="sim"|"não"|"ex-fumante"
  if (typeof raw.tabagismo === "boolean") {
    a.tabagismo = raw.tabagismo ? "sim" : "não";
  } else {
    const ts = pickStr<"sim" | "não" | "ex-fumante">(raw, "tabagismo");
    if (ts === "sim" || ts === "não" || ts === "ex-fumante") a.tabagismo = ts;
  }

  // ── Álcool ────────────────────────────────────────────────────────────────
  // novo: alcool=true/false  → "frequente"/"não"
  // caso: alcool="não"|"social"|"frequente"
  if (typeof raw.alcool === "boolean") {
    a.alcool = raw.alcool ? "frequente" : "não";
  } else {
    const as_ = pickStr<"não" | "social" | "frequente">(raw, "alcool");
    if (as_ === "não" || as_ === "social" || as_ === "frequente") a.alcool = as_;
  }

  // ── Obesidade / IMC ───────────────────────────────────────────────────────
  a.obesity    = pickBool(raw, "obesidade");
  a.obesityBmi = pickNum(raw, "obesidadeImc", "obesidade_imc");

  // ── Diabetes ──────────────────────────────────────────────────────────────
  // novo: diabetes=bool, diabetesTipo=string, diabetesHba1c=number
  // caso: diabetes="não"|"pré-diabetes"|"DM1"|"DM2" (Pills), diabetes_hba1c=number
  if (typeof raw.diabetes === "boolean") {
    a.diabetesType = raw.diabetes
      ? ((raw.diabetesTipo as "DM1" | "DM2") ?? "DM2")
      : "não";
  } else if (raw.diabetes) {
    const d = raw.diabetes as "não" | "pré-diabetes" | "DM1" | "DM2";
    if (d === "não" || d === "pré-diabetes" || d === "DM1" || d === "DM2") {
      a.diabetesType = d;
    }
  }
  // HbA1c: novo → diabetesHba1c | caso → diabetes_hba1c
  a.hba1c = pickNum(raw, "diabetesHba1c", "diabetes_hba1c");

  // ── Sono ──────────────────────────────────────────────────────────────────
  // novo: horasSono, qualidadeSono
  // caso: sono_horas, sono_qualidade
  a.sleepHours   = pickNum(raw, "horasSono", "sono_horas");
  const sq = pickStr<"boa" | "regular" | "ruim">(raw, "qualidadeSono", "sono_qualidade");
  if (sq === "boa" || sq === "regular" || sq === "ruim") a.sleepQuality = sq;
  a.sleepApnea   = pickBool(raw, "apneia");

  // ── Atividade física ──────────────────────────────────────────────────────
  // novo: sedentario, exercRegular
  // caso: sedentarismo, exercicio_regular
  a.sedentary       = pickBool(raw, "sedentario", "sedentarismo");
  a.regularExercise = pickBool(raw, "exercRegular", "exercicio_regular");

  // ── Nutrição ──────────────────────────────────────────────────────────────
  // novo: ultraproc=bool, proteina=string
  // caso: ultraprocessados=string, proteina=string
  if (typeof raw.ultraproc === "boolean") {
    a.ultraprocessed = raw.ultraproc ? "frequente" : "raramente";
  } else {
    const us = pickStr<"raramente" | "às vezes" | "frequente">(raw, "ultraprocessados");
    if (us === "raramente" || us === "às vezes" || us === "frequente") a.ultraprocessed = us;
  }
  const prot = pickStr<"adequada" | "insuficiente">(raw, "proteina");
  if (prot === "adequada" || prot === "insuficiente") a.protein = prot;

  // ── Resistência à insulina ─────────────────────────────────────────────────
  a.insulinResistance = pickBool(raw, "resistIns", "resistencia_insulina");

  // ── Autoimune ────────────────────────────────────────────────────────────
  a.autoimmune  = pickBool(raw, "autoimune");
  a.autoimuneQual = pickStr(raw, "autoimuneQual", "autoimune_qual");

  // ── Infecção recente ──────────────────────────────────────────────────────
  a.recentInfection = pickBool(raw, "infeccaoRecente", "infeccao_recente");

  // ── Medicações ────────────────────────────────────────────────────────────
  a.corticosteroids    = pickBool(raw, "medicCorticoide",  "corticoides");
  a.nsaids             = pickBool(raw, "medicAINE", "medicAines", "aines");
  a.immunosuppressants = pickBool(raw, "medicImunosupr",   "imunossupressores");
  a.anticoagulants     = pickBool(raw, "medicAnticoag",    "anticoagulantes");
  a.glp1Agonists       = pickBool(raw, "glp1Agonistas",    "glp1_agonistas");

  // ── Histórico de tratamento ───────────────────────────────────────────────
  a.priorPrpHa         = pickBool(raw, "prpPrev",   "prp_ha_previo");
  const resp = pickStr<"boa" | "parcial" | "sem resposta">(raw, "prpResposta", "prp_ha_resposta");
  if (resp === "boa" || resp === "parcial" || resp === "sem resposta") a.priorResponse = resp;
  a.priorInfiltrations       = pickBool(raw, "infiltPrev", "infiltracoes_anteriores");
  a.priorInfiltrationsType   = pickStr(raw, "infiltracoes_tipo");
  a.priorInfiltrationsCount  = pickNum(raw, "infiltracoes_numero");

  return a;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type FactorStatus = "green" | "yellow" | "red" | "na";

export interface BioReadyFactor {
  id: string;
  label: string;
  category: string;
  status: FactorStatus;
  score: number;       // 0–10
  maxScore: 10;
  detail: string;
  recommendation?: string;
  modifiable: boolean;
}

export type BioReadyGrade = "excellent" | "good" | "optimize" | "defer";

export type BioReadyClinicalStatus = "fit" | "reassess" | "not_fit";

export function getBioReadyClinicalStatus(grade: BioReadyGrade): {
  status: BioReadyClinicalStatus;
  color: string;
  background: string;
  border: string;
} {
  if (grade === "excellent" || grade === "good") {
    return { status: "fit", color: "#15803D", background: "#F0FDF4", border: "#86EFAC" };
  }
  if (grade === "optimize") {
    return { status: "reassess", color: "#A16207", background: "#FEFCE8", border: "#FDE047" };
  }
  return { status: "not_fit", color: "#B91C1C", background: "#FEF2F2", border: "#FCA5A5" };
}

export interface BioReadyResult {
  /**
   * 0–100, computed only over factors that have real data (status !== "na").
   * If fewer than 4 factors have real data, `isIncomplete` is true and the
   * grade MUST NOT be presented as a clinical candidacy verdict.
   */
  score: number;
  /** True when < 4 of 10 factors have real data — grade is unreliable */
  isIncomplete: boolean;
  grade: BioReadyGrade;
  gradeLabel: string;
  gradeColor: string;
  gradeBg: string;
  factors: BioReadyFactor[];
  topRecommendations: string[];
  /** 0–1: fraction of factors with real data (status !== "na") */
  dataCompleteness: number;
}

export interface BioReadyInput {
  // ─── Dados do caso principal ───────────────────────────────────────────────
  activeInfection?: boolean;
  malignancy?: boolean;
  dm?: boolean;
  hba1c?: number | null;
  imc?: number | null;
  anticoagulant?: boolean;
  immunosuppressed?: boolean;
  // ─── Anamnese Regenerativa (JSONB — either schema accepted) ────────────────
  anamnese?: Record<string, any>;
  // ─── Exames laboratoriais ──────────────────────────────────────────────────
  /**
   * Número de analitos com flag "H" ou "L".
   * DEVE ser `undefined` quando nenhum exame foi registrado.
   * Use `0` apenas quando exames foram registrados mas todos estão normais.
   */
  labFlagCount?: number;
  plateletCount?: number | null;
  // ─── PROMs ─────────────────────────────────────────────────────────────────
  latestVas?: number | null;
  // ─── Procedimentos ─────────────────────────────────────────────────────────
  hasAdverseEvent?: boolean;
  priorTreatments?: string[];
}

// ─── Grading ─────────────────────────────────────────────────────────────────

function toGrade(score: number): { grade: BioReadyGrade; gradeLabel: string; gradeColor: string; gradeBg: string } {
  if (score >= 90) return { grade: "excellent", gradeLabel: "Excelente candidato",      gradeColor: "#059669", gradeBg: "#ECFDF5" };
  if (score >= 70) return { grade: "good",      gradeLabel: "Bom candidato",            gradeColor: "#0284C7", gradeBg: "#F0F9FF" };
  if (score >= 50) return { grade: "optimize",  gradeLabel: "Otimizar antes do proc.",  gradeColor: "#D97706", gradeBg: "#FFFBEB" };
  return              { grade: "defer",     gradeLabel: "Adiar — corrigir fatores",  gradeColor: "#DC2626", gradeBg: "#FEF2F2" };
}

function fac(
  id: string, label: string, category: string,
  score: number, status: FactorStatus, detail: string,
  modifiable: boolean, recommendation?: string,
): BioReadyFactor {
  return { id, label, category, score, maxScore: 10, status, detail, recommendation, modifiable };
}

// ─── Factor evaluators ───────────────────────────────────────────────────────

function factorContraindications(inp: BioReadyInput): BioReadyFactor {
  // Both fields must be EXPLICITLY confirmed (as boolean values) before the factor can
  // be scored. When either is null/undefined, we cannot claim "no contraindications" —
  // return `na` so the factor is excluded from the score denominator.
  if (inp.activeInfection === true) {
    return fac("contraindications", "Contraindicações absolutas", "Clínico",
      0, "red", "Infecção ativa presente", false,
      "Tratar e resolver a infecção antes de considerar o procedimento.");
  }
  if (inp.malignancy === true) {
    return fac("contraindications", "Contraindicações absolutas", "Clínico",
      0, "red", "Neoplasia ativa presente", false,
      "Neoplasia ativa contraindica o uso de ortobiológicos com potencial proliferativo.");
  }
  // Both explicitly false → confirmed absent
  if (inp.activeInfection === false && inp.malignancy === false) {
    return fac("contraindications", "Contraindicações absolutas", "Clínico",
      10, "green", "Ausência de contraindicações absolutas confirmada", false);
  }
  // At least one is null/undefined — not yet confirmed
  return fac("contraindications", "Contraindicações absolutas", "Clínico",
    7, "na", "Não confirmado — verificar ausência de infecção ativa e neoplasia", false,
    "Confirmar ausência de contraindicações absolutas antes de prosseguir com o procedimento.");
}

function factorSmoking(a: Anam, raw: Record<string, any> | undefined): BioReadyFactor {
  if (a.tabagismo === "sim") {
    const qtd = raw?.tabagismo_qtd ?? raw?.cigsDay;
    const py  = raw?.tabagismo_pack_years ?? raw?.packYears;
    const detail = ["Fumante ativo", qtd ? `${qtd} cigarros/dia` : null, py ? `${py} pack-years` : null]
      .filter(Boolean).join(" · ");
    return fac("smoking", "Tabagismo", "Estilo de vida",
      0, "red", detail, true,
      "Abstinência ao tabaco mínima de 4–6 semanas antes do procedimento — o tabagismo ativo reduz isquemia local e prejudica a resposta biológica.");
  }
  if (a.tabagismo === "ex-fumante") {
    return fac("smoking", "Tabagismo", "Estilo de vida",
      5, "yellow", "Ex-fumante", true,
      "Manter abstinência contínua — efeitos residuais diminuem com o tempo.");
  }
  if (a.tabagismo === "não") {
    return fac("smoking", "Tabagismo", "Estilo de vida", 10, "green", "Não fuma", true);
  }
  return fac("smoking", "Tabagismo", "Estilo de vida",
    7, "na", "Não informado", true,
    "Confirmar status tabágico — tabagismo ativo reduz significativamente a eficácia.");
}

function factorGlycemic(inp: BioReadyInput, a: Anam): BioReadyFactor {
  // Prefer case-level HbA1c, then anamnese
  const hba1c   = inp.hba1c != null ? inp.hba1c : (a.hba1c ?? null);
  const hasDm   = inp.dm || a.diabetesType === "DM1" || a.diabetesType === "DM2";
  const isPreDiab = a.diabetesType === "pré-diabetes";

  // If no diabetes info at all
  if (!hasDm && !isPreDiab && a.diabetesType == null && !inp.dm) {
    return fac("glycemic", "Controle Glicêmico", "Metabólico",
      8, "na", "Não informado", true,
      "Confirmar presença de diabetes e solicitar HbA1c.");
  }

  if (a.diabetesType === "não" && !inp.dm) {
    return fac("glycemic", "Controle Glicêmico", "Metabólico",
      10, "green", "Sem diabetes", true);
  }

  if (isPreDiab) {
    return fac("glycemic", "Controle Glicêmico", "Metabólico",
      7, "yellow", "Pré-diabetes", true,
      "Controle glicêmico e dieta — pré-diabetes já afeta a resposta inflamatória.");
  }

  if (hasDm && hba1c != null) {
    if (hba1c <= 7.0) return fac("glycemic", "Controle Glicêmico", "Metabólico", 8, "green",  `DM · HbA1c ${hba1c}% (controlado)`, true);
    if (hba1c <= 7.5) return fac("glycemic", "Controle Glicêmico", "Metabólico", 5, "yellow", `DM · HbA1c ${hba1c}%`, true,
      "HbA1c entre 7–7,5% — otimize o controle glicêmico antes do procedimento.");
    if (hba1c <= 8.0) return fac("glycemic", "Controle Glicêmico", "Metabólico", 2, "red",    `DM · HbA1c ${hba1c}% (subótimo)`, true,
      "HbA1c > 7,5% — controle inadequado reduz a eficácia biológica. Meta: < 7,5% antes do procedimento.");
    return fac("glycemic", "Controle Glicêmico", "Metabólico", 0, "red", `DM · HbA1c ${hba1c}% (inadequado)`, true,
      "HbA1c > 8% — contraindicação relativa. Encaminhar à endocrinologia e adiar procedimento.");
  }

  if (hasDm) {
    return fac("glycemic", "Controle Glicêmico", "Metabólico",
      4, "yellow", "DM sem HbA1c registrado", true,
      "Registre a HbA1c atual — indispensável para avaliar segurança do procedimento.");
  }

  return fac("glycemic", "Controle Glicêmico", "Metabólico",
    8, "na", "Não informado", true,
    "Confirmar presença de diabetes e solicitar HbA1c.");
}

function factorBmi(inp: BioReadyInput, a: Anam): BioReadyFactor {
  const imc = inp.imc != null ? inp.imc : (a.obesityBmi ?? null);
  if (imc == null) {
    return fac("bmi", "IMC / Composição corporal", "Metabólico",
      7, "na", "IMC não calculado", true,
      "Registre peso e altura — IMC elevado é fator modificável que afeta a eficácia.");
  }
  const L = `IMC ${imc.toFixed(1)} kg/m²`;
  if (imc < 25) return fac("bmi", "IMC / Composição corporal", "Metabólico", 10, "green",  L, true);
  if (imc < 30) return fac("bmi", "IMC / Composição corporal", "Metabólico", 8,  "green",  `${L} (sobrepeso leve)`, true,
    "Redução modesta de peso melhora a resposta ao tratamento.");
  if (imc < 35) return fac("bmi", "IMC / Composição corporal", "Metabólico", 5,  "yellow", `${L} (obesidade grau I)`, true,
    "Alvo: IMC < 30 antes do procedimento para maximizar a eficácia biológica.");
  if (imc < 40) return fac("bmi", "IMC / Composição corporal", "Metabólico", 2,  "red",    `${L} (obesidade grau II)`, true,
    "Obesidade grau II reduz significativamente a eficácia — programa de emagrecimento multidisciplinar.");
  return        fac("bmi", "IMC / Composição corporal", "Metabólico", 0,  "red",    `${L} (obesidade grau III)`, true,
    "Obesidade grau III — eficácia muito reduzida e alto risco técnico. Adiar e tratar obesidade.");
}

function factorActivity(a: Anam): BioReadyFactor {
  // Both fields must be absent for "na"
  if (a.sedentary === undefined && a.regularExercise === undefined) {
    return fac("activity", "Atividade Física", "Estilo de vida",
      6, "na", "Não informado", true,
      "Avaliar nível de atividade física — sedentarismo é fator modificável importante.");
  }
  if (a.sedentary === true) {
    return fac("activity", "Atividade Física", "Estilo de vida",
      2, "red", "Sedentarismo", true,
      "Iniciar programa de atividade física aeróbica (150 min/semana) e fortalecimento muscular pré-procedimento.");
  }
  if (a.regularExercise === true) {
    return fac("activity", "Atividade Física", "Estilo de vida", 10, "green", "Exercício regular", true);
  }
  return fac("activity", "Atividade Física", "Estilo de vida",
    6, "yellow", "Atividade física moderada / irregular", true,
    "Regularizar exercício aeróbico — melhora vascularização tecidual e resposta biológica.");
}

function factorSleep(a: Anam): BioReadyFactor {
  if (a.sleepHours == null && a.sleepQuality == null && a.sleepApnea == null) {
    return fac("sleep", "Qualidade do Sono", "Estilo de vida",
      7, "na", "Não informado", true,
      "Avaliar sono — privação crônica eleva cortisol e reduz resposta regenerativa.");
  }

  let score = 10;
  const details: string[] = [];

  if (a.sleepHours != null) {
    details.push(`${a.sleepHours}h/noite`);
    if (a.sleepHours < 6)      score -= 5;
    else if (a.sleepHours < 7) score -= 2;
  }
  if (a.sleepQuality === "ruim")    { score -= 3; details.push("qualidade ruim"); }
  if (a.sleepQuality === "regular") { score -= 1; details.push("qualidade regular"); }
  if (a.sleepApnea === true)        { score -= 2; details.push("apneia do sono"); }

  score = Math.max(0, score);
  const status: FactorStatus = score >= 8 ? "green" : score >= 5 ? "yellow" : "red";
  const rec = status !== "green"
    ? "Higiene do sono, avaliação de apneia — noites curtas elevam inflamação sistêmica e comprometem a regeneração."
    : undefined;
  return fac("sleep", "Qualidade do Sono", "Estilo de vida",
    score, status, details.join(" · ") || "Registrado", true, rec);
}

function factorInflammatory(a: Anam): BioReadyFactor {
  // na if no relevant data recorded
  if (a.alcool == null && a.protein == null && a.ultraprocessed == null
    && a.insulinResistance == null && a.autoimmune == null) {
    return fac("inflammatory", "Perfil Inflamatório Sistêmico", "Metabólico",
      7, "na", "Não informado", true,
      "Avaliar hábitos alimentares e marcadores metabólicos.");
  }

  let deducao = 0;
  const fatores: string[] = [];

  if (a.alcool === "frequente")         { deducao += 4; fatores.push("álcool frequente"); }
  else if (a.alcool === "social")       { deducao += 1; fatores.push("álcool social"); }

  if (a.ultraprocessed === "frequente") { deducao += 2; fatores.push("dieta inflamatória"); }
  if (a.protein === "insuficiente")     { deducao += 2; fatores.push("proteína insuficiente"); }

  if (a.insulinResistance === true) {
    deducao += 3; fatores.push("resistência à insulina");
  }
  if (a.autoimmune === true) {
    const qual = a.autoimuneQual ? ` (${a.autoimuneQual})` : "";
    deducao += 3; fatores.push(`doença autoimune${qual}`);
  }

  const score  = Math.max(0, 10 - deducao);
  const status: FactorStatus = score >= 8 ? "green" : score >= 5 ? "yellow" : "red";
  const detail = fatores.length > 0 ? fatores.join(" · ") : "Perfil adequado";
  const rec    = status !== "green"
    ? "Dieta anti-inflamatória (mediterrânea), redução de álcool, controle metabólico — reduz carga inflamatória sistêmica."
    : undefined;
  return fac("inflammatory", "Perfil Inflamatório Sistêmico", "Metabólico",
    score, status, detail, true, rec);
}

function factorMedications(inp: BioReadyInput, a: Anam): BioReadyFactor {
  // Only score if at least one medication field was recorded
  const anyMedData =
    a.corticosteroids != null || a.nsaids != null ||
    a.immunosuppressants != null || a.anticoagulants != null ||
    a.glp1Agonists != null;
  const hasCaseLevelMeds = inp.anticoagulant || inp.immunosuppressed;

  if (!anyMedData && !hasCaseLevelMeds) {
    return fac("medications", "Medicações Interferentes", "Clínico",
      8, "na", "Não informado", false,
      "Verificar uso de corticoides, AINEs, anticoagulantes e imunossupressores.");
  }

  const imunossup = inp.immunosuppressed || a.immunosuppressants === true;
  const corticoid = a.corticosteroids === true;
  const aines     = a.nsaids === true;
  const anticoag  = inp.anticoagulant || a.anticoagulants === true;
  const glp1      = a.glp1Agonists === true;

  const meds: string[] = [];
  let score = 10;

  if (imunossup) { score -= 5; meds.push("imunossupressor"); }
  if (corticoid) { score -= 3; meds.push("corticoide"); }
  if (anticoag)  { score -= 2; meds.push("anticoagulante"); }
  if (aines)     { score -= 2; meds.push("AINE"); }
  if (glp1)      { score = Math.min(10, score + 1); meds.push("GLP-1 agonista ✓"); }

  score = Math.max(0, score);
  const status: FactorStatus = score >= 8 ? "green" : score >= 5 ? "yellow" : "red";
  const detail = meds.length > 0 ? meds.join(" · ") : "Sem medicações interferentes";
  const rec    = (imunossup || corticoid)
    ? "Avaliar possibilidade de ajuste com equipe assistente — imunossupressores e corticoides reduzem a resposta biológica."
    : anticoag
      ? "Planejar washout do anticoagulante com equipe assistente antes do procedimento."
      : undefined;
  return fac("medications", "Medicações Interferentes", "Clínico",
    score, status, detail, false, rec);
}

function factorPriorResponse(a: Anam): BioReadyFactor {
  if (a.priorPrpHa == null && a.priorInfiltrations == null) {
    return fac("priorResponse", "Histórico de Tratamento", "Clínico",
      8, "na", "Sem histórico de tratamentos regenerativos prévios", false);
  }

  let score = 10;
  const details: string[] = [];

  if (a.priorResponse === "boa") {
    details.push("boa resposta a PRP/HA prévia");
  } else if (a.priorResponse === "parcial") {
    score -= 3; details.push("resposta parcial a PRP/HA");
  } else if (a.priorResponse === "sem resposta") {
    score -= 7; details.push("sem resposta a PRP/HA prévia");
  }

  if (a.priorInfiltrations === true
    && a.priorInfiltrationsType === "corticoide"
    && (a.priorInfiltrationsCount ?? 0) >= 3) {
    score -= 5; details.push("≥3 infiltrações de corticoide (nicho regenerativo comprometido)");
  }

  score = Math.max(0, score);
  const status: FactorStatus = score >= 8 ? "green" : score >= 5 ? "yellow" : "red";
  const rec = score < 8
    ? "Investigar técnica de preparo, concentração plaquetária e fatores sistêmicos não corrigidos antes de novo ciclo."
    : undefined;
  return fac("priorResponse", "Histórico de Tratamento", "Clínico",
    score, status, details.join(" · ") || "Histórico registrado", false, rec);
}

function factorLabs(inp: BioReadyInput): BioReadyFactor {
  const platelets = inp.plateletCount;

  // `undefined` means no labs have been registered at all
  if (inp.labFlagCount === undefined && platelets == null) {
    return fac("labs", "Exames Laboratoriais", "Laboratorial",
      6, "na", "Sem exames registrados", true,
      "Solicitar hemograma, glicemia, função renal e hepática antes do procedimento.");
  }

  const flagCount = inp.labFlagCount ?? 0;   // 0 = labs present, all normal
  let score = 10;
  const details: string[] = [];

  if (flagCount >= 5)       { score -= 8; details.push(`${flagCount} analitos alterados`); }
  else if (flagCount >= 3)  { score -= 5; details.push(`${flagCount} analitos alterados`); }
  else if (flagCount >= 1)  { score -= 2; details.push(flagCount === 1 ? "1 analito alterado" : `${flagCount} analitos alterados`); }
  else                      { details.push("exames dentro da normalidade"); }

  if (platelets != null && platelets < 100) {
    score -= 4; details.push(`plaquetas ${platelets} × 10³/µL (muito baixas)`);
  } else if (platelets != null && platelets < 150) {
    score -= 2; details.push(`plaquetas ${platelets} × 10³/µL (baixas)`);
  }

  score = Math.max(0, score);
  const status: FactorStatus = score >= 8 ? "green" : score >= 5 ? "yellow" : "red";
  const rec = status !== "green"
    ? "Normalizar analitos alterados antes do procedimento — qualidade do concentrado biológico depende do perfil laboratorial."
    : undefined;
  return fac("labs", "Exames Laboratoriais", "Laboratorial",
    score, status, details.join(" · "), true, rec);
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function computeBioReadyScore(inp: BioReadyInput): BioReadyResult {
  const a = normalizeAnam(inp.anamnese);

  const factors: BioReadyFactor[] = [
    factorContraindications(inp),
    factorSmoking(a, inp.anamnese),
    factorGlycemic(inp, a),
    factorBmi(inp, a),
    factorActivity(a),
    factorSleep(a),
    factorInflammatory(a),
    factorMedications(inp, a),
    factorPriorResponse(a),
    factorLabs(inp),
  ];

  // Score is computed ONLY over factors that have real data (status !== "na").
  // "na" factors are excluded from both the numerator and the denominator so
  // that missing information never inflates the grade.
  const scoredFactors   = factors.filter(f => f.status !== "na");
  const totalPossible   = scoredFactors.length * 10;
  const score           = totalPossible === 0
    ? 0
    : Math.round(scoredFactors.reduce((s, f) => s + f.score, 0) / totalPossible * 100);

  const dataCompleteness = factors.length === 0 ? 0 : scoredFactors.length / factors.length;
  // Fewer than 4 scored factors (< 40%) → grade is unreliable; callers must not
  // present it as a clinical candidacy verdict without a clear "insufficient data" label.
  const isIncomplete = scoredFactors.length < 4;

  const gradeInfo = toGrade(score);

  const actionable = factors
    .filter(f => (f.status === "red" || f.status === "yellow") && f.recommendation && f.modifiable)
    .sort((a, b) => (b.maxScore - b.score) - (a.maxScore - a.score))
    .slice(0, 3)
    .map(f => f.recommendation!);

  return {
    score,
    isIncomplete,
    ...gradeInfo,
    factors,
    topRecommendations: actionable,
    dataCompleteness,
  };
}

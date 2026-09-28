export interface AssessmentField {
  key: string;
  label: string;
  type: "number" | "select" | "text" | "boolean";
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface AssessmentTypeMeta {
  label: string;
  fields: AssessmentField[];
}

export const ASSESSMENT_META: Record<string, AssessmentTypeMeta> = {
  adm: {
    label: "ADM (amplitude de movimento)",
    fields: [
      { key: "extensao_deficit_graus", label: "Déficit de extensão (°) — 0 = completa", type: "number", required: true, min: -20, max: 60 },
      { key: "flexao_graus", label: "Flexão (°)", type: "number", required: true, min: 0, max: 180 },
    ],
  },
  derrame: {
    label: "Derrame (stroke test)",
    fields: [
      { key: "grau", label: "Grau (0–3)", type: "number", required: true, min: 0, max: 3 },
      { key: "persistente", label: "Persistente (2+ semanas)", type: "boolean" },
    ],
  },
  circunferencia: {
    label: "Circunferência de coxa",
    fields: [
      { key: "coxa_operado_cm", label: "Coxa operada (cm)", type: "number", required: true, step: 0.1 },
      { key: "coxa_saudavel_cm", label: "Coxa saudável (cm)", type: "number", required: true, step: 0.1 },
    ],
  },
  forca: {
    label: "Força (LSI)",
    fields: [
      { key: "quadriceps_operado", label: "Quadríceps operado", type: "number", required: true, step: 0.1 },
      { key: "quadriceps_saudavel", label: "Quadríceps saudável", type: "number", required: true, step: 0.1 },
      { key: "isquiotibiais_operado", label: "Isquiotibiais operado", type: "number", step: 0.1 },
      { key: "isquiotibiais_saudavel", label: "Isquiotibiais saudável", type: "number", step: 0.1 },
      { key: "unidade", label: "Unidade (kgf, Nm...)", type: "text" },
    ],
  },
  forca_mrc: {
    label: "Força manual (MRC)",
    fields: [
      { key: "quadriceps_mrc", label: "Quadríceps (MRC 0–5)", type: "number", required: true, min: 0, max: 5 },
      { key: "isquiotibiais_mrc", label: "Isquiotibiais (MRC 0–5)", type: "number", min: 0, max: 5 },
      { key: "slr_sem_lag", label: "SLR sem lag de extensão", type: "boolean" },
    ],
  },
  agachamento_unipodal: {
    label: "Agachamento unipodal",
    fields: [
      { key: "qualidade", label: "Qualidade", type: "select", required: true, options: [
        { value: "bom", label: "Bom" },
        { value: "moderado", label: "Moderado" },
        { value: "ruim", label: "Ruim" },
      ]},
    ],
  },
  valgo_dinamico: {
    label: "Valgo dinâmico",
    fields: [
      { key: "grau", label: "Grau", type: "select", required: true, options: [
        { value: "ausente", label: "Ausente" },
        { value: "leve", label: "Leve" },
        { value: "moderado", label: "Moderado" },
        { value: "grave", label: "Grave" },
      ]},
    ],
  },
  equilibrio: {
    label: "Equilíbrio",
    fields: [
      { key: "teste", label: "Teste aplicado", type: "text" },
      { key: "resultado", label: "Resultado", type: "text" },
    ],
  },
  hop: {
    label: "Hop tests",
    fields: [
      { key: "single_operado", label: "Single hop operado (cm)", type: "number", required: true, step: 0.1 },
      { key: "single_saudavel", label: "Single hop saudável (cm)", type: "number", required: true, step: 0.1 },
      { key: "triple_operado", label: "Triple hop operado (cm)", type: "number", step: 0.1 },
      { key: "triple_saudavel", label: "Triple hop saudável (cm)", type: "number", step: 0.1 },
      { key: "crossover_operado", label: "Crossover operado (cm)", type: "number", step: 0.1 },
      { key: "crossover_saudavel", label: "Crossover saudável (cm)", type: "number", step: 0.1 },
    ],
  },
  y_balance: {
    label: "Y-Balance",
    fields: [
      { key: "composto_operado", label: "Escore composto operado", type: "number", required: true, step: 0.1 },
      { key: "composto_saudavel", label: "Escore composto saudável", type: "number", required: true, step: 0.1 },
    ],
  },
  less: {
    label: "LESS (aterrissagem)",
    fields: [{ key: "escore", label: "Escore (0–17, menor = melhor)", type: "number", required: true, min: 0, max: 17 }],
  },
  acl_rsi: {
    label: "ACL-RSI (prontidão psicológica)",
    fields: [{ key: "escore", label: "Escore (0–100)", type: "number", required: true, min: 0, max: 100 }],
  },
  marcha: {
    label: "Marcha",
    fields: [
      { key: "padrao", label: "Padrão", type: "select", required: true, options: [
        { value: "normal", label: "Normal" },
        { value: "claudicante", label: "Claudicante" },
        { value: "com_auxiliar", label: "Com auxiliar de marcha" },
      ]},
    ],
  },
  tug: {
    label: "TUG (Timed Up and Go)",
    fields: [{ key: "segundos", label: "Tempo (segundos)", type: "number", required: true, step: 0.1 }],
  },
  sts_30s: {
    label: "Sit-to-stand 30s",
    fields: [{ key: "repeticoes", label: "Repetições", type: "number", required: true, min: 0 }],
  },
  visa_p: {
    label: "VISA-P",
    fields: [{ key: "escore", label: "Escore (0–100)", type: "number", required: true, min: 0, max: 100 }],
  },
  dor_carga: {
    label: "Dor sob carga (EVA)",
    fields: [{ key: "eva", label: "EVA no single leg decline squat (0–10)", type: "number", required: true, min: 0, max: 10 }],
  },
  retorno_esporte: {
    label: "Retorno ao esporte",
    fields: [
      { key: "decisao", label: "Decisão", type: "select", required: true, options: [
        { value: "apto", label: "Apto" },
        { value: "parcial", label: "Parcial" },
        { value: "nao_apto", label: "Não apto" },
      ]},
      { key: "justificativa", label: "Justificativa", type: "text", required: true },
    ],
  },
};

export const COMMON_FIELDS: AssessmentField[] = [
  { key: "observacoes", label: "Observações", type: "text" },
  { key: "falseio", label: "Paciente relatou episódio de falseio", type: "boolean" },
];

export const RED_FLAG_LABELS: Record<string, string> = {
  giving_way_episode: "Episódio de falseio",
  extension_deficit: "Déficit de extensão",
  atj_stiffness_risk: "Risco de rigidez (ATJ)",
  persistent_effusion: "Derrame persistente",
  quadriceps_lsi_below_90: "LSI quadríceps < 90%",
  hop_lsi_below_90: "LSI hop < 90%",
  acl_rsi_below_65: "ACL-RSI < 65",
};

export const COMPUTED_LABELS: Record<string, string> = {
  extensao_completa: "Extensão completa",
  grau: "Grau",
  diferenca_cm: "Diferença (cm)",
  lsi_quadriceps: "LSI quadríceps",
  lsi_isquiotibiais: "LSI isquiotibiais",
  lsi_single_hop: "LSI single hop",
  lsi_triple_hop: "LSI triple hop",
  lsi_crossover_hop: "LSI crossover hop",
  lsi_hop_medio: "LSI médio dos hop tests",
  lsi_composto: "LSI composto",
  classificacao: "Classificação",
  escore: "Escore",
  dentro_da_meta: "Dentro da meta",
};

export function assessmentLabel(type: string): string {
  return ASSESSMENT_META[type]?.label ?? type;
}

export function computedLabel(key: string): string {
  return COMPUTED_LABELS[key] ?? key;
}

export function computedValueLabel(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (key === "classificacao" && typeof value === "string") {
    const classifications: Record<string, string> = {
      excelente: "Excelente",
      bom: "Bom",
      moderado: "Moderado",
      ruim: "Ruim",
    };
    return classifications[value] ?? value;
  }
  return String(value);
}

export function isControlledComputedValue(key: string, value: unknown): boolean {
  return typeof value === "boolean"
    || (key === "classificacao" && typeof value === "string"
      && ["excelente", "bom", "moderado", "ruim"].includes(value));
}

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

// Avaliações de reabilitação do joelho (quadríceps, hop tests, ACL-RSI etc.)
// retiradas; as de ombro/cotovelo entram com o protocolo definido pelo médico.
export const ASSESSMENT_META: Record<string, AssessmentTypeMeta> = {
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
];

export const RED_FLAG_LABELS: Record<string, string> = {};

export const COMPUTED_LABELS: Record<string, string> = {
  escore: "Escore",
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

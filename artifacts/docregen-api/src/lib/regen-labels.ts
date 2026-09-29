import type { SupportedLocale } from "./locale";

const REGEN_PERIOD_LABELS: Record<string, Record<SupportedLocale, string>> = {
  "pós-operatório": { "pt-BR": "Pós-operatório", es: "Posoperatorio" },
  "Pré-op (Baseline)": { "pt-BR": "Pré-op (Baseline)", es: "Preoperatorio (basal)" },
  "Pré-operatório": { "pt-BR": "Pré-operatório", es: "Preoperatorio" },
  preop: { "pt-BR": "Pré-operatório", es: "Preoperatorio" },
  "1 mês": { "pt-BR": "1 mês", es: "1 mes" },
  "30 dias": { "pt-BR": "30 dias", es: "30 días" },
  "30d": { "pt-BR": "30 dias", es: "30 días" },
  "6 semanas": { "pt-BR": "6 semanas", es: "6 semanas" },
  "6 semanas (HA)": { "pt-BR": "6 semanas (HA)", es: "6 semanas (AH)" },
  "3 meses": { "pt-BR": "3 meses", es: "3 meses" },
  "90 dias": { "pt-BR": "90 dias", es: "90 días" },
  "90d": { "pt-BR": "90 dias", es: "90 días" },
  "6 meses ★": { "pt-BR": "6 meses ★", es: "6 meses ★" },
  "180 dias": { "pt-BR": "180 dias", es: "180 días" },
  "180d": { "pt-BR": "180 dias", es: "180 días" },
  "12 meses": { "pt-BR": "12 meses", es: "12 meses" },
  "1 ano": { "pt-BR": "1 ano", es: "1 año" },
  "1y": { "pt-BR": "1 ano", es: "1 año" },
  "24 meses": { "pt-BR": "24 meses", es: "24 meses" },
  "2 anos": { "pt-BR": "2 anos", es: "2 años" },
  "2y": { "pt-BR": "2 anos", es: "2 años" },
  "4 anos": { "pt-BR": "4 anos", es: "4 años" },
  "5 anos": { "pt-BR": "5 anos", es: "5 años" },
  "5y": { "pt-BR": "5 anos", es: "5 años" },
};

const REGEN_SCALE_LABELS: Record<string, Record<SupportedLocale, string>> = {
  VAS: { "pt-BR": "VAS", es: "EVA" },
  "VAS Dor": { "pt-BR": "VAS Dor", es: "EVA Dolor" },
  "SANE Joelho": { "pt-BR": "SANE Joelho", es: "SANE Rodilla" },
  SANE_JOELHO: { "pt-BR": "SANE Joelho", es: "SANE Rodilla" },
};

/** Presentation-only localization; persisted period identifiers and free text stay untouched. */
export function regenPeriodForLocale(value: unknown, locale: SupportedLocale): string {
  if (typeof value !== "string") return value == null ? "" : String(value);
  return REGEN_PERIOD_LABELS[value]?.[locale] ?? value;
}

/** Presentation-only localization; persisted scale identifiers and unknown names stay untouched. */
export function regenScaleForLocale(value: unknown, locale: SupportedLocale): string {
  if (typeof value !== "string") return value == null ? "" : String(value);
  return REGEN_SCALE_LABELS[value]?.[locale] ?? value;
}
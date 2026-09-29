import type { Locale } from "@/lib/i18n";

/**
 * Labels for values whose Portuguese form is the persisted/API canonical value.
 * Unknown values deliberately remain untouched: they may be free text or API
 * data and must never be translated by the client.
 */
const SPANISH_REPORT_CATALOG_LABELS: Record<string, string> = {
  "Pré-operatório": "Preoperatorio",
  "Pré-op (Baseline)": "Preoperatorio (basal)",
  "2 semanas": "2 semanas",
  "3 semanas": "3 semanas",
  "7-14 dias": "7-14 días",
  "30 dias": "30 días",
  "1 mês": "1 mes",
  "6 semanas": "6 semanas",
  "45 dias": "45 días",
  "60 dias": "60 días",
  "2 meses": "2 meses",
  "90 dias": "90 días",
  "3 meses": "3 meses",
  "120 dias": "120 días",
  "4 meses": "4 meses",
  "150 dias": "150 días",
  "5 meses": "5 meses",
  "180 dias": "180 días",
  "6 meses": "6 meses",
  "9 meses": "9 meses",
  "270 dias": "270 días",
  "1 ano": "1 año",
  "1 ano ★": "1 año ★",
  "12 meses": "12 meses",
  "18 meses": "18 meses",
  "2 anos": "2 años",
  "24 meses": "24 meses",
  "3 anos": "3 años",
  "5 anos": "5 años",
  "36 meses": "36 meses",
  "48 meses": "48 meses",
  "60 meses": "60 meses",
  "4 anos": "4 años",
  "Anual (≥3 anos)": "Anual (≥3 años)",
  "3 meses ★": "3 meses ★",
  "6 semanas (HA)": "6 semanas (HA)",
  "6 meses ★": "6 meses ★",
  "VAS Dor": "VAS Dolor",
  Outro: "Otro",
  Sedentário: "Sedentario",
  Recreacional: "Recreativo",
  Amador: "Aficionado",
  "Semi-profissional": "Semiprofesional",
  Profissional: "Profesional",
  Direito: "Derecho",
  Esquerdo: "Izquierdo",
  Masculino: "Masculino",
  Feminino: "Femenino",
  "mesmo nível": "mismo nivel",
  "nível inferior": "nivel inferior",
  "esporte recreacional": "deporte recreativo",
  "sem esporte": "sin deporte",
  "Instabilidade residual": "Inestabilidad residual",
  "Rigidez articular": "Rigidez articular",
  Infecção: "Infección",
  Outra: "Otra",
};

const SPANISH_FOLLOWUP_PERIOD_LABELS: Record<string, string> = {
  preop: "Preoperatorio",
  "30d": "30 días",
  "90d": "90 días",
  "180d": "180 días",
  "1y": "1 año",
  "2y": "2 años",
  "5y": "5 años",
};

export function reportCatalogLabel(locale: Locale, canonicalValue: string): string {
  if (locale !== "es") return canonicalValue;
  return SPANISH_REPORT_CATALOG_LABELS[canonicalValue] ?? canonicalValue;
}

export function reportCatalogLabels(locale: Locale, canonicalValues: readonly string[]): string[] {
  return canonicalValues.map((value) => reportCatalogLabel(locale, value));
}

/** Presentation-only follow-up label; canonical/API values are never changed. */
export function reportFollowupPeriodLabel(locale: Locale, canonicalValue: string): string {
  if (locale !== "es") return canonicalValue;
  return SPANISH_FOLLOWUP_PERIOD_LABELS[canonicalValue]
    ?? reportCatalogLabel(locale, canonicalValue);
}

/** Presentation-only labels for the classic and regenerative score catalogs. */
export function reportScaleLabel(locale: Locale, canonicalValue: string): string {
  return reportCatalogLabel(locale, canonicalValue);
}

export function reportScaleLabels(locale: Locale, canonicalValues: readonly string[]): string[] {
  return canonicalValues.map((value) => reportScaleLabel(locale, value));
}

export function reportCatalogOptions(locale: Locale, canonicalValues: readonly string[]) {
  return canonicalValues.map((value) => ({ value, label: reportCatalogLabel(locale, value) }));
}
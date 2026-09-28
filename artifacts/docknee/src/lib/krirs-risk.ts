import type { Locale } from "@/lib/i18n";

export type KrirsRiskLevel = "alto" | "intermediario" | "baixo";

const KRIRS_RISK_LABELS: Record<Locale, Record<KrirsRiskLevel, string>> = {
  "pt-BR": {
    alto: "Alto risco de re-ruptura",
    intermediario: "Risco intermediário",
    baixo: "Baixo risco",
  },
  es: {
    alto: "Alto riesgo de nueva rotura",
    intermediario: "Riesgo intermedio",
    baixo: "Riesgo bajo",
  },
};

export function getKrirsRiskLevel(
  score?: number | null,
  flagAltoRisco?: boolean | null,
  interpretacao?: string | null,
): KrirsRiskLevel {
  const normalized = interpretacao
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized?.includes("intermedi") || normalized?.includes("moderad")) return "intermediario";
  if (normalized?.includes("alto") || normalized?.includes("high")) return "alto";
  if (normalized?.includes("baixo") || normalized?.includes("bajo") || normalized?.includes("low")) return "baixo";
  if (flagAltoRisco || score === 99 || (score != null && score >= 6)) return "alto";
  if (score != null && score >= 3) return "intermediario";
  return "baixo";
}

export function getKrirsRiskLabel(level: KrirsRiskLevel, locale: Locale): string {
  return KRIRS_RISK_LABELS[locale][level];
}

export function getKrirsDisplayJustification(
  justification: string | null | undefined,
  level: KrirsRiskLevel,
  locale: Locale,
): string {
  if (!justification || /(?:score|pontua(?:ção|cao)|puntuación).*krirs|krirs.*(?:score|pontua|puntuaci)/i.test(justification)) {
    return getKrirsRiskLabel(level, locale);
  }
  return justification;
}
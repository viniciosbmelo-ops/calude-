import type { Locale } from "@/lib/i18n";

/**
 * PTS classification is based on the measured angle.  Acquisition-method
 * caveats (including the method-B warning) must not alter these boundaries.
 */
export type PTSClassification = "normal" | "borderline" | "pathological";

export const PTS_CLASSIFICATION_LABELS: Record<PTSClassification, { "pt-BR": string; es: string }> = {
  normal: { "pt-BR": "Normal", es: "Normal" },
  borderline: { "pt-BR": "Limítrofe", es: "Limítrofe" },
  pathological: { "pt-BR": "Patológico", es: "Patológico" },
};

export const PTS_CLASSIFICATION_RANGES: Record<PTSClassification, { "pt-BR": string; es: string }> = {
  normal: { "pt-BR": "≤11°", es: "≤11°" },
  borderline: { "pt-BR": ">11° e ≤15°", es: ">11° y ≤15°" },
  pathological: { "pt-BR": ">15°", es: ">15°" },
};

/**
 * Return null for absent or non-numeric values instead of treating them as
 * normal. This is deliberately strict: persisted numeric strings and invalid
 * AI output must not silently acquire a clinical classification.
 */
export function classifyPTS(value: unknown): PTSClassification | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 11) return "normal";
  if (value <= 15) return "borderline";
  return "pathological";
}

export function getPTSClassificationLabel(
  classification: PTSClassification,
  locale: Locale = "pt-BR",
): string {
  return PTS_CLASSIFICATION_LABELS[classification][locale];
}

export function getPTSClassificationRange(
  classification: PTSClassification,
  locale: Locale = "pt-BR",
): string {
  return PTS_CLASSIFICATION_RANGES[classification][locale];
}
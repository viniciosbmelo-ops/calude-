import { CASE_TYPE_BY_KEY, CASE_TYPES } from "@workspace/clinical/web";
import type { Locale } from "@/lib/i18n";

/**
 * Presentation labels for the case-type keys stored in
 * `surgeries.tipos_procedimento` (e.g. "SH_CUFF"). The Portuguese label comes
 * from the shared clinical catalog; Spanish labels are kept here. Unknown keys
 * (legacy data, free text) are returned unchanged.
 */
const SPANISH_CASE_TYPE_LABELS: Record<string, string> = {
  SH_CUFF: "Manguito rotador",
  SH_INSTABILITY: "Inestabilidad",
  SH_BICEPS_SLAP: "Bíceps y SLAP",
  SH_AC: "Acromioclavicular",
  SH_ARTHROPLASTY: "Artroplastia",
  SH_FRACTURE: "Fracturas",
  SH_STIFF: "Rigidez y capsulitis",
  SH_CALC: "Tendinitis calcificante",
  SH_OTHER_TENDON: "Otras lesiones",
  EL_DISTAL_BICEPS: "Bíceps distal",
  EL_EPICONDYLITIS: "Epicondilitis",
  EL_INSTABILITY: "Inestabilidad",
  EL_STIFF_OA: "Rigidez y artrosis",
  EL_FRACTURE: "Fracturas",
  EL_NERVE_TENDON: "Nervio cubital y tríceps",
  SH_ORTHOBIO: "Ortobiológicos",
  EL_ORTHOBIO: "Ortobiológicos",
};

const REGION_LABELS: Record<Locale, Record<string, string>> = {
  "pt-BR": { shoulder: "Ombro", elbow: "Cotovelo" },
  es: { shoulder: "Hombro", elbow: "Codo" },
};

/** Labels shared by a shoulder and an elbow case type (e.g. "Fraturas"). */
const AMBIGUOUS_PT_LABELS = (() => {
  const seen = new Map<string, number>();
  for (const ct of CASE_TYPES) seen.set(ct.label, (seen.get(ct.label) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([label]) => label));
})();

export function caseTypeLabel(locale: Locale, key: string): string {
  const ct = CASE_TYPE_BY_KEY.get(key);
  if (!ct) return key;
  const base = locale === "es" ? SPANISH_CASE_TYPE_LABELS[key] ?? ct.label : ct.label;
  if (!AMBIGUOUS_PT_LABELS.has(ct.label)) return base;
  return `${base} (${REGION_LABELS[locale][ct.region] ?? ct.region})`;
}

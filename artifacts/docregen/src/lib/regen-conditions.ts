/**
 * DocRegen regenerative conditions catalog (frontend copy) and the single
 * label helper used wherever a condition code is shown (case list, case
 * detail, dashboard, reports, research export, follow-up central, secretary
 * portal). Mirrors artifacts/docregen-api/src/lib/regen-conditions.ts — the
 * parity test (regen-conditions.test.ts) fails if the two drift apart.
 *
 * Knee osteoarthritis is captured per Kellgren-Lawrence grade as separate
 * codes (OA_JOELHO_KL1..KL4), consistent with the flat code-per-condition
 * catalog used for every other region.
 */
export const REGEN_CONDITION_REGIONS = [
  "joelho",
  "ombro",
  "cotovelo",
  "quadril",
  "pe_tornozelo",
  "punho_mao",
  "coluna_cervical",
  "coluna_toracica",
  "coluna_lombar",
  "outras",
] as const;

export type RegenConditionRegion = (typeof REGEN_CONDITION_REGIONS)[number];

export interface RegenConditionDefinition {
  code: string;
  name: string;
  es: string;
  region: RegenConditionRegion;
  kellgrenLawrence?: 1 | 2 | 3 | 4;
}

const KL_ROMAN = ["I", "II", "III", "IV"] as const;

const KNEE_OA_BY_KL: RegenConditionDefinition[] = ([1, 2, 3, 4] as const).map((grade) => ({
  code: `OA_JOELHO_KL${grade}`,
  name: `Osteoartrite de Joelho — Kellgren-Lawrence ${KL_ROMAN[grade - 1]}`,
  es: `Osteoartritis de rodilla — Kellgren-Lawrence ${KL_ROMAN[grade - 1]}`,
  region: "joelho",
  kellgrenLawrence: grade,
}));

export const REGEN_CONDITION_CATALOG: readonly RegenConditionDefinition[] = [
  ...KNEE_OA_BY_KL,
  { code: "LESAO_MENISCAL_DEGENERATIVA", name: "Lesão Meniscal Degenerativa", es: "Lesión meniscal degenerativa", region: "joelho" },
  { code: "TENDINOPATIA_PATELAR", name: "Tendinopatia Patelar", es: "Tendinopatía rotuliana", region: "joelho" },
  { code: "CONDROPATIA_PATELAR", name: "Condropatia Patelar / Femoropatelar", es: "Condropatía rotuliana / femoropatelar", region: "joelho" },
  { code: "OA_QUADRIL", name: "Osteoartrite de Quadril", es: "Osteoartritis de cadera", region: "quadril" },
  { code: "OA_OMBRO", name: "Osteoartrose de Ombro", es: "Osteoartritis de hombro", region: "ombro" },
  { code: "TENDINOPATIA_OMBRO", name: "Tendinopatia do Manguito Rotador", es: "Tendinopatía del manguito rotador", region: "ombro" },
  { code: "BURSITE_OMBRO", name: "Bursite de Ombro", es: "Bursitis de hombro", region: "ombro" },
  { code: "LESAO_LABRAL_OMBRO", name: "Lesão Labral de Ombro", es: "Lesión labral de hombro", region: "ombro" },
  { code: "OA_COTOVELO", name: "Osteoartrose de Cotovelo", es: "Osteoartritis de codo", region: "cotovelo" },
  { code: "TENDINOPATIA_COTOVELO", name: "Tendinopatia de Cotovelo", es: "Tendinopatía de codo", region: "cotovelo" },
  { code: "EPICONDILITE", name: "Epicondilite Lateral / Medial", es: "Epicondilitis lateral / medial", region: "cotovelo" },
  { code: "OA_TORNOZELO", name: "Osteoartrite de Tornozelo", es: "Osteoartritis de tobillo", region: "pe_tornozelo" },
  { code: "FASCITE_PLANTAR", name: "Fasciíte Plantar", es: "Fascitis plantar", region: "pe_tornozelo" },
  { code: "OA_PUNHO", name: "Osteoartrose de Punho", es: "Osteoartritis de muñeca", region: "punho_mao" },
  { code: "TENDINOPATIA_PUNHO", name: "Tendinopatia de Punho e Mão", es: "Tendinopatía de muñeca y mano", region: "punho_mao" },
  { code: "SINDROME_TUNEL_CARPO", name: "Síndrome do Túnel do Carpo", es: "Síndrome del túnel carpiano", region: "punho_mao" },
  { code: "OA_COLUNA_CERVICAL", name: "Osteoartrose Cervical", es: "Osteoartritis cervical", region: "coluna_cervical" },
  { code: "HERNIA_DISCAL_CERVICAL", name: "Hérnia Discal Cervical", es: "Hernia discal cervical", region: "coluna_cervical" },
  { code: "OA_COLUNA_TORACICA", name: "Osteoartrose Torácica", es: "Osteoartritis torácica", region: "coluna_toracica" },
  { code: "HERNIA_DISCAL_TORACICA", name: "Hérnia Discal Torácica", es: "Hernia discal torácica", region: "coluna_toracica" },
  { code: "OA_COLUNA_LOMBAR", name: "Osteoartrose Lombar", es: "Osteoartritis lumbar", region: "coluna_lombar" },
  { code: "HERNIA_DISCAL_LOMBAR", name: "Hérnia Discal Lombar", es: "Hernia discal lumbar", region: "coluna_lombar" },
  { code: "CONDRAL_FOCAL", name: "Lesão Condral Focal", es: "Lesión condral focal", region: "outras" },
  { code: "OSTEOCONDRAL", name: "Lesão Osteocondral", es: "Lesión osteocondral", region: "outras" },
  { code: "TENDINOPATIA", name: "Tendinopatia", es: "Tendinopatía", region: "outras" },
  { code: "SINOVITE", name: "Sinovite / Sinovite Vilonodular", es: "Sinovitis / sinovitis villonodular", region: "outras" },
  { code: "BURSITE", name: "Bursite", es: "Bursitis", region: "outras" },
  { code: "FRATURA_FADIGA", name: "Fratura por Fadiga / Estresse", es: "Fractura por fatiga / estrés", region: "outras" },
  { code: "POS_OPERATORIO", name: "Pós-Operatório / Bioestimulação", es: "Posoperatorio / bioestimulación", region: "outras" },
  { code: "CUSTOM", name: "Outra Condição (especificar)", es: "Otra condición (especificar)", region: "outras" },
];

/** Codes from earlier catalogs: labelled for display, not offered for new cases. */
export const LEGACY_REGEN_CONDITIONS: Readonly<Record<string, { name: string; es: string; region: RegenConditionRegion }>> = {
  OA_JOELHO: { name: "Osteoartrite de Joelho", es: "Osteoartritis de rodilla", region: "joelho" },
  REPARO_MENISCAL: { name: "Reparo Meniscal / Pós-Sutura Meniscal", es: "Reparación meniscal / posutura meniscal", region: "joelho" },
  LESAO_LIGAMENTAR: { name: "Lesão Ligamentar (Pós-LCA, etc.)", es: "Lesión ligamentaria (pos-LCA, etc.)", region: "joelho" },
  knee_oa: { name: "Osteoartrose de Joelho", es: "Osteoartritis de rodilla", region: "joelho" },
  hip_oa: { name: "Osteoartrose de Quadril", es: "Osteoartritis de cadera", region: "quadril" },
  shoulder_oa: { name: "Osteoartrose de Ombro", es: "Osteoartritis de hombro", region: "ombro" },
  ankle_oa: { name: "Osteoartrose de Tornozelo", es: "Osteoartritis de tobillo", region: "pe_tornozelo" },
  tendinopathy: { name: "Tendinopatia", es: "Tendinopatía", region: "outras" },
  chondral: { name: "Lesão Condral", es: "Lesión condral", region: "outras" },
  other: { name: "Outro", es: "Otra condición", region: "outras" },
};

const BY_CODE = new Map<string, { name: string; es: string; region: RegenConditionRegion }>([
  ...REGEN_CONDITION_CATALOG.map((c) => [c.code, c] as const),
  ...Object.entries(LEGACY_REGEN_CONDITIONS),
]);

function humanizeCode(code: string): string {
  // Only code-like values (SOME_CODE, knee_oa, OA) are humanised; anything
  // else is free text typed by a clinician and is shown verbatim.
  if (!/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$|^[A-Z0-9]+$/.test(code)) return code;
  const words = code.toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (!words.length) return code;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Human label for a condition code. A free-text `custom` description wins
 * when present (that is what the clinician typed). Unknown codes are
 * humanised ("SOME_CODE" → "Some code") instead of shown raw.
 */
export function regenConditionLabel(
  code: string | null | undefined,
  locale: string = "pt-BR",
  custom?: string | null,
): string {
  const customText = custom?.trim();
  if (customText) return customText;
  if (!code) return "";
  const entry = BY_CODE.get(code);
  if (!entry) return humanizeCode(code);
  return locale.startsWith("es") ? entry.es : entry.name;
}

export function regenConditionRegion(code: string | null | undefined): RegenConditionRegion {
  return (code && BY_CODE.get(code)?.region) || "outras";
}

export function kellgrenLawrenceGrade(code: string | null | undefined): 1 | 2 | 3 | 4 | null {
  if (!code) return null;
  return REGEN_CONDITION_CATALOG.find((c) => c.code === code)?.kellgrenLawrence ?? null;
}

/**
 * DocRegen regenerative conditions catalog — single backend source for the
 * seeded `regen_conditions` rows, display names (pt-BR / es) and validation.
 *
 * The catalog is flat: one code per selectable condition, grouped by body
 * region. Grades that change indication and prognosis are part of the code
 * (knee osteoarthritis is captured per Kellgren-Lawrence grade as
 * OA_JOELHO_KL1..KL4) so they are queryable in reports and research exports
 * without any extra field. Keep the frontend copy
 * (artifacts/docregen/src/lib/regen-conditions.ts) in sync — a parity test
 * compares both.
 */
export type RegenConditionRegion =
  | "joelho"
  | "ombro"
  | "cotovelo"
  | "quadril"
  | "pe_tornozelo"
  | "punho_mao"
  | "coluna_cervical"
  | "coluna_toracica"
  | "coluna_lombar"
  | "outras";

export interface RegenConditionDefinition {
  code: string;
  name: string;
  es: string;
  region: RegenConditionRegion;
  /** Kellgren-Lawrence radiographic grade, for graded osteoarthritis codes. */
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
  // ── Joelho ────────────────────────────────────────────────────────────────
  ...KNEE_OA_BY_KL,
  { code: "LESAO_MENISCAL_DEGENERATIVA", name: "Lesão Meniscal Degenerativa", es: "Lesión meniscal degenerativa", region: "joelho" },
  { code: "TENDINOPATIA_PATELAR", name: "Tendinopatia Patelar", es: "Tendinopatía rotuliana", region: "joelho" },
  { code: "CONDROPATIA_PATELAR", name: "Condropatia Patelar / Femoropatelar", es: "Condropatía rotuliana / femoropatelar", region: "joelho" },
  // ── Quadril ───────────────────────────────────────────────────────────────
  { code: "OA_QUADRIL", name: "Osteoartrite de Quadril", es: "Osteoartritis de cadera", region: "quadril" },
  // ── Ombro ─────────────────────────────────────────────────────────────────
  { code: "OA_OMBRO", name: "Osteoartrose de Ombro", es: "Osteoartritis de hombro", region: "ombro" },
  { code: "TENDINOPATIA_OMBRO", name: "Tendinopatia do Manguito Rotador", es: "Tendinopatía del manguito rotador", region: "ombro" },
  { code: "BURSITE_OMBRO", name: "Bursite de Ombro", es: "Bursitis de hombro", region: "ombro" },
  { code: "LESAO_LABRAL_OMBRO", name: "Lesão Labral de Ombro", es: "Lesión labral de hombro", region: "ombro" },
  // ── Cotovelo ──────────────────────────────────────────────────────────────
  { code: "OA_COTOVELO", name: "Osteoartrose de Cotovelo", es: "Osteoartritis de codo", region: "cotovelo" },
  { code: "TENDINOPATIA_COTOVELO", name: "Tendinopatia de Cotovelo", es: "Tendinopatía de codo", region: "cotovelo" },
  { code: "EPICONDILITE", name: "Epicondilite Lateral / Medial", es: "Epicondilitis lateral / medial", region: "cotovelo" },
  // ── Pé e tornozelo ────────────────────────────────────────────────────────
  { code: "OA_TORNOZELO", name: "Osteoartrite de Tornozelo", es: "Osteoartritis de tobillo", region: "pe_tornozelo" },
  { code: "FASCITE_PLANTAR", name: "Fasciíte Plantar", es: "Fascitis plantar", region: "pe_tornozelo" },
  // ── Punho e mão ───────────────────────────────────────────────────────────
  { code: "OA_PUNHO", name: "Osteoartrose de Punho", es: "Osteoartritis de muñeca", region: "punho_mao" },
  { code: "TENDINOPATIA_PUNHO", name: "Tendinopatia de Punho e Mão", es: "Tendinopatía de muñeca y mano", region: "punho_mao" },
  { code: "SINDROME_TUNEL_CARPO", name: "Síndrome do Túnel do Carpo", es: "Síndrome del túnel carpiano", region: "punho_mao" },
  // ── Coluna ────────────────────────────────────────────────────────────────
  { code: "OA_COLUNA_CERVICAL", name: "Osteoartrose Cervical", es: "Osteoartritis cervical", region: "coluna_cervical" },
  { code: "HERNIA_DISCAL_CERVICAL", name: "Hérnia Discal Cervical", es: "Hernia discal cervical", region: "coluna_cervical" },
  { code: "OA_COLUNA_TORACICA", name: "Osteoartrose Torácica", es: "Osteoartritis torácica", region: "coluna_toracica" },
  { code: "HERNIA_DISCAL_TORACICA", name: "Hérnia Discal Torácica", es: "Hernia discal torácica", region: "coluna_toracica" },
  { code: "OA_COLUNA_LOMBAR", name: "Osteoartrose Lombar", es: "Osteoartritis lumbar", region: "coluna_lombar" },
  { code: "HERNIA_DISCAL_LOMBAR", name: "Hérnia Discal Lombar", es: "Hernia discal lumbar", region: "coluna_lombar" },
  // ── Outras ────────────────────────────────────────────────────────────────
  { code: "CONDRAL_FOCAL", name: "Lesão Condral Focal", es: "Lesión condral focal", region: "outras" },
  { code: "OSTEOCONDRAL", name: "Lesão Osteocondral", es: "Lesión osteocondral", region: "outras" },
  { code: "TENDINOPATIA", name: "Tendinopatia", es: "Tendinopatía", region: "outras" },
  { code: "SINOVITE", name: "Sinovite / Sinovite Vilonodular", es: "Sinovitis / sinovitis villonodular", region: "outras" },
  { code: "BURSITE", name: "Bursite", es: "Bursitis", region: "outras" },
  { code: "FRATURA_FADIGA", name: "Fratura por Fadiga / Estresse", es: "Fractura por fatiga / estrés", region: "outras" },
  { code: "POS_OPERATORIO", name: "Pós-Operatório / Bioestimulação", es: "Posoperatorio / bioestimulación", region: "outras" },
  { code: "CUSTOM", name: "Outra Condição (especificar)", es: "Otra condición (especificar)", region: "outras" },
];

/**
 * Codes accepted for display and validation but no longer offered for new
 * cases (earlier catalogs and imported research data).
 */
export const LEGACY_REGEN_CONDITIONS: Readonly<Record<string, { name: string; es: string }>> = {
  OA_JOELHO: { name: "Osteoartrite de Joelho", es: "Osteoartritis de rodilla" },
  REPARO_MENISCAL: { name: "Reparo Meniscal / Pós-Sutura Meniscal", es: "Reparación meniscal / posutura meniscal" },
  LESAO_LIGAMENTAR: { name: "Lesão Ligamentar (Pós-LCA, etc.)", es: "Lesión ligamentaria (pos-LCA, etc.)" },
  knee_oa: { name: "Osteoartrose de Joelho", es: "Osteoartritis de rodilla" },
  hip_oa: { name: "Osteoartrose de Quadril", es: "Osteoartritis de cadera" },
  shoulder_oa: { name: "Osteoartrose de Ombro", es: "Osteoartritis de hombro" },
  ankle_oa: { name: "Osteoartrose de Tornozelo", es: "Osteoartritis de tobillo" },
  tendinopathy: { name: "Tendinopatia", es: "Tendinopatía" },
  chondral: { name: "Lesão Condral", es: "Lesión condral" },
  other: { name: "Outro", es: "Otra condición" },
};

const BY_CODE = new Map(REGEN_CONDITION_CATALOG.map((condition) => [condition.code, condition]));

export function isKnownRegenConditionCode(code: unknown): code is string {
  return typeof code === "string" && (BY_CODE.has(code) || Object.hasOwn(LEGACY_REGEN_CONDITIONS, code));
}

export function regenConditionName(code: string, locale: "pt-BR" | "es"): string {
  const entry = BY_CODE.get(code) ?? LEGACY_REGEN_CONDITIONS[code];
  if (!entry) return code;
  return locale === "es" ? entry.es : entry.name;
}

export function kellgrenLawrenceGrade(code: string | null | undefined): 1 | 2 | 3 | 4 | null {
  return (code && BY_CODE.get(code)?.kellgrenLawrence) || null;
}

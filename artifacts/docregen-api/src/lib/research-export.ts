/**
 * De-identification of the research export (Module 12).
 *
 * - The case UUID is replaced by a random pseudonym generated per export
 *   (two exports of the same case cannot be linked);
 * - dates are reduced to month/year (case_month, clinic calendar);
 * - age → 5-year bands, BMI → 5-unit integer bands;
 * - only coded values are exported (condition code, catalog labels of the
 *   anatomical sites, product-independent scores); free text never is;
 * - small groups: rows whose demographic group (age band × sex × BMI band)
 *   has fewer than RESEARCH_MIN_GROUP_SIZE cases in the export — or any row
 *   when the whole export is that small — lose their descriptive text
 *   column (anatomical_sites) and the response carries a warning (k < 5).
 * Baseline / last / change per scale are kept so the export stays useful.
 */
import { randomBytes } from "node:crypto";

export const RESEARCH_MIN_GROUP_SIZE = 5;

export const RESEARCH_EXPORT_COLUMNS = [
  "pseudo_id", "age_band", "sex", "bmi_band", "condition", "sane_region", "anatomical_sites", "status",
  "procedure_count", "adverse_events", "avg_vas", "dm", "case_month",
] as const;

export interface ResearchSourceRow {
  age: number | null;
  sex: string | null;
  imc: number | null;
  condition: string;
  sane_region: string | null;
  anatomical_sites: string | null;
  status: string | null;
  procedure_count: number;
  adverse_events: number;
  avg_vas: number | null;
  dm: boolean;
  case_month: string | null;
  measures: Record<string, number | null>;
}

export type ResearchRow = {
  pseudo_id: string;
  age_band: string | null;
  sex: string | null;
  bmi_band: string | null;
  condition: string;
  sane_region: string | null;
  anatomical_sites: string | null;
  status: string | null;
  procedure_count: number;
  adverse_events: number;
  avg_vas: number | null;
  dm: boolean;
  case_month: string | null;
  small_group: boolean;
} & Record<string, unknown>;

export function ageBand(age: number | null | undefined): string | null {
  if (age === null || age === undefined || !Number.isFinite(age) || age < 0) return null;
  if (age >= 90) return "90+";
  const low = Math.floor(age / 5) * 5;
  return `${low}-${low + 4}`;
}

export function bmiBand(bmi: number | null | undefined): string | null {
  if (bmi === null || bmi === undefined || !Number.isFinite(bmi) || bmi <= 0) return null;
  if (bmi < 15) return "<15";
  if (bmi >= 45) return "45+";
  const low = Math.floor(bmi / 5) * 5;
  return `${low}-${low + 4}`;
}

function pseudonym(used: Set<string>): string {
  for (;;) {
    const candidate = `R-${randomBytes(4).toString("hex")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function groupKey(row: { age_band: string | null; sex: string | null; bmi_band: string | null }): string {
  return `${row.age_band ?? "?"}|${row.sex ?? "?"}|${row.bmi_band ?? "?"}`;
}

export function buildResearchRows(source: readonly ResearchSourceRow[]): ResearchRow[] {
  const used = new Set<string>();
  const banded = source.map((row) => ({
    row,
    age_band: ageBand(row.age),
    bmi_band: bmiBand(row.imc),
    sex: row.sex === "M" || row.sex === "F" ? row.sex : null,
  }));
  const groupSizes = new Map<string, number>();
  for (const item of banded) groupSizes.set(groupKey(item), (groupSizes.get(groupKey(item)) ?? 0) + 1);
  const tooSmallOverall = source.length < RESEARCH_MIN_GROUP_SIZE;

  const rows: ResearchRow[] = banded.map(({ row, age_band, bmi_band, sex }) => {
    const small = tooSmallOverall || (groupSizes.get(groupKey({ age_band, sex, bmi_band })) ?? 0) < RESEARCH_MIN_GROUP_SIZE;
    return {
      pseudo_id: pseudonym(used),
      age_band,
      sex,
      bmi_band,
      condition: row.condition,
      sane_region: row.sane_region,
      anatomical_sites: small ? null : row.anatomical_sites,
      status: row.status,
      procedure_count: row.procedure_count,
      adverse_events: row.adverse_events,
      avg_vas: row.avg_vas,
      dm: row.dm,
      case_month: row.case_month,
      small_group: small,
      ...row.measures,
    };
  });
  // Order carries no information about creation sequence within a month.
  return rows.sort((a, b) =>
    (b.case_month ?? "").localeCompare(a.case_month ?? "") || a.pseudo_id.localeCompare(b.pseudo_id));
}

export interface ResearchPrivacySummary {
  total: number;
  pseudonymized: true;
  minGroupSize: number;
  smallGroupWarning: boolean;
  smallGroups: Array<{ age_band: string | null; sex: string | null; bmi_band: string | null; count: number }>;
  warning: string | null;
}

export function researchPrivacySummary(rows: readonly ResearchRow[]): ResearchPrivacySummary {
  const groups = new Map<string, { age_band: string | null; sex: string | null; bmi_band: string | null; count: number }>();
  for (const row of rows) {
    const key = groupKey(row);
    const group = groups.get(key) ?? { age_band: row.age_band, sex: row.sex, bmi_band: row.bmi_band, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const smallGroups = [...groups.values()].filter((group) => group.count < RESEARCH_MIN_GROUP_SIZE);
  const smallGroupWarning = rows.length > 0 && (rows.length < RESEARCH_MIN_GROUP_SIZE || smallGroups.length > 0);
  return {
    total: rows.length,
    pseudonymized: true,
    minGroupSize: RESEARCH_MIN_GROUP_SIZE,
    smallGroupWarning,
    smallGroups,
    warning: smallGroupWarning
      ? `Há grupos com menos de ${RESEARCH_MIN_GROUP_SIZE} casos (k<${RESEARCH_MIN_GROUP_SIZE}) com os filtros atuais: risco de reidentificação. Campos descritivos foram suprimidos nesses grupos; não divulgue o arquivo fora da equipe de pesquisa.`
      : null,
  };
}

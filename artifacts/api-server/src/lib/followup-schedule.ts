export interface ScheduleEntry {
  periodo: string;
  daysAfterSurgery: number;
  scales: string[];
  notes?: string;
  critical?: boolean;
}

export const PREOPERATIVE_PERIOD = "Pré-operatório";

/** Fraturas (ombro ou cotovelo) não têm avaliação pré-operatória. */
export function hasFractureProcedure(tiposProcedimento?: readonly string[] | null): boolean {
  return tiposProcedimento?.some((tipo) => tipo.endsWith("_FRACTURE")) ?? false;
}

export function isPreoperativePeriod(periodo: string): boolean {
  const normalized = periodo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return /^pre(?:-|\s)?op(?:eratorio)?(?:\b|\s|\()/.test(normalized);
}

export function isHiddenFracturePreoperative(
  tiposProcedimento: readonly string[] | null | undefined,
  periodo: string | null | undefined,
): boolean {
  return hasFractureProcedure(tiposProcedimento)
    && Boolean(periodo)
    && isPreoperativePeriod(periodo!);
}

/**
 * Cronograma de seguimento de ombro e cotovelo. Os momentos são os do cronograma
 * genérico herdado. Em todos os tipos de caso o paciente responde a dor (VAS) e
 * o SANE (0–100, % do normal). Só entram escalas de uso livre (sem licença).
 */
export const FOLLOWUP_SCHEDULE: ScheduleEntry[] = [
  { periodo: PREOPERATIVE_PERIOD, daysAfterSurgery: 0,   scales: ["VAS Dor", "SANE"], notes: "Avaliação baseline pré-operatório" },
  { periodo: "6 semanas",         daysAfterSurgery: 42,  scales: ["VAS Dor", "SANE"], notes: "Controle pós-operatório precoce" },
  { periodo: "3 meses",           daysAfterSurgery: 90,  scales: ["VAS Dor", "SANE"], notes: "Avaliação funcional intermediária" },
  { periodo: "6 meses",           daysAfterSurgery: 180, scales: ["VAS Dor", "SANE"], notes: "Avaliação de retorno às atividades" },
  { periodo: "1 ano",             daysAfterSurgery: 365, scales: ["VAS Dor", "SANE"], notes: "Resultado de longo prazo" },
];

/**
 * Escalas que o sistema ainda aplica, derivadas do próprio cronograma.
 * Linhas antigas de scheduled_notifications / followup podem listar escalas do
 * joelho (Lysholm, IKDC…) que foram retiradas; elas não devem ser exibidas nem
 * solicitadas ao paciente. Os dados do banco não são alterados.
 */
export const SUPPORTED_FOLLOWUP_SCALES: ReadonlySet<string> = new Set(
  FOLLOWUP_SCHEDULE.flatMap((entry) => entry.scales),
);

export function isSupportedFollowupScale(scale: string): boolean {
  return SUPPORTED_FOLLOWUP_SCALES.has(scale);
}

export function filterSupportedFollowupScales(scales: readonly string[] | null | undefined): string[] {
  return [...new Set((scales ?? []).filter(isSupportedFollowupScale))];
}

export type FollowupRegion = "shoulder" | "elbow";

/**
 * Região da cirurgia para o texto do paciente ("ombro"/"cotovelo").
 * Usa surgeries.regiao; em registros antigos sem região, deduz pelo tipo de
 * caso (SH_* = ombro, EL_* = cotovelo) quando todos apontam para a mesma região.
 */
export function resolveFollowupRegion(
  regiao: string | null | undefined,
  tiposProcedimento?: readonly string[] | null,
): FollowupRegion | null {
  if (regiao === "shoulder" || regiao === "elbow") return regiao;
  const regions = new Set(
    (tiposProcedimento ?? []).map((tipo) =>
      tipo.startsWith("SH_") ? "shoulder" : tipo.startsWith("EL_") ? "elbow" : null,
    ),
  );
  if (regions.size !== 1) return null;
  const [only] = [...regions];
  return only ?? null;
}

export function computeScheduledDate(dataCirurgia: string | null | undefined, daysAfterSurgery: number): string | null {
  if (!dataCirurgia) return null;
  const base = new Date(dataCirurgia);
  if (isNaN(base.getTime())) return null;
  const target = new Date(base);
  target.setDate(target.getDate() + daysAfterSurgery);
  return target.toISOString().slice(0, 10);
}

export function buildNotificationsForSurgery(
  surgeryId: number,
  patientId: number,
  dataCirurgia: string | null | undefined,
  tiposProcedimento?: string[]
): { surgeryId: number; patientId: number; periodo: string; daysAfterSurgery: number; scheduledDate: string | null; scales: string[]; notes: string | null; status: string }[] {
  const isFractureSurgery = hasFractureProcedure(tiposProcedimento);
  return FOLLOWUP_SCHEDULE
    .filter((entry) => !(isFractureSurgery && isPreoperativePeriod(entry.periodo)))
    .map((entry) => ({
      surgeryId,
      patientId,
      periodo: entry.periodo,
      daysAfterSurgery: entry.daysAfterSurgery,
      scheduledDate: computeScheduledDate(dataCirurgia, entry.daysAfterSurgery),
      scales: entry.scales,
      notes: entry.notes ?? null,
      status: "pending",
    }));
}

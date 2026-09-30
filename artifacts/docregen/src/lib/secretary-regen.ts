/**
 * Shapes and pure helpers for the DocRegen secretary portal's regenerative
 * tabs (read-only case list and pending follow-up alerts).
 */

/** Appointment type persisted for regenerative procedure sessions. */
export const REGEN_SESSION_TYPE = "procedimento regenerativo";

/** GET /regen-api/secretary/regen-cases */
export type SecretaryRegenCase = {
  id: string;
  patientId: number | null;
  patientNome: string | null;
  patientTelefone: string | null;
  status: string | null;
  dataCaso: string | null;
  createdAt: string | null;
  procedureCount: number;
  lastProcedureAt: string | null;
  nextFollowupDate: string | null;
  nextSessionDate: string | null;
  nextSessionTime: string | null;
};

/** GET /regen-api/secretary/followup-alerts?type=regen */
export type SecretaryRegenAlert = {
  id: string;
  caseId: string;
  patientId: number | null;
  patientNome: string | null;
  patientTelefone: string | null;
  periodo: string;
  scheduledDate: string | null;
  status: string;
  kind: "overdue" | "awaiting" | "scheduled";
};

/** Whole days from `today` to `date` (both YYYY-MM-DD); null when unknown. */
export function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  const [y1, m1, d1] = date.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => !Number.isFinite(n))) return null;
  return Math.round((Date.UTC(y1!, m1! - 1, d1!) - Date.UTC(y2!, m2! - 1, d2!)) / 86_400_000);
}

/** Alerts that need attention now: overdue, awaiting a reply, or due within `windowDays`. */
export function urgentRegenAlerts(alerts: readonly SecretaryRegenAlert[], today: string, windowDays = 7) {
  return alerts.filter((alert) => {
    if (alert.kind !== "scheduled") return true;
    const days = daysUntil(alert.scheduledDate, today);
    return days !== null && days <= windowDays;
  });
}

import type { Locale } from "@/lib/i18n";

/**
 * Pure helpers behind the DocRegen home dashboard. Kept free of React so the
 * regenerative/pain metrics can be unit-tested in isolation.
 */

export type DashboardAppointment = {
  id: number;
  patientId: number;
  data: string;
  hora: string;
  tipo: string;
  observacoes: string | null;
  status: string;
  patientNome: string | null;
  patientTelefone: string | null;
};

export type PreConsultDashboardRow = {
  patientId: number;
  patientNome: string;
  /** Invite expiry (awaiting) or submission date (answered). */
  date: string | null;
};

type AppointmentDayLabels = { today: string; tomorrow: string };

export function formatAppointmentDay(
  date: string,
  locale: Locale,
  labels: AppointmentDayLabels,
  referenceDate = new Date(),
) {
  const [year, month, day] = date.split("-").map(Number);
  const appointmentDate = new Date(year, month - 1, day);
  const referenceDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const tomorrow = new Date(referenceDay);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (appointmentDate.getTime() === referenceDay.getTime()) return labels.today;
  if (appointmentDate.getTime() === tomorrow.getTime()) return labels.tomorrow;

  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(appointmentDate);
}

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Non-cancelled appointments from `today` on, in chronological order. */
export function upcomingAppointments(appointments: readonly DashboardAppointment[], today: string) {
  return appointments
    .filter(a => a.data >= today && a.status !== "cancelado")
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

/** How many upcoming appointments fall within the next `days` days (today included). */
export function countAppointmentsWithin(appointments: readonly DashboardAppointment[], today: string, days = 7) {
  const limit = addDays(today, days - 1);
  return upcomingAppointments(appointments, today).filter(a => a.data <= limit).length;
}

/** Response of GET /api/pre-consults/summary (exact, doctor-wide). */
export type PreConsultSummary = {
  counts: { awaiting: number; answered: number };
  /** Soonest invite expiry first. */
  awaiting: PreConsultDashboardRow[];
  /** Most recent submission first. */
  answered: PreConsultDashboardRow[];
};

export const EMPTY_PRE_CONSULT_SUMMARY: PreConsultSummary = {
  counts: { awaiting: 0, answered: 0 },
  awaiting: [],
  answered: [],
};

/** Non-empty dashboard groups; `total` is the exact count, `rows` a short preview. */
export function preConsultGroups(summary: PreConsultSummary) {
  return (["awaiting", "answered"] as const)
    .map(key => ({ key, total: summary.counts[key], rows: summary[key] }))
    .filter(group => group.total > 0);
}

/** Human label for a regenerative condition code (e.g. "knee_oa" → "knee oa"). */
export function conditionCodeLabel(code: string | null | undefined): string {
  return code ? code.replace(/_/g, " ") : "";
}

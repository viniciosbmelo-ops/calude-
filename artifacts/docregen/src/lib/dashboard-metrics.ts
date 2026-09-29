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

export type DashboardPatient = { id: number; nome: string; createdAt?: string | null };

export type PreConsultSnapshot = {
  invite: { status: "active" | "revoked" | "submitted" | "expired"; expiresAt: string; createdAt: string } | null;
  questionnaire: { status: "draft" | "submitted"; submittedAt: string | null } | null;
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

/**
 * There is no aggregate pre-consultation endpoint, so the dashboard checks a
 * bounded set of patients: those with upcoming appointments first (the ones
 * a pre-consultation matters for), then the most recently registered.
 */
export function pickPreConsultCandidates(
  patients: readonly DashboardPatient[],
  appointments: readonly DashboardAppointment[],
  today: string,
  limit = 30,
): DashboardPatient[] {
  const byId = new Map(patients.map(p => [p.id, p]));
  const picked: DashboardPatient[] = [];
  const seen = new Set<number>();
  const push = (p: DashboardPatient | undefined) => {
    if (!p || seen.has(p.id) || picked.length >= limit) return;
    seen.add(p.id);
    picked.push(p);
  };
  for (const a of upcomingAppointments(appointments, today)) push(byId.get(a.patientId));
  const recent = [...patients].sort((a, b) => {
    const ca = a.createdAt ?? "";
    const cb = b.createdAt ?? "";
    if (ca !== cb) return cb.localeCompare(ca);
    return b.id - a.id;
  });
  for (const p of recent) push(p);
  return picked;
}

/** Splits pre-consultation snapshots into "awaiting patient" and "answered". */
export function summarizePreConsults(
  entries: ReadonlyArray<{ patient: DashboardPatient; snapshot: PreConsultSnapshot | undefined }>,
) {
  const awaiting: PreConsultDashboardRow[] = [];
  const answered: PreConsultDashboardRow[] = [];
  for (const { patient, snapshot } of entries) {
    if (!snapshot) continue;
    const { invite, questionnaire } = snapshot;
    if (questionnaire?.status === "submitted") {
      answered.push({ patientId: patient.id, patientNome: patient.nome, date: questionnaire.submittedAt });
    } else if (invite?.status === "active") {
      awaiting.push({ patientId: patient.id, patientNome: patient.nome, date: invite.expiresAt });
    }
  }
  answered.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  awaiting.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return { awaiting, answered };
}

/** Human label for a regenerative condition code (e.g. "knee_oa" → "knee oa"). */
export function conditionCodeLabel(code: string | null | undefined): string {
  return code ? code.replace(/_/g, " ") : "";
}

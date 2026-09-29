import { describe, expect, it } from "vitest";
import {
  countAppointmentsWithin,
  formatAppointmentDay,
  pickPreConsultCandidates,
  summarizePreConsults,
  upcomingAppointments,
  type DashboardAppointment,
} from "./dashboard-metrics";

function appt(partial: Partial<DashboardAppointment> & Pick<DashboardAppointment, "id" | "patientId" | "data">): DashboardAppointment {
  return {
    hora: "09:00", tipo: "consulta", observacoes: null, status: "agendado",
    patientNome: null, patientTelefone: null, ...partial,
  };
}

describe("dashboard appointment day labels", () => {
  const labels = { today: "Hoy", tomorrow: "Mañana" };
  const referenceDate = new Date(2025, 0, 14);

  it("uses Spanish temporal labels and localized weekday dates", () => {
    expect(formatAppointmentDay("2025-01-14", "es", labels, referenceDate)).toBe("Hoy");
    expect(formatAppointmentDay("2025-01-15", "es", labels, referenceDate)).toBe("Mañana");
    expect(formatAppointmentDay("2025-01-16", "es", labels, referenceDate)).toBe("jueves, 16 de enero");
  });
});

describe("dashboard upcoming appointments", () => {
  const list = [
    appt({ id: 1, patientId: 1, data: "2025-01-13" }),
    appt({ id: 2, patientId: 2, data: "2025-01-16", hora: "10:00" }),
    appt({ id: 3, patientId: 3, data: "2025-01-14", hora: "15:00" }),
    appt({ id: 4, patientId: 4, data: "2025-01-14", hora: "08:00", status: "cancelado" }),
    appt({ id: 5, patientId: 5, data: "2025-01-25" }),
  ];

  it("drops past and cancelled appointments and sorts chronologically", () => {
    expect(upcomingAppointments(list, "2025-01-14").map(a => a.id)).toEqual([3, 2, 5]);
  });

  it("counts only the appointments inside the window", () => {
    expect(countAppointmentsWithin(list, "2025-01-14", 7)).toBe(2);
    expect(countAppointmentsWithin(list, "2025-01-14", 30)).toBe(3);
  });
});

describe("dashboard pre-consultation summary", () => {
  it("checks patients with upcoming appointments before recent registrations, without duplicates", () => {
    const patients = [
      { id: 1, nome: "A", createdAt: "2025-01-01T00:00:00Z" },
      { id: 2, nome: "B", createdAt: "2025-01-10T00:00:00Z" },
      { id: 3, nome: "C", createdAt: "2025-01-05T00:00:00Z" },
    ];
    const appointments = [appt({ id: 9, patientId: 1, data: "2025-01-20" })];
    expect(pickPreConsultCandidates(patients, appointments, "2025-01-14").map(p => p.id)).toEqual([1, 2, 3]);
    expect(pickPreConsultCandidates(patients, appointments, "2025-01-14", 2).map(p => p.id)).toEqual([1, 2]);
  });

  it("separates invites awaiting the patient from answered questionnaires", () => {
    const summary = summarizePreConsults([
      { patient: { id: 1, nome: "Ana" }, snapshot: { invite: { status: "active", expiresAt: "2025-01-20", createdAt: "2025-01-13" }, questionnaire: { status: "draft", submittedAt: null } } },
      { patient: { id: 2, nome: "Bia" }, snapshot: { invite: { status: "submitted", expiresAt: "2025-01-20", createdAt: "2025-01-10" }, questionnaire: { status: "submitted", submittedAt: "2025-01-12T10:00:00Z" } } },
      { patient: { id: 3, nome: "Caio" }, snapshot: { invite: { status: "expired", expiresAt: "2025-01-01", createdAt: "2024-12-25" }, questionnaire: null } },
      { patient: { id: 4, nome: "Duda" }, snapshot: { invite: null, questionnaire: null } },
      { patient: { id: 5, nome: "Edu" }, snapshot: undefined },
    ]);
    expect(summary.awaiting.map(r => r.patientId)).toEqual([1]);
    expect(summary.answered.map(r => r.patientId)).toEqual([2]);
  });
});

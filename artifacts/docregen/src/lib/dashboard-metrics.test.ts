import { describe, expect, it } from "vitest";
import {
  countAppointmentsWithin,
  formatAppointmentDay,
  preConsultGroups,
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
  it("uses the exact totals and hides empty groups", () => {
    const groups = preConsultGroups({
      counts: { awaiting: 42, answered: 0 },
      awaiting: [{ patientId: 1, patientNome: "Ana", date: "2025-01-20T00:00:00Z" }],
      answered: [],
    });
    expect(groups).toEqual([
      { key: "awaiting", total: 42, rows: [{ patientId: 1, patientNome: "Ana", date: "2025-01-20T00:00:00Z" }] },
    ]);
  });

  it("keeps awaiting before answered", () => {
    const groups = preConsultGroups({
      counts: { awaiting: 1, answered: 3 },
      awaiting: [{ patientId: 1, patientNome: "Ana", date: null }],
      answered: [{ patientId: 2, patientNome: "Bia", date: "2025-01-12T10:00:00Z" }],
    });
    expect(groups.map(g => [g.key, g.total])).toEqual([["awaiting", 1], ["answered", 3]]);
  });
});

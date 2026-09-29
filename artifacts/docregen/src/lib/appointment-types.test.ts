import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_TYPES,
  LEGACY_SURGICAL_APPOINTMENT_TYPES,
  selectableAppointmentTypes,
} from "./appointment-types";

describe("DocRegen appointment types", () => {
  it("offers consultations and regenerative sessions, never surgical visits", () => {
    expect(APPOINTMENT_TYPES).toContain("consulta");
    expect(APPOINTMENT_TYPES).toContain("procedimento regenerativo");
    for (const legacy of LEGACY_SURGICAL_APPOINTMENT_TYPES) {
      expect(APPOINTMENT_TYPES as readonly string[]).not.toContain(legacy);
    }
    expect(APPOINTMENT_TYPES.join(" ")).not.toMatch(/pré-op|pós-op|curativo|cirurg/i);
  });

  it("keeps an existing legacy type selectable while editing", () => {
    expect(selectableAppointmentTypes()).toEqual([...APPOINTMENT_TYPES]);
    expect(selectableAppointmentTypes("consulta")).toEqual([...APPOINTMENT_TYPES]);
    expect(selectableAppointmentTypes("avaliação pré-op")).toEqual([...APPOINTMENT_TYPES, "avaliação pré-op"]);
  });
});

describe("shared appointment labels (agenda + secretary portal)", () => {
  it("labels persisted types and statuses instead of showing raw values", async () => {
    const { appointmentStatusLabel, appointmentTypeLabel } = await import("./appointment-types");
    expect(appointmentStatusLabel("agendado")).toBe("Agendado");
    expect(appointmentTypeLabel("retorno")).toBe("Retorno");
    expect(appointmentTypeLabel("procedimento regenerativo")).toBe("Procedimento regenerativo");
    expect(appointmentTypeLabel("retorno", "es")).toBe("Control");
    expect(appointmentStatusLabel("agendado", "es")).toBe("Agendada");
    expect(appointmentTypeLabel("desconhecido")).toBe("desconhecido");
    expect(appointmentStatusLabel(null)).toBe("");
  });
});

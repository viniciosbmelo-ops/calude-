import { describe, expect, it } from "vitest";
import { formatAppointmentDay } from "./dashboard";

describe("dashboard appointment day labels", () => {
  const labels = { today: "Hoy", tomorrow: "Mañana" };
  const referenceDate = new Date(2025, 0, 14);

  it("uses Spanish temporal labels and localized weekday dates", () => {
    expect(formatAppointmentDay("2025-01-14", "es", labels, referenceDate)).toBe("Hoy");
    expect(formatAppointmentDay("2025-01-15", "es", labels, referenceDate)).toBe("Mañana");
    expect(formatAppointmentDay("2025-01-16", "es", labels, referenceDate)).toBe("jueves, 16 de enero");
  });
});
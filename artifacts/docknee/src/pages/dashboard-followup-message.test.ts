import { describe, expect, it } from "vitest";
import { buildDashboardFollowupMessage } from "./dashboard";

describe("dashboard follow-up WhatsApp message", () => {
  it("uses Spanish editorial copy and presentation labels for controlled values", () => {
    const text = buildDashboardFollowupMessage(
      "es",
      "María López",
      "90d",
      ["Escala livre", "VAS Dor"],
      "Álvaro Ruiz",
    );

    expect(text).toContain("¡Hola, *María López*!");
    expect(text).toContain("Dr(a). Álvaro Ruiz");
    expect(text).toContain("*90 días*");
    expect(text).toContain("Escala livre, VAS Dolor");
    expect(text).not.toContain("VAS Dor,");
    expect(text).toContain("su CPF");
    expect(text).not.toContain("Olá");
    expect(text).not.toContain("avaliações");
  });
});
import { describe, expect, it } from "vitest";
import { daysUntil, urgentRegenAlerts, type SecretaryRegenAlert } from "./secretary-regen";

function alert(partial: Partial<SecretaryRegenAlert> & Pick<SecretaryRegenAlert, "id" | "kind">): SecretaryRegenAlert {
  return {
    caseId: "c", patientId: 1, patientNome: "Ana", patientTelefone: null,
    periodo: "1 mês", scheduledDate: null, status: "pending", ...partial,
  };
}

describe("secretary regenerative alerts", () => {
  it("counts whole days between date-only values", () => {
    expect(daysUntil("2025-01-20", "2025-01-14")).toBe(6);
    expect(daysUntil("2025-01-10", "2025-01-14")).toBe(-4);
    expect(daysUntil("2025-03-31", "2025-03-30")).toBe(1);
    expect(daysUntil(null, "2025-01-14")).toBeNull();
  });

  it("flags overdue, awaiting and soon-due follow-ups only", () => {
    const list = [
      alert({ id: "overdue", kind: "overdue", scheduledDate: "2025-01-01" }),
      alert({ id: "awaiting", kind: "awaiting", scheduledDate: "2025-01-02" }),
      alert({ id: "soon", kind: "scheduled", scheduledDate: "2025-01-20" }),
      alert({ id: "later", kind: "scheduled", scheduledDate: "2025-03-01" }),
      alert({ id: "undated", kind: "scheduled", scheduledDate: null }),
    ];
    expect(urgentRegenAlerts(list, "2025-01-14").map((a) => a.id)).toEqual(["overdue", "awaiting", "soon"]);
  });
});

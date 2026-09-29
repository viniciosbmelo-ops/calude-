import { describe, expect, it } from "vitest";
import { pendingApprovalMessages } from "@/pages/pending-approval";

describe("pending approval localization catalog", () => {
  it("keeps PT-BR and Spanish keys in parity", () => {
    expect(Object.keys(pendingApprovalMessages.es).sort()).toEqual(
      Object.keys(pendingApprovalMessages["pt-BR"]).sort(),
    );
  });

  it("provides Spanish status, CRM, access, and action copy", () => {
    expect(pendingApprovalMessages.es.title).toBe("Registro en revisión");
    expect(pendingApprovalMessages.es.verifyCrm).toContain("CRM");
    expect(pendingApprovalMessages.es.accessNotification).toContain("acceso");
    expect(pendingApprovalMessages.es.logout).toBe("Salir");
  });
});
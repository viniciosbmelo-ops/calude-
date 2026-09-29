import { describe, it, expect } from "vitest";
import type { Doctor } from "@workspace/docregen-db";
import { getRedactedFields, serializeDoctor } from "./doctorSerializer";

describe("Doctor response credential redaction", () => {
  it("removes every credential field from serialized doctor responses", () => {
    const doctor = {
      id: 1,
      nome: "Dra. Teste",
      senhaHash: "password-hash-must-not-leak",
      totpSecretEnc: "encrypted-totp-secret-must-not-leak",
      totpRecoveryCodesHash: "recovery-code-hashes-must-not-leak",
    } as Doctor;

    const safe = serializeDoctor(doctor);
    const serialized = JSON.stringify(safe);

    for (const field of getRedactedFields()) {
      expect(safe).not.toHaveProperty(field);
    }
    expect(serialized).not.toContain("password-hash-must-not-leak");
    expect(serialized).not.toContain("encrypted-totp-secret-must-not-leak");
    expect(serialized).not.toContain("recovery-code-hashes-must-not-leak");
  });
});

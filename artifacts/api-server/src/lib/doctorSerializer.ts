/**
 * Shared doctor serializer — strips ALL auth/credential fields before returning
 * a doctor record in any API response.
 *
 * Fields always omitted:
 *   - senhaHash        (bcrypt password hash)
 *   - totpSecretEnc    (AES-encrypted TOTP secret)
 *   - totpRecoveryCodesHash  (bcrypt-hashed recovery codes JSON)
 *
 * Adding any new credential/secret column to doctorsTable requires updating
 * this function and the regression test in admin-ops.test.ts.
 */
import type { Doctor } from "@workspace/db";

/** The credential fields that must NEVER appear in API responses. */
const REDACTED_FIELDS = ["senhaHash", "totpSecretEnc", "totpRecoveryCodesHash"] as const;
type RedactedField = (typeof REDACTED_FIELDS)[number];

export type SafeDoctor = Omit<Doctor, RedactedField>;

/**
 * Strips all auth/credential fields from a doctor record.
 * Use this in every route that serializes a doctor to JSON.
 */
export function serializeDoctor(doctor: Doctor): SafeDoctor {
  const {
    senhaHash: _s,
    totpSecretEnc: _t,
    totpRecoveryCodesHash: _r,
    ...safe
  } = doctor;
  return safe;
}

/**
 * Returns the set of field names that must be redacted.
 * Used by regression tests to verify no new credential fields slip through.
 */
export function getRedactedFields(): readonly string[] {
  return REDACTED_FIELDS;
}

/**
 * uploadGrants — PostgreSQL-backed registry of pre-authorised upload slots.
 *
 * Security properties:
 *  - Raw token is never stored; only SHA-256(hex) is persisted.
 *  - Consumption is atomic: UPDATE … WHERE token_hash = $1
 *    AND used_at IS NULL AND expires_at > now() RETURNING *
 *    Exactly one concurrent caller can win; subsequent calls get 0 rows.
 *  - TTL is enforced in the UPDATE predicate (server clock), not the caller.
 *  - All metadata (objectPath, fileName, mimeType, etc.) comes from the grant
 *    row — never from the consuming client request.
 */

import { createHash, randomBytes } from "crypto";
import { db, pool, uploadGrantsTable } from "@workspace/docregen-db";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { enqueueStorageCleanup, lockStoragePath } from "./storageCleanup";

export const UPLOAD_TOKEN_TTL_SECS = 15 * 60; // 15 minutes

export type GrantPurpose =
  | "patient_attachment"
  | "pre_consult_attachment";

export interface GrantInput {
  purpose: GrantPurpose;
  doctorId: number;
  patientId?: number;
  objectPath: string;
  fileName: string;
  mimeType: string;
  mediaType?: string;
  expectedSize?: number;
}

export interface GrantRecord {
  id: number;
  purpose: string;
  doctorId: number;
  patientId: number | null;
  objectPath: string;
  fileName: string;
  mimeType: string;
  mediaType: string | null;
  expectedSize: number | null;
  objectGeneration: string | null;
}

/** Hash a raw token — SHA-256 hex, used for storage and lookup. */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface GrantRow {
  id: number;
  purpose: string;
  doctor_id: number;
  patient_id: number | null;
  object_path: string;
  file_name: string;
  mime_type: string;
  media_type: string | null;
  expected_size: number | null;
  object_generation: string | null;
}

const GRANT_COLUMNS = `id, purpose, doctor_id, patient_id,
            object_path, file_name, mime_type, media_type, expected_size, object_generation`;

function grantFromRow(row: GrantRow): GrantRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    doctorId: row.doctor_id,
    patientId: row.patient_id,
    objectPath: row.object_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    mediaType: row.media_type,
    expectedSize: row.expected_size,
    objectGeneration: row.object_generation,
  };
}

/**
 * Reads an available grant without consuming it. Consumers must use this for
 * endpoint/ownership/context checks and object validation, then call
 * claimGrant in the same transaction that creates the owning clinical row.
 */
export async function findAvailableGrant(rawToken: string): Promise<GrantRecord | null> {
  const result = await pool.query<GrantRow>(
    `SELECT ${GRANT_COLUMNS}
       FROM upload_grants
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [hashToken(rawToken)],
  );
  return result.rows[0] ? grantFromRow(result.rows[0]) : null;
}

/**
 * Claims a grant inside the caller's clinical-row transaction. The update
 * predicate makes concurrent finalization single-winner, while rollback makes
 * the grant available again if the clinical insert does not commit.
 */
export async function claimGrant(
  tx: DbTransaction,
  rawToken: string,
  expectedGrantId: number,
  objectGeneration: string,
): Promise<boolean> {
  await lockStoragePath(tx, (await tx
    .select({ objectPath: uploadGrantsTable.objectPath })
    .from(uploadGrantsTable)
    .where(eq(uploadGrantsTable.id, expectedGrantId))
    .limit(1))[0]?.objectPath ?? "");
  const claimed = await tx
    .update(uploadGrantsTable)
    .set({ usedAt: new Date(), objectGeneration })
    .where(and(
      eq(uploadGrantsTable.id, expectedGrantId),
      eq(uploadGrantsTable.tokenHash, hashToken(rawToken)),
      isNull(uploadGrantsTable.usedAt),
      gt(uploadGrantsTable.expiresAt, new Date()),
      or(isNull(uploadGrantsTable.objectGeneration), eq(uploadGrantsTable.objectGeneration, objectGeneration)),
    ))
    .returning({ id: uploadGrantsTable.id });
  return claimed.length === 1;
}

/**
 * Permanently retires an uploaded-but-unlinked grant and records compensating
 * deletion durably. Cleanup re-checks clinical references before deletion.
 */
export async function abandonGrantAndEnqueueCleanup(
  rawToken: string,
  grant: GrantRecord,
  objectGeneration?: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockStoragePath(tx, grant.objectPath);
    await tx
      .update(uploadGrantsTable)
      .set({ usedAt: new Date(), objectGeneration: objectGeneration ?? grant.objectGeneration })
      .where(and(
        eq(uploadGrantsTable.id, grant.id),
        eq(uploadGrantsTable.tokenHash, hashToken(rawToken)),
        isNull(uploadGrantsTable.usedAt),
      ));
    await enqueueStorageCleanup(tx, [{
      objectPath: grant.objectPath,
      objectGeneration: objectGeneration ?? grant.objectGeneration,
    }]);
  });
}

/**
 * Create a grant row and return the raw (unhashed) token.
 * The raw token is returned to the caller once and never stored.
 */
export async function createGrant(input: GrantInput): Promise<string> {
  // 32 bytes = 256 bits of entropy — much more than a UUID
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_SECS * 1000);

  await pool.query(
    `INSERT INTO upload_grants
       (purpose, doctor_id, patient_id, object_path,
        file_name, mime_type, media_type, expected_size, token_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.purpose,
      input.doctorId,
      input.patientId ?? null,
      input.objectPath,
      input.fileName,
      input.mimeType,
      input.mediaType ?? null,
      input.expectedSize ?? null,
      tokenHash,
      expiresAt,
    ],
  );

  return rawToken;
}

/**
 * Atomically consume a grant token.
 *
 * Uses UPDATE … RETURNING so the read-and-mark is a single round-trip
 * with no TOCTOU race. Returns the grant record if valid, null otherwise.
 *
 * A token is invalid if:
 *  - it doesn't exist (unknown / already deleted)
 *  - it was already consumed (used_at IS NOT NULL)
 *  - it has expired (expires_at <= now())
 */
export async function consumeGrant(rawToken: string): Promise<GrantRecord | null> {
  const tokenHash = hashToken(rawToken);

  const result = await pool.query<GrantRow>(
    `UPDATE upload_grants
        SET used_at = now()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING
        ${GRANT_COLUMNS}`,
    [tokenHash],
  );

  if (result.rowCount === 0) return null;

  return grantFromRow(result.rows[0]!);
}

/**
 * Periodically purge fully-expired and consumed grants.
 * Safe to call from a background task; never called in the request path.
 */
export async function purgeExpiredGrants(): Promise<void> {
  const expired = await pool.query<{ id: number; object_path: string }>(
    `SELECT id, object_path
       FROM upload_grants
      WHERE expires_at < now() - interval '1 hour'
      ORDER BY id
      LIMIT 200`,
  );

  for (const grant of expired.rows) {
    await db.transaction(async (tx) => {
      await enqueueStorageCleanup(tx, [grant.object_path]);
      await tx.delete(uploadGrantsTable).where(eq(uploadGrantsTable.id, grant.id));
    });
  }
}

/**
 * Temporary PDFs shared through an unguessable URL (iOS "open / share" flow).
 *
 * Stored in PostgreSQL (temp_pdfs), not in process memory: every instance can
 * serve them (autoscale) and memory can no longer be exhausted. Bounded by
 *   - PDF_TEMP_MAX_BYTES            per file (default 20 MB)
 *   - PDF_TEMP_MAX_PER_DOCTOR       live files per doctor (default 10)
 *   - PDF_TEMP_MAX_BYTES_PER_DOCTOR live bytes per doctor (default 60 MB)
 *   - PDF_TEMP_MAX_TOTAL_BYTES      live bytes overall (default 512 MB) → 503
 *   - PDF_TEMP_TTL_SECONDS          lifetime (default 1800 s)
 * Expired rows are purged on every write and by the hourly maintenance job.
 */
import { randomBytes } from "crypto";
import { pool } from "@workspace/docregen-db";

function envNumber(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Exported so the route layer can enforce the same limit while streaming. */
export const MAX_PDF_BYTES = envNumber("PDF_TEMP_MAX_BYTES", 20 * 1024 * 1024);

export function tempPdfLimits() {
  return {
    ttlSeconds: envNumber("PDF_TEMP_TTL_SECONDS", 1800),
    maxBytes: MAX_PDF_BYTES,
    maxPerDoctor: envNumber("PDF_TEMP_MAX_PER_DOCTOR", 10),
    maxBytesPerDoctor: envNumber("PDF_TEMP_MAX_BYTES_PER_DOCTOR", 60 * 1024 * 1024),
    maxTotalBytes: envNumber("PDF_TEMP_MAX_TOTAL_BYTES", 512 * 1024 * 1024),
  };
}

/** PDF magic bytes: %PDF */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

/**
 * Sanitize a filename: alphanumerics, dash, underscore, dot and space only;
 * unsafe runs collapsed to "_", at most 128 chars, always ending in .pdf.
 */
function sanitizeFilename(raw: string): string {
  const base = raw
    .replace(/[^a-zA-Z0-9\-_. ]/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 128);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function hasPdfMagicBytes(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(PDF_MAGIC);
}

export interface StorePdfResult {
  id: string;
  error?: never;
}

export interface StorePdfError {
  id?: never;
  error: "too_large" | "store_full" | "invalid_pdf" | "doctor_quota";
}

export async function purgeExpiredPdfs(): Promise<number> {
  const result = await pool.query(`DELETE FROM temp_pdfs WHERE expires_at <= now()`);
  return result.rowCount ?? 0;
}

/**
 * Stores a PDF for `doctorId` and returns its 128-bit hex id, or a typed
 * error. Quota checks and the insert run in one transaction serialized per
 * doctor, so concurrent uploads cannot overshoot the per-doctor quota.
 */
export async function storePdf(
  doctorId: number,
  buffer: Buffer,
  rawFilename: string,
): Promise<StorePdfResult | StorePdfError> {
  if (!hasPdfMagicBytes(buffer)) return { error: "invalid_pdf" };
  const limits = tempPdfLimits();
  if (buffer.length > limits.maxBytes) return { error: "too_large" };

  await purgeExpiredPdfs();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(87005, $1)`, [doctorId]);
    const { rows: [mine] } = await client.query<{ count: number; bytes: number }>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes), 0)::float8 AS bytes
         FROM temp_pdfs WHERE doctor_id = $1 AND expires_at > now()`,
      [doctorId],
    );
    if (mine!.count >= limits.maxPerDoctor || mine!.bytes + buffer.length > limits.maxBytesPerDoctor) {
      await client.query("ROLLBACK");
      return { error: "doctor_quota" };
    }
    const { rows: [total] } = await client.query<{ bytes: number }>(
      `SELECT COALESCE(SUM(size_bytes), 0)::float8 AS bytes FROM temp_pdfs WHERE expires_at > now()`,
    );
    if (total!.bytes + buffer.length > limits.maxTotalBytes) {
      await client.query("ROLLBACK");
      return { error: "store_full" };
    }
    const id = randomBytes(16).toString("hex"); // 128-bit random — unguessable
    await client.query(
      `INSERT INTO temp_pdfs (id, doctor_id, filename, content, size_bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
      [id, doctorId, sanitizeFilename(rawFilename || "documento.pdf"), buffer, buffer.length, String(limits.ttlSeconds)],
    );
    await client.query("COMMIT");
    return { id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Retrieve a stored PDF by its hex key. Returns null if expired, unknown or malformed. */
export async function getPdf(id: string): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const { rows } = await pool.query<{ content: Buffer; filename: string }>(
    `SELECT content, filename FROM temp_pdfs WHERE id = $1 AND expires_at > now()`,
    [id],
  );
  if (!rows.length) return null;
  return { buffer: rows[0]!.content, filename: rows[0]!.filename };
}

/** Exposed for testing only */
export const _internals = { sanitizeFilename, hasPdfMagicBytes };

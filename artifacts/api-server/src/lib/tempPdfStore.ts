import { randomBytes } from "crypto";

interface TempPdf {
  buffer: Buffer;
  filename: string;
  expiresAt: number;
}

const store = new Map<string, TempPdf>();

/** TTL for stored PDFs (default 30 min, overridable via PDF_TEMP_TTL_SECONDS env). */
const TTL_MS = (Number(process.env["PDF_TEMP_TTL_SECONDS"] ?? 1800)) * 1000;

/**
 * Maximum number of entries that may be held in memory at any one time.
 * Once this limit is reached, the upload is rejected to prevent unbounded
 * memory growth. Adjust via PDF_TEMP_MAX_ENTRIES env var.
 */
const MAX_ENTRIES = Number(process.env["PDF_TEMP_MAX_ENTRIES"] ?? 200);

/**
 * Maximum size of a single PDF buffer in bytes.
 * Default 20 MB — large enough for medical reports; adjust via PDF_TEMP_MAX_BYTES.
 * Exported so the route layer can enforce the same limit during streaming,
 * before the full buffer is assembled.
 */
export const MAX_PDF_BYTES = Number(process.env["PDF_TEMP_MAX_BYTES"] ?? 20 * 1024 * 1024);

/** PDF magic bytes: %PDF */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

/** Remove expired entries. Called on every write to avoid memory leaks. */
function evict(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}

/**
 * Sanitize a filename:
 * - Allow only alphanumeric, dash, underscore, dot and space characters.
 * - Collapse sequences of unsafe chars into a single underscore.
 * - Truncate to 128 chars.
 * - Always end with .pdf.
 */
function sanitizeFilename(raw: string): string {
  const base = raw
    .replace(/[^a-zA-Z0-9\-_. ]/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 128);

  // Ensure the filename ends in .pdf (case-insensitive)
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

/**
 * Validate that the buffer starts with the PDF magic bytes (%PDF).
 */
function hasPdfMagicBytes(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(PDF_MAGIC);
}

export interface StorePdfResult {
  id: string;
  error?: never;
}

export interface StorePdfError {
  id?: never;
  error: "too_large" | "store_full" | "invalid_pdf";
}

/**
 * Store a PDF buffer temporarily and return a hex UUID key.
 * Returns an error descriptor instead of throwing so callers get explicit,
 * typed failure reasons.
 */
export function storePdf(buffer: Buffer, rawFilename: string): StorePdfResult | StorePdfError {
  if (!hasPdfMagicBytes(buffer)) {
    return { error: "invalid_pdf" };
  }

  if (buffer.length > MAX_PDF_BYTES) {
    return { error: "too_large" };
  }

  evict();

  if (store.size >= MAX_ENTRIES) {
    return { error: "store_full" };
  }

  const filename = sanitizeFilename(rawFilename || "documento.pdf");
  const id = randomBytes(16).toString("hex"); // 128-bit random — unguessable
  store.set(id, { buffer, filename, expiresAt: Date.now() + TTL_MS });
  return { id };
}

/** Retrieve a stored PDF by its hex key. Returns null if expired or not found. */
export function getPdf(id: string): { buffer: Buffer; filename: string } | null {
  // Reject obviously malformed IDs early (hex string of 32 chars)
  if (!/^[0-9a-f]{32}$/.test(id)) return null;

  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(id);
    return null;
  }
  return { buffer: entry.buffer, filename: entry.filename };
}

/** Exposed for testing only */
export const _internals = { MAX_ENTRIES, MAX_PDF_BYTES, TTL_MS, sanitizeFilename, hasPdfMagicBytes };
// Note: MAX_PDF_BYTES is also exported directly above so pdf.ts can use it for
// streaming enforcement without importing from _internals.

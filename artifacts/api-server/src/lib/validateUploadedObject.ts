/**
 * validateUploadedObject — verify the REAL GCS object metadata for an
 * uploaded file against the server-trusted grant values.
 *
 * Shared by /media/process, /storage/uploads/finalize and
 * /patients/:id/attachments so the same guarantees apply everywhere:
 *   - the object actually exists and is non-empty
 *   - its real size is within the per-MIME limit
 *   - its real size matches the expected size (when the grant declared one)
 *   - its real Content-Type matches the authorised MIME
 *     (or the generic application/octet-stream, which GCS uses when a
 *     client PUT omitted the header)
 *
 * All comparisons use GCS metadata — never client-supplied values.
 */

import { ObjectStorageService } from "./objectStorage";

/** Images and documents: 25 MB */
export const MAX_IMAGE_DOC_BYTES = 25 * 1024 * 1024;
/** Video: 250 MB */
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

export function maxBytesForMime(mime: string): number {
  return mime.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_DOC_BYTES;
}

export type ValidateResult =
  | { ok: true; size: number; generation: string }
  | { ok: false; status: number; error: string; generation?: string };

export interface ValidateInput {
  objectPath: string;
  mimeType: string;
  /** Exact size declared when the grant was issued, if any. */
  expectedSize?: number | null;
}

/**
 * Fetches the real GCS metadata for `objectPath` and validates it.
 * Returns { ok: true, size } on success, or { ok: false, status, error }
 * describing an HTTP response the caller should send.
 */
export async function validateUploadedObject(
  storageService: ObjectStorageService,
  input: ValidateInput,
): Promise<ValidateResult> {
  const { objectPath, mimeType, expectedSize } = input;

  let meta: { size?: string | number | null; contentType?: string | null; generation?: string | number | null };
  try {
    const file = await storageService.getObjectEntityFile(objectPath);
    [meta] = await file.getMetadata();
  } catch {
    // Object missing or unreadable — treat as an invalid upload.
    return { ok: false, status: 400, error: "Arquivo enviado não encontrado" };
  }

  const actualSize = Number(meta.size ?? 0);
  const generation = meta.generation == null ? undefined : String(meta.generation);
  const limit = maxBytesForMime(mimeType);

  if (!Number.isSafeInteger(actualSize) || actualSize <= 0 || actualSize > limit) {
    return { ok: false, status: 400, error: "Arquivo excede o tamanho máximo permitido", generation };
  }

  if (expectedSize !== null && expectedSize !== undefined && actualSize !== expectedSize) {
    return { ok: false, status: 400, error: "Tamanho do arquivo não corresponde ao upload autorizado", generation };
  }

  if (meta.contentType && typeof meta.contentType === "string") {
    const gcsMainType = meta.contentType.split(";")[0].trim();
    if (gcsMainType !== mimeType && gcsMainType !== "application/octet-stream") {
      return { ok: false, status: 400, error: "Tipo real do arquivo não corresponde ao upload autorizado", generation };
    }
  }

  if (!generation) {
    return { ok: false, status: 400, error: "Versão do arquivo enviado não encontrada" };
  }
  return { ok: true, size: actualSize, generation };
}

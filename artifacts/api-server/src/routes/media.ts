import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import {
  surgeryMediaTable,
  surgeriesTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { objectStorageClient, ObjectStorageService } from "../lib/objectStorage";
import { z } from "zod";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  abandonGrantAndEnqueueCleanup,
  claimGrant,
  createGrant,
  findAvailableGrant,
} from "../lib/uploadGrants";
import { validateUploadedObject } from "../lib/validateUploadedObject";
import {
  deleteStoredObject,
  enqueueStorageCleanup,
  lockStoragePath,
  processStorageCleanupJobs,
} from "../lib/storageCleanup";
import { localeForDoctorId } from "../lib/locale";
import { message, type MessageKey } from "../lib/locale-catalog";
import { localizedKnownMediaError } from "../lib/media-error-locale";

const router = Router();
const storageService = new ObjectStorageService();

async function mediaTranslator(req: Request) {
  const locale = await localeForDoctorId(req.doctorId);
  return {
    locale,
    t: (key: MessageKey, vars?: Record<string, string | number>) => message(locale, key, vars),
  };
}

// ─── Size limits ─────────────────────────────────────────────────────────────

/** Images and documents: 25 MB */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Video: 250 MB */
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

function maxBytesForMime(mime: string): number {
  return mime.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

// ─── MIME allowlist ───────────────────────────────────────────────────────────

/** Allowed MIME types and their canonical file extension. */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
  "video/mp2t": "ts",
};

/** Derive mediaType from a MIME string. */
function mimeToMediaType(mime: string): "photo" | "video" | null {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  return null;
}

// ─── Filename sanitization ────────────────────────────────────────────────────

/**
 * Strip to base filename (no directories), block path traversal, and
 * limit length. Returns sanitized filename or null if invalid.
 */
export function sanitizeFilename(name: string): string | null {
  // Reject obvious traversal attempts before any stripping
  if (/[/\\]/.test(name)) return null;
  const base = path.basename(name);
  if (!base || base === "." || base === ".." || base.length > 255) return null;
  // Allow only safe characters
  if (!/^[\w.\-\s()[\]{}@!+=#^~,']+$/.test(base)) return null;
  return base;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

function parseObjectPath(p: string): { bucketName: string; objectName: string } {
  const normalized = p.startsWith("/") ? p : `/${p}`;
  const parts = normalized.split("/").filter(Boolean);
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

function objectPathToGCS(objectPath: string): { bucketName: string; objectName: string } {
  const entityId = objectPath.replace(/^\/objects\//, "");
  let privateDir = storageService.getPrivateObjectDir();
  if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);
  const fullPath = `${privateDir}/${entityId}`;
  return parseObjectPath(fullPath);
}

/**
 * Download a GCS object to buffer, validating size against GCS metadata
 * (not client-supplied values) before actually downloading.
 */
async function downloadToBuffer(objectPath: string, maxBytes: number): Promise<Buffer> {
  const file = await storageService.getObjectEntityFile(objectPath);

  // Validate object size using GCS metadata — not client input
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (size > maxBytes) {
    throw new Error(`Object too large: ${size} bytes (limit ${maxBytes})`);
  }

  const [buf] = await file.download();
  return buf;
}

async function uploadPreviewBuffer(buf: Buffer, ext: string, contentType: string): Promise<string> {
  const id = `media/preview/${randomUUID()}.${ext}`;
  const previewObjectPath = `/objects/${id}`;
  const { bucketName, objectName } = objectPathToGCS(previewObjectPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buf, { contentType, resumable: false });
  return previewObjectPath;
}

async function deleteStoredPathDurably(objectPath: string): Promise<void> {
  try {
    await deleteStoredObject(objectPath);
  } catch (error) {
    await db.transaction(async (tx) => {
      await enqueueStorageCleanup(tx, [objectPath]);
    });
    logger.warn({ err: error, objectPath }, "Storage cleanup deferred to durable outbox");
  }
}

async function compressPhoto(originalPath: string): Promise<string> {
  const buf = await downloadToBuffer(originalPath, MAX_IMAGE_BYTES);
  const compressed = await sharp(buf)
    .rotate()
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  return uploadPreviewBuffer(compressed, "jpg", "image/jpeg");
}

async function compressVideo(originalPath: string, mimeType: string): Promise<string> {
  const inputBuf = await downloadToBuffer(originalPath, MAX_VIDEO_BYTES);

  // Use a fixed extension derived from the validated MIME type (no path traversal)
  const ext = ALLOWED_MIME_TYPES[mimeType] ?? "mp4";

  // Write to a secure temp directory using only UUIDs (no user input in path)
  const tmpIn = path.join(os.tmpdir(), `${randomUUID()}.${ext}`);
  const tmpOut = path.join(os.tmpdir(), `${randomUUID()}_preview.mp4`);

  fs.writeFileSync(tmpIn, inputBuf);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(tmpIn)
      .outputOptions([
        "-vf", "scale='min(854,iw)':-2",
        "-c:v", "libx264",
        "-crf", "32",
        "-preset", "fast",
        "-c:a", "aac",
        "-b:a", "64k",
        "-movflags", "+faststart",
      ])
      .format("mp4")
      .output(tmpOut)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });

  const previewBuf = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch { /* best-effort cleanup */ }

  return uploadPreviewBuffer(previewBuf, "mp4", "video/mp4");
}

const MAX_CONCURRENT_MEDIA_PROCESSING = 2;
const MAX_RESERVED_MEDIA_PROCESSING = 20;
let activeMediaProcessing = 0;
let reservedMediaProcessing = 0;
const mediaProcessingQueue: Array<() => void> = [];
const scheduledMediaIds = new Set<number>();

function reserveMediaProcessing(): boolean {
  if (reservedMediaProcessing >= MAX_RESERVED_MEDIA_PROCESSING) return false;
  reservedMediaProcessing += 1;
  return true;
}

function releaseMediaProcessingReservation(): void {
  reservedMediaProcessing = Math.max(0, reservedMediaProcessing - 1);
}

function scheduleMediaProcessing(work: () => Promise<void>): void {
  const run = () => {
    activeMediaProcessing += 1;
    void work()
      .catch((error) => {
        logger.error({ err: error }, "Unhandled media processing queue error");
      })
      .finally(() => {
        activeMediaProcessing -= 1;
        mediaProcessingQueue.shift()?.();
      });
  };
  if (activeMediaProcessing < MAX_CONCURRENT_MEDIA_PROCESSING) run();
  else mediaProcessingQueue.push(run);
}

function processMediaInBackground({
  id,
  mediaType,
  originalPath,
  mimeType,
}: {
  id: number;
  mediaType: "photo" | "video";
  originalPath: string;
  mimeType: string;
}, reservationHeld = false): boolean {
  if (scheduledMediaIds.has(id)) {
    if (reservationHeld) releaseMediaProcessingReservation();
    return true;
  }
  if (!reservationHeld && !reserveMediaProcessing()) return false;
  scheduledMediaIds.add(id);

  scheduleMediaProcessing(async () => {
    let generatedPreviewPath: string | null = null;
    try {
      generatedPreviewPath = mediaType === "photo"
        ? await compressPhoto(originalPath)
        : await compressVideo(originalPath, mimeType);
      let updated;
      try {
        updated = await db.update(surgeryMediaTable)
          .set({ previewPath: generatedPreviewPath, previewStatus: "ready" })
          .where(eq(surgeryMediaTable.id, id))
          .returning({ id: surgeryMediaTable.id });
      } catch (error) {
        await deleteStoredPathDurably(generatedPreviewPath);
        generatedPreviewPath = null;
        throw error;
      }
      if (updated.length === 0) {
        await deleteStoredPathDurably(generatedPreviewPath);
      }
      generatedPreviewPath = null;
    } catch (err) {
      logger.error({ err, mediaId: id }, "Media compression error");
      if (mediaType === "video") {
        // Fallback: use original path as preview so video still plays.
        await db.update(surgeryMediaTable)
          .set({ previewPath: originalPath, previewStatus: "ready" })
          .where(eq(surgeryMediaTable.id, id));
      } else {
        await db.update(surgeryMediaTable)
          .set({ previewStatus: "error" })
          .where(eq(surgeryMediaTable.id, id));
      }
    } finally {
      if (generatedPreviewPath) {
        await deleteStoredPathDurably(generatedPreviewPath);
      }
      scheduledMediaIds.delete(id);
      releaseMediaProcessingReservation();
    }
  });
  return true;
}

async function recoverPendingMediaProcessing(): Promise<void> {
  const capacity = MAX_RESERVED_MEDIA_PROCESSING - reservedMediaProcessing;
  if (capacity <= 0) return;
  const pending = await db
    .select({
      id: surgeryMediaTable.id,
      mediaType: surgeryMediaTable.mediaType,
      originalPath: surgeryMediaTable.originalPath,
      mimeType: surgeryMediaTable.mimeType,
    })
    .from(surgeryMediaTable)
    .where(eq(surgeryMediaTable.previewStatus, "pending"))
    .orderBy(surgeryMediaTable.createdAt)
    .limit(MAX_RESERVED_MEDIA_PROCESSING * 2);

  for (const item of pending) {
    if (scheduledMediaIds.has(item.id)) continue;
    if (!processMediaInBackground({
      id: item.id,
      mediaType: item.mediaType === "video" ? "video" : "photo",
      originalPath: item.originalPath,
      mimeType: item.mimeType,
    })) break;
  }
}

if (process.env.NODE_ENV !== "test") {
  const initialRecovery = setTimeout(() => {
    void recoverPendingMediaProcessing().catch((error) => {
      logger.error({ err: error }, "Initial pending media recovery failed");
    });
  }, 2_000);
  initialRecovery.unref();
  const recoveryInterval = setInterval(() => {
    void recoverPendingMediaProcessing().catch((error) => {
      logger.error({ err: error }, "Pending media recovery failed");
    });
  }, 15_000);
  recoveryInterval.unref();
}

// ─── Request Upload URL ───────────────────────────────────────────────────────

const RequestUploadUrlBody = z.object({
  surgeryId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  contentType: z.string().min(1).max(100).optional(),
  // Compatibility aliases for clients that still have an older PWA bundle cached.
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).max(100).optional(),
  size: z.number().int().positive().optional(),
}).transform((body, ctx) => {
  const name = body.name ?? body.fileName;
  const contentType = body.contentType ?? body.mimeType;
  if (!name || !contentType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Missing upload metadata" });
    return z.NEVER;
  }
  return {
    surgeryId: body.surgeryId,
    name,
    contentType,
    size: body.size,
  };
});

/**
 * POST /media/request-upload-url
 *
 * Authenticated. Requires doctorId + surgeryId ownership check.
 * Validates filename, MIME type, and size before issuing a grant.
 * Returns a signed PUT URL + a single-use opaque token (backed by PostgreSQL).
 * Client metadata is validated here and stored in the grant — /media/process
 * will use grant values, not client-supplied ones.
 */
router.post("/media/request-upload-url", requireAuth, async (req: Request, res: Response) => {
  const { t } = await mediaTranslator(req);
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("mediaUploadFieldsRequired") });
    return;
  }

  const { surgeryId, name, contentType, size } = parsed.data;

  // Validate MIME type against allowlist
  if (!ALLOWED_MIME_TYPES[contentType]) {
    res.status(400).json({ error: t("mediaFileTypeNotAllowed") });
    return;
  }

  // Validate filename
  const safeFilename = sanitizeFilename(name);
  if (!safeFilename) {
    res.status(400).json({ error: t("mediaInvalidFilename") });
    return;
  }

  // Validate declared size against per-MIME limit
  const limit = maxBytesForMime(contentType);
  if (size !== undefined && size > limit) {
    const limitMB = Math.round(limit / 1024 / 1024);
    res.status(400).json({ error: t("mediaFileTooLarge", { limitMB }) });
    return;
  }

  // Derive mediaType from MIME — not from client
  const mediaType = mimeToMediaType(contentType);
  if (!mediaType) {
    res.status(400).json({ error: t("mediaUnsupportedType") });
    return;
  }

  // Verify surgery ownership (admin can skip)
  if (!req.isAdmin) {
    const [surgery] = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
      .limit(1);
    if (!surgery) {
      res.status(404).json({ error: t("surgeryNotFound") });
      return;
    }
  }

  try {
    const uploadURL = await storageService.getObjectEntityUploadURL();
    const objectPath = storageService.normalizeObjectEntityPath(uploadURL);

    // All metadata validated above is stored in the grant row.
    // /media/process will use these server-side values.
    const rawToken = await createGrant({
      purpose: "surgery_media",
      doctorId: req.doctorId!,
      surgeryId,
      objectPath,
      fileName: safeFilename,
      mimeType: contentType,
      mediaType,
      expectedSize: size,
    });

    res.json({
      uploadURL,
      uploadUrl: uploadURL,
      objectPath,
      token: rawToken,
      uploadToken: rawToken,
    });
  } catch (err) {
    logger.error({ err }, "Error generating upload URL");
    res.status(500).json({ error: t("mediaUploadUrlFailed") });
  }
});

// ─── Process ──────────────────────────────────────────────────────────────────

const processBodySchema = z.object({
  token: z.string().min(1).max(200),
});

/**
 * POST /media/process
 *
 * Authenticated. Accepts only uploads pre-authorised via /media/request-upload-url.
 * The token is atomically consumed from PostgreSQL (single-use, TTL enforced).
 * ALL metadata (objectPath, fileName, mimeType, mediaType) comes from the grant
 * row — never from the client request body.
 */
router.post("/media/process", requireAuth, async (req: Request, res: Response) => {
  const { locale, t } = await mediaTranslator(req);
  const parsed = processBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("mediaTokenRequired") });
    return;
  }

  // Read without consuming: all endpoint, ownership, and context checks must
  // complete before the clinical commit atomically claims the grant.
  const grant = await findAvailableGrant(parsed.data.token);
  if (!grant) {
    res.status(403).json({ error: t("mediaInvalidUploadToken") });
    return;
  }

  // Only surgery_media grants are valid here
  if (grant.purpose !== "surgery_media") {
    res.status(403).json({ error: t("mediaInvalidEndpointToken") });
    return;
  }
  if (
    grant.surgeryId === null ||
    (grant.mediaType !== "photo" && grant.mediaType !== "video") ||
    !ALLOWED_MIME_TYPES[grant.mimeType]
  ) {
    res.status(403).json({ error: t("mediaInvalidEndpointToken") });
    return;
  }

  // Enforce that the requesting doctor is the one who obtained the token
  if (!req.isAdmin && grant.doctorId !== req.doctorId) {
    res.status(403).json({ error: t("accessDenied") });
    return;
  }

  // Validate surgery still owned by this doctor (defence in depth; grant already binds it)
  if (!req.isAdmin) {
    const [surgery] = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(and(eq(surgeriesTable.id, grant.surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
      .limit(1);
    if (!surgery) {
      res.status(403).json({ error: t("unauthorizedSurgery") });
      return;
    }
  }

  // Validate the REAL GCS object metadata (size + Content-Type) before processing.
  const validation = await validateUploadedObject(storageService, {
    objectPath: grant.objectPath,
    mimeType: grant.mimeType,
    expectedSize: grant.expectedSize,
  });
  if (!validation.ok) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.token, grant, validation.generation);
    } catch (error) {
      logger.error({ err: error, uploadGrantId: grant.id }, "Failed to persist orphan media cleanup");
      res.status(500).json({ error: t("mediaUploadUrlFailed") });
      return;
    }
    res.status(validation.status).json({ error: localizedKnownMediaError(locale, validation.error) });
    return;
  }

  // Use ALL metadata from the grant — never from client body
  const mediaType = grant.mediaType;
  const surgeryId = grant.surgeryId;

  let record;
  try {
    record = await db.transaction(async (tx) => {
      await lockStoragePath(tx, grant.objectPath);
      if (await storageService.getObjectEntityGeneration(grant.objectPath) !== validation.generation) {
        throw new Error("Uploaded media object generation changed before linking");
      }
      if (!await claimGrant(tx, parsed.data.token, grant.id, validation.generation)) return null;
      const [inserted] = await tx.insert(surgeryMediaTable).values({
        surgeryId,
        mediaType,
        fileName: grant.fileName,
        mimeType: grant.mimeType,
        originalPath: grant.objectPath,
        previewStatus: "pending",
      }).returning();
      return inserted;
    });
  } catch (error) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.token, grant, validation.generation);
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, cause: error, uploadGrantId: grant.id },
        "Failed to persist cleanup after media registration failure",
      );
      res.status(500).json({ error: t("mediaUploadUrlFailed") });
      return;
    }
    logger.error({ err: error, uploadGrantId: grant.id }, "Media registration failed; cleanup enqueued");
    res.status(500).json({ error: t("mediaUploadUrlFailed") });
    return;
  }
  if (!record) {
    // A concurrent request committed first. Its newly-linked object is protected
    // by the cleanup worker's reference check.
    await db.transaction((tx) => enqueueStorageCleanup(tx, [{
      objectPath: grant.objectPath,
      objectGeneration: validation.generation,
    }]));
    res.status(403).json({ error: t("mediaInvalidUploadToken") });
    return;
  }

  res.json({
    id: record.id,
    status: "processing",
    originalPath: grant.objectPath,
  });

  processMediaInBackground({
    id: record.id,
    mediaType,
    originalPath: grant.objectPath,
    mimeType: grant.mimeType,
  });
});

// ─── List media for a surgery ─────────────────────────────────────────────────

router.get("/media/surgery/:surgeryId", requireAuth, async (req: Request, res: Response) => {
  const { t } = await mediaTranslator(req);
  const surgeryId = parseInt(String(req.params.surgeryId ?? ""));
  if (isNaN(surgeryId)) { res.status(400).json({ error: t("invalidSurgeryId") }); return; }

  if (!req.isAdmin) {
    const [surgery] = await db.select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
      .limit(1);
    if (!surgery) { res.status(404).json({ error: t("surgeryNotFound") }); return; }
  }

  const items = await db.select()
    .from(surgeryMediaTable)
    .where(eq(surgeryMediaTable.surgeryId, surgeryId))
    .orderBy(surgeryMediaTable.createdAt);

  let itemsWithUrls;
  try {
    itemsWithUrls = await Promise.all(items.map(async (item) => {
      const [previewSignedUrl, downloadSignedUrl] = await Promise.all([
        item.previewPath ? storageService.getSignedGetUrl(item.previewPath, 3600) : null,
        storageService.getSignedGetUrl(item.originalPath, 3600),
      ]);
      if ((item.previewPath && !previewSignedUrl) || !downloadSignedUrl) {
        throw new Error("Object storage did not return a signed media URL");
      }
      return { ...item, previewSignedUrl, downloadSignedUrl };
    }));
  } catch (error) {
    logger.error({ err: error, surgeryId }, "Failed to generate media download URL");
    res.status(500).json({ error: t("shareUrlFailed") });
    return;
  }

  res.json(itemsWithUrls);
});

// ─── Status by media ID ───────────────────────────────────────────────────────

router.get("/media/status/:id", requireAuth, async (req: Request, res: Response) => {
  const { t } = await mediaTranslator(req);
  const id = parseInt(String(req.params.id ?? ""));
  if (isNaN(id)) { res.status(400).json({ error: t("invalidId") }); return; }

  const [item] = req.isAdmin
    ? await db.select().from(surgeryMediaTable).where(eq(surgeryMediaTable.id, id)).limit(1)
    : await db
        .select({
          id: surgeryMediaTable.id,
          surgeryId: surgeryMediaTable.surgeryId,
          previewStatus: surgeryMediaTable.previewStatus,
          originalPath: surgeryMediaTable.originalPath,
          previewPath: surgeryMediaTable.previewPath,
          mimeType: surgeryMediaTable.mimeType,
          mediaType: surgeryMediaTable.mediaType,
          fileName: surgeryMediaTable.fileName,
          durationSeconds: surgeryMediaTable.durationSeconds,
          createdAt: surgeryMediaTable.createdAt,
        })
        .from(surgeryMediaTable)
        .innerJoin(surgeriesTable, eq(surgeryMediaTable.surgeryId, surgeriesTable.id))
        .where(and(eq(surgeryMediaTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
        .limit(1);
  if (!item) { res.status(404).json({ error: t("mediaNotFound") }); return; }

  let previewSignedUrl: string | null;
  let downloadSignedUrl: string | null;
  try {
    [previewSignedUrl, downloadSignedUrl] = await Promise.all([
      item.previewPath ? storageService.getSignedGetUrl(item.previewPath, 3600) : Promise.resolve(null),
      storageService.getSignedGetUrl(item.originalPath, 3600),
    ]);
    if ((item.previewPath && !previewSignedUrl) || !downloadSignedUrl) {
      throw new Error("Object storage did not return a signed media URL");
    }
  } catch (error) {
    logger.error({ err: error, mediaId: id }, "Failed to generate media status download URL");
    res.status(500).json({ error: t("shareUrlFailed") });
    return;
  }
  res.json({ ...item, previewSignedUrl, downloadSignedUrl });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete("/media/:id", requireAuth, async (req: Request, res: Response) => {
  const { t } = await mediaTranslator(req);
  const id = parseInt(String(req.params.id ?? ""));
  if (isNaN(id)) { res.status(400).json({ error: t("invalidId") }); return; }

  const [item] = req.isAdmin
    ? await db
        .select({ id: surgeryMediaTable.id, originalPath: surgeryMediaTable.originalPath, previewPath: surgeryMediaTable.previewPath })
        .from(surgeryMediaTable)
        .where(eq(surgeryMediaTable.id, id))
        .limit(1)
    : await db
        .select({ id: surgeryMediaTable.id, originalPath: surgeryMediaTable.originalPath, previewPath: surgeryMediaTable.previewPath })
        .from(surgeryMediaTable)
        .innerJoin(surgeriesTable, eq(surgeryMediaTable.surgeryId, surgeriesTable.id))
        .where(and(eq(surgeryMediaTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
        .limit(1);
  if (!item) { res.status(404).json({ error: t("mediaNotFound") }); return; }

  await db.transaction(async (tx) => {
    await enqueueStorageCleanup(tx, [item.originalPath, item.previewPath]);
    await tx.delete(surgeryMediaTable).where(eq(surgeryMediaTable.id, id));
  });
  void processStorageCleanupJobs(10).catch((error) => {
    logger.warn({ err: error, mediaId: id }, "Immediate media cleanup failed; outbox will retry");
  });
  res.json({ ok: true });
});

// ─── Download by media ID ─────────────────────────────────────────────────────

/**
 * GET /media/file/:mediaId
 *
 * Serve a media file authorised by media record ID (not by arbitrary objectKey).
 * Validates that the requesting doctor owns the surgery the media belongs to.
 */
router.get("/media/file/:mediaId", requireAuth, async (req: Request, res: Response) => {
  const { t } = await mediaTranslator(req);
  const mediaId = parseInt(String(req.params.mediaId ?? ""));
  if (isNaN(mediaId)) { res.status(400).json({ error: t("invalidMediaId") }); return; }

  const [item] = req.isAdmin
    ? await db
        .select({ id: surgeryMediaTable.id, originalPath: surgeryMediaTable.originalPath })
        .from(surgeryMediaTable)
        .where(eq(surgeryMediaTable.id, mediaId))
        .limit(1)
    : await db
        .select({ id: surgeryMediaTable.id, originalPath: surgeryMediaTable.originalPath })
        .from(surgeryMediaTable)
        .innerJoin(surgeriesTable, eq(surgeryMediaTable.surgeryId, surgeriesTable.id))
        .where(and(eq(surgeryMediaTable.id, mediaId), eq(surgeriesTable.doctorId, req.doctorId!)))
        .limit(1);

  if (!item) { res.status(404).json({ error: t("mediaNotFound") }); return; }

  try {
    const file = await storageService.getObjectEntityFile(item.originalPath);
    const response = await storageService.downloadObject(file, 3600);
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch {
    res.status(404).json({ error: t("fileNotFound") });
  }
});

export default router;

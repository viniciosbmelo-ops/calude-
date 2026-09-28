import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { db } from "@workspace/db";
import { surgeriesTable, surgeryMediaTable, patientAttachmentsTable, patientsTable } from "@workspace/db/schema";
import { eq, or, and } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import {
  abandonGrantAndEnqueueCleanup,
  claimGrant,
  createGrant,
  findAvailableGrant,
} from "../lib/uploadGrants";
import { validateUploadedObject } from "../lib/validateUploadedObject";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { lockStoragePath } from "../lib/storageCleanup";

// ─── Size limits ─────────────────────────────────────────────────────────────

/** Images and documents: 25 MB */
const MAX_IMAGE_DOC_BYTES = 25 * 1024 * 1024;

/** The only exception that gets a larger quota is explicit video content */
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

function maxBytesForMime(mime: string): number {
  return mime.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_DOC_BYTES;
}

/** Allowed MIME types for generic/campaign uploads */
const GENERIC_ALLOWED_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
  "video/mp4", "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Allowed MIME types for patient attachments */
const ATTACHMENT_ALLOWED_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
  "video/mp4", "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

// ─── Filename sanitization ────────────────────────────────────────────────────

function sanitizeFilename(name: string): string | null {
  if (/[/\\]/.test(name)) return null;
  const base = name.split("/").pop() ?? name;
  if (!base || base === "." || base === ".." || base.length > 255) return null;
  if (!/^[\w.\-\s()[\]{}@!+=#^~,']+$/.test(base)) return null;
  return base;
}

// ─── Router setup ─────────────────────────────────────────────────────────────

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ─── POST /storage/uploads/request-url ───────────────────────────────────────

const RequestUploadUrlBody = z.object({
  name: z.string().min(1).max(255).optional(),
  // Compatibility aliases for cached PWA bundles.
  fileName: z.string().min(1).max(255).optional(),
  // size is required so we can bind the exact expected byte count to the grant
  size: z.number().int().positive(),
  contentType: z.string().min(1).max(100).optional(),
  mimeType: z.string().min(1).max(100).optional(),
  // purpose controls how the grant will be consumed (required).
  //   patient_attachment → POST /patients/:id/attachments
  //   whatsapp_broadcast → POST /storage/uploads/finalize
  purpose: z.enum(["patient_attachment", "whatsapp_broadcast"]),
  // patientId required when purpose = patient_attachment
  patientId: z.number().int().positive().optional(),
}).transform((body, ctx) => {
  const name = body.name ?? body.fileName;
  const contentType = body.contentType ?? body.mimeType;
  if (!name || !contentType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Missing upload metadata" });
    return z.NEVER;
  }
  return { ...body, name, contentType };
});

/**
 * POST /storage/uploads/request-url
 *
 * Authenticated. Issues a pre-authorised upload grant persisted in PostgreSQL.
 * Returns a signed PUT URL + a single-use opaque token.
 *
 * purpose = "patient_attachment" → token consumed by POST /patients/:id/attachments
 * purpose = "whatsapp_broadcast" → token consumed by POST /storage/uploads/finalize
 *
 * No share URL is returned here. For WA broadcast the client must upload the
 * file and then call /storage/uploads/finalize, which validates the real object
 * and issues the signed GET (share) URL only after validation passes.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidPatientData") });
    return;
  }

  const { name, size, contentType, purpose, patientId } = parsed.data;

  if (purpose === "patient_attachment" && patientId === undefined) {
    res.status(400).json({ error: message(locale, "invalidPatientId") });
    return;
  }
  if (purpose === "patient_attachment") {
    const [patient] = await db.select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId!), eq(patientsTable.doctorId, req.doctorId!)))
      .limit(1);
    if (!patient) {
      res.status(404).json({ error: message(locale, "patientNotFound") });
      return;
    }
  }

  const allowedMimes =
    purpose === "patient_attachment"
      ? ATTACHMENT_ALLOWED_MIMES
      : GENERIC_ALLOWED_MIMES;
  if (!allowedMimes.has(contentType)) {
    res.status(400).json({ error: message(locale, "mediaFileTypeNotAllowed") });
    return;
  }

  const limit = maxBytesForMime(contentType);
  if (size > limit) {
    const limitMB = Math.round(limit / 1024 / 1024);
    res.status(400).json({ error: message(locale, "mediaFileTooLarge", { limitMB }) });
    return;
  }

  const safeFilename = sanitizeFilename(name);
  if (!safeFilename) {
    res.status(400).json({ error: message(locale, "mediaInvalidFilename") });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    const rawToken = await createGrant({
      purpose,
      doctorId: req.doctorId!,
      patientId,
      objectPath,
      fileName: safeFilename,
      mimeType: contentType,
      expectedSize: size,
    });

    res.json({
      uploadURL,
      uploadUrl: uploadURL,
      objectPath,
      token: rawToken,
      uploadToken: rawToken,
      metadata: { name: safeFilename, size, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: message(locale, "uploadUrlFailed") });
  }
});

// ─── POST /storage/uploads/finalize ──────────────────────────────────────────

const FinalizeUploadBody = z.object({
  token: z.string().min(1).max(200),
});

/**
 * POST /storage/uploads/finalize
 *
 * Authenticated. Consumes a whatsapp_broadcast upload grant
 * (single-use, atomic), verifies the grant belongs to the requesting doctor, then
 * validates the REAL GCS object metadata (existence, size within limit,
 * exact size match, Content-Type match). Only after all checks pass does it
 * return a 24 h signed GET URL (shareUrl) that patients can open without an
 * account.
 */
router.post("/storage/uploads/finalize", requireAuth, async (req: Request, res: Response) => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = FinalizeUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "uploadTokenRequired") });
    return;
  }

  const grant = await findAvailableGrant(parsed.data.token);
  if (!grant) {
    res.status(403).json({ error: message(locale, "invalidUploadToken") });
    return;
  }

  if (grant.purpose !== "whatsapp_broadcast") {
    res.status(403).json({ error: message(locale, "invalidUploadEndpoint") });
    return;
  }

  if (grant.doctorId !== req.doctorId) {
    res.status(403).json({ error: message(locale, "accessDenied") });
    return;
  }

  // Validate the REAL uploaded object before issuing a share URL.
  const validation = await validateUploadedObject(objectStorageService, {
    objectPath: grant.objectPath,
    mimeType: grant.mimeType,
    expectedSize: grant.expectedSize,
  });
  if (!validation.ok) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.token, grant, validation.generation);
    } catch (error) {
      req.log.error({ err: error, uploadGrantId: grant.id }, "Failed to persist invalid upload cleanup");
      res.status(500).json({ error: message(locale, "uploadUrlFailed") });
      return;
    }
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  const response: {
    objectPath: string;
    fileName: string;
    mimeType: string;
    shareUrl?: string;
  } = {
    objectPath: grant.objectPath,
    fileName: grant.fileName,
    mimeType: grant.mimeType,
  };

  if (grant.purpose === "whatsapp_broadcast") {
    let shareUrl: string | null;
    try {
      shareUrl = await objectStorageService.getSignedGetUrl(grant.objectPath, 86400);
      if (!shareUrl) {
        throw new Error("Object storage did not return a signed share URL");
      }
    } catch (error) {
      req.log.error({ err: error, uploadGrantId: grant.id }, "Failed to generate upload share URL");
      await abandonGrantAndEnqueueCleanup(parsed.data.token, grant, validation.generation);
      res.status(500).json({ error: message(locale, "shareUrlFailed") });
      return;
    }
    response.shareUrl = shareUrl;
  }

  if (grant.purpose === "whatsapp_broadcast") {
    const claimed = await db.transaction(async (tx) => {
      await lockStoragePath(tx, grant.objectPath);
      if (await objectStorageService.getObjectEntityGeneration(grant.objectPath) !== validation.generation) {
        throw new Error("Uploaded object generation changed before finalization");
      }
      return claimGrant(tx, parsed.data.token, grant.id, validation.generation);
    });
    if (!claimed) {
      res.status(403).json({ error: message(locale, "invalidUploadToken") });
      return;
    }
  }

  res.json(response);
});

// ─── GET /storage/public-objects/* ───────────────────────────────────────────

/**
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

// ─── GET /storage/objects/* ───────────────────────────────────────────────────

/**
 * Serve private object entities.
 *
 * Authorization rules:
 *   - Admin: access any object (audited).
 *   - Regular doctor: the objectPath must be traceable to one of:
 *       1. surgery_media.original_path or preview_path  (via surgeriesTable.doctorId)
 *       2. patient_attachments.object_path  (joined to doctorId)
 *   If none match → 404 (not 403, to avoid confirming the object exists).
 *
 * Callers should prefer signed-URL responses (media routes) over this endpoint.
 * This route is retained for same-origin authenticated contexts
 * (PDF generation, etc.).
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    if (!req.isAdmin) {
      const doctorId = req.doctorId!;
      const authorized = await isObjectAuthorizedForDoctor(objectPath, doctorId);
      if (!authorized) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * Verify that `objectPath` is accessible by `doctorId` by checking:
 *  1. surgery_media.original_path or preview_path (via surgery ownership)
 *  2. patient_attachments.object_path
 *
 * Returns true if any check passes.
 */
async function isObjectAuthorizedForDoctor(objectPath: string, doctorId: number): Promise<boolean> {
  // Check 2: surgery_media original or preview path (join ensures doctor owns the surgery)
  const [mediaMatch] = await db
    .select({ id: surgeryMediaTable.id })
    .from(surgeryMediaTable)
    .innerJoin(surgeriesTable, eq(surgeryMediaTable.surgeryId, surgeriesTable.id))
    .where(and(
      eq(surgeriesTable.doctorId, doctorId),
      or(
        eq(surgeryMediaTable.originalPath, objectPath),
        eq(surgeryMediaTable.previewPath, objectPath),
      ),
    ))
    .limit(1);
  if (mediaMatch) return true;

  // Check 3: patient attachment
  const [attachMatch] = await db
    .select({ id: patientAttachmentsTable.id })
    .from(patientAttachmentsTable)
    .where(and(
      eq(patientAttachmentsTable.doctorId, doctorId),
      eq(patientAttachmentsTable.objectPath, objectPath),
    ))
    .limit(1);
  if (attachMatch) return true;

  return false;
}

export default router;

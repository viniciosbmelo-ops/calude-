import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { db } from "@workspace/docregen-db";
import { patientAttachmentsTable, patientsTable } from "@workspace/docregen-db/schema";
import { eq, and } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { createGrant } from "../lib/uploadGrants";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";

// ─── Size limits ─────────────────────────────────────────────────────────────

/** Images and documents: 25 MB */
const MAX_IMAGE_DOC_BYTES = 25 * 1024 * 1024;

/** The only exception that gets a larger quota is explicit video content */
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

function maxBytesForMime(mime: string): number {
  return mime.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_DOC_BYTES;
}

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
  purpose: z.enum(["patient_attachment"]),
  // patientId is required (validated below)
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
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidPatientData") });
    return;
  }

  const { name, size, contentType, purpose, patientId } = parsed.data;

  if (patientId === undefined) {
    res.status(400).json({ error: message(locale, "invalidPatientId") });
    return;
  }
  const [patient] = await db.select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!patient) {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }

  if (!ATTACHMENT_ALLOWED_MIMES.has(contentType)) {
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

// ─── GET /storage/public-objects/* ───────────────────────────────────────────

/**
 * Serve public assets from DOCREGEN_PUBLIC_OBJECT_SEARCH_PATHS.
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
 * Authorization: the objectPath must be a patient attachment owned by the
 * requesting doctor (patient_attachments.object_path joined to doctorId).
 * DocRegen has no admin bypass. If nothing matches → 404 (not 403, to avoid
 * confirming the object exists).
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const authorized = await isObjectAuthorizedForDoctor(objectPath, req.doctorId!);
    if (!authorized) {
      res.status(404).json({ error: "Object not found" });
      return;
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
 * Verify that `objectPath` is a patient attachment owned by `doctorId`.
 */
async function isObjectAuthorizedForDoctor(objectPath: string, doctorId: number): Promise<boolean> {
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

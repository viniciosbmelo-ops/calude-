import { Router, type IRouter } from "express";
import { db, patientsTable, patientAttachmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { z } from "zod";
import {
  abandonGrantAndEnqueueCleanup,
  claimGrant,
  findAvailableGrant,
} from "../lib/uploadGrants";
import { validateUploadedObject } from "../lib/validateUploadedObject";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { logger } from "../lib/logger";
import {
  enqueueStorageCleanup,
  lockStoragePath,
  processStorageCleanupJobs,
} from "../lib/storageCleanup";

const router: IRouter = Router();
const storageService = new ObjectStorageService();

// ─── GET /patients/:id/attachments ───────────────────────────────────────────

router.get("/patients/:id/attachments", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const patientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(patientId)) { res.status(400).json({ error: message(locale, "invalidPatientId") }); return; }

  const [patient] = await db.select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: message(locale, "patientNotFound") }); return; }

  const items = await db.select()
    .from(patientAttachmentsTable)
    .where(eq(patientAttachmentsTable.patientId, patientId))
    .orderBy(patientAttachmentsTable.createdAt);

  let itemsWithUrls;
  try {
    itemsWithUrls = await Promise.all(items.map(async (item) => {
      const downloadUrl = await storageService.getSignedGetUrl(item.objectPath, 3600);
      if (!downloadUrl) {
        throw new Error("Object storage did not return a signed attachment URL");
      }
      return { ...item, createdAt: item.createdAt.toISOString(), downloadUrl };
    }));
  } catch (error) {
    logger.error({ err: error, patientId }, "Failed to generate attachment download URL");
    res.status(500).json({ error: message(locale, "shareUrlFailed") });
    return;
  }

  res.json(itemsWithUrls);
});

// ─── POST /patients/:id/attachments ──────────────────────────────────────────

const RegisterAttachmentBody = z.object({
  token: z.string().min(1).max(200),  // single-use upload grant token
  category: z.string().max(100).optional(),
  descricao: z.string().max(1000).optional(),
});

/**
 * POST /patients/:id/attachments
 *
 * Registers a patient attachment using a pre-authorised upload grant.
 * The grant (issued by POST /storage/uploads/request-url with purpose
 * "patient_attachment") is consumed atomically — exactly one request
 * can succeed per token.
 * All file metadata (fileName, mimeType, objectPath, fileSize) comes
 * from the grant row, not from the client body.
 */
router.post("/patients/:id/attachments", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const patientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(patientId)) { res.status(400).json({ error: message(locale, "invalidPatientId") }); return; }

  // Verify patient belongs to this doctor
  const [patient] = await db.select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: message(locale, "patientNotFound") }); return; }

  const parsed = RegisterAttachmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: message(locale, "uploadTokenRequired") }); return; }

  // Inspect first; the token is only claimed by the transaction that commits
  // the attachment row.
  const grant = await findAvailableGrant(parsed.data.token);
  if (!grant) {
    res.status(403).json({ error: message(locale, "invalidUploadToken") });
    return;
  }

  // Only patient_attachment grants are valid here
  if (grant.purpose !== "patient_attachment") {
    res.status(403).json({ error: message(locale, "invalidUploadEndpoint") });
    return;
  }

  // Verify the grant belongs to this doctor
  if (grant.doctorId !== req.doctorId) {
    res.status(403).json({ error: message(locale, "accessDenied") });
    return;
  }

  // Attachment grants are bound to exactly one patient.
  if (grant.patientId !== patientId) {
    res.status(403).json({ error: message(locale, "uploadUnauthorizedPatient") });
    return;
  }

  // Validate the REAL uploaded object (existence, size, Content-Type) before insert.
  const validation = await validateUploadedObject(storageService, {
    objectPath: grant.objectPath,
    mimeType: grant.mimeType,
    expectedSize: grant.expectedSize,
  });
  if (!validation.ok) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.token, grant, validation.generation);
    } catch (error) {
      logger.error({ err: error, uploadGrantId: grant.id }, "Failed to persist orphan attachment cleanup");
      res.status(500).json({ error: message(locale, "uploadUrlFailed") });
      return;
    }
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  let record;
  try {
    record = await db.transaction(async (tx) => {
      await lockStoragePath(tx, grant.objectPath);
      if (await storageService.getObjectEntityGeneration(grant.objectPath) !== validation.generation) {
        throw new Error("Attachment object generation changed before linking");
      }
      if (!await claimGrant(tx, parsed.data.token, grant.id, validation.generation)) return null;
      const [inserted] = await tx.insert(patientAttachmentsTable).values({
        patientId,
        doctorId: req.doctorId!,
        fileName: grant.fileName,
        mimeType: grant.mimeType,
        objectPath: grant.objectPath,
        fileSize: validation.size,
        category: parsed.data.category,
        descricao: parsed.data.descricao,
      }).returning();
      return inserted;
    });
  } catch (error) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.token, grant, validation.generation);
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, cause: error, uploadGrantId: grant.id },
        "Failed to persist cleanup after attachment registration failure",
      );
      res.status(500).json({ error: message(locale, "uploadUrlFailed") });
      return;
    }
    logger.error({ err: error, uploadGrantId: grant.id }, "Attachment registration failed; cleanup enqueued");
    res.status(500).json({ error: message(locale, "uploadUrlFailed") });
    return;
  }
  if (!record) {
    await db.transaction((tx) => enqueueStorageCleanup(tx, [{
      objectPath: grant.objectPath,
      objectGeneration: validation.generation,
    }]));
    res.status(403).json({ error: message(locale, "invalidUploadToken") });
    return;
  }

  res.status(201).json({ ...record, createdAt: record.createdAt.toISOString() });
});

// ─── DELETE /patients/:id/attachments/:attachmentId ──────────────────────────

router.delete("/patients/:id/attachments/:attachmentId", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const patientId = parseInt(String(req.params.id ?? ""), 10);
  const attachmentId = parseInt(String(req.params.attachmentId ?? ""), 10);
  if (isNaN(patientId) || isNaN(attachmentId)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }

  const [item] = await db.select()
    .from(patientAttachmentsTable)
    .where(and(
      eq(patientAttachmentsTable.id, attachmentId),
      eq(patientAttachmentsTable.patientId, patientId),
      eq(patientAttachmentsTable.doctorId, req.doctorId!),
    ))
    .limit(1);
  if (!item) { res.status(404).json({ error: message(locale, "attachmentNotFound") }); return; }

  await db.transaction(async (tx) => {
    await enqueueStorageCleanup(tx, [item.objectPath]);
    await tx.delete(patientAttachmentsTable).where(eq(patientAttachmentsTable.id, attachmentId));
  });
  void processStorageCleanupJobs(10).catch((error) => {
    logger.warn({ err: error, attachmentId }, "Immediate attachment cleanup failed; outbox will retry");
  });
  res.json({ ok: true });
});

export { router as patientAttachmentsRouter };

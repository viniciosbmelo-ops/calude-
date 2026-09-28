import { Router, type IRouter } from "express";
import { z } from "zod";
import { toInitials } from "../lib/anonymize";
import {
  db,
  doctorsTable,
  surgeriesTable,
  patientsTable,
  exameLigamentarTable,
  lcaAlgorithmTable,
  lcpReconstructionTable,
  cpmReconstructionTable,
  cplReconstructionTable,
  procedimentoMeniscalTable,
  examePatelarTable,
  picsScoreTable,
  followupTable,
  adminContactMessages,
  auditLogsTable,
  consentimentosTable,
  patientAttachmentsTable,
  secretariesTable,
  surgeryMediaTable,
  uploadGrantsTable,
  regenCasesTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull, gte, sql } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { hashPassword, verifyToken } from "../lib/auth";
import { getSessionCookie } from "../lib/session";
import { serializeDoctor } from "../lib/doctorSerializer";
import { isHiddenFracturePreoperative } from "../lib/followup-schedule";
import {
  enqueueStorageCleanup,
  processStorageCleanupJobs,
} from "../lib/storageCleanup";
import { createTemporaryAccessExpiration } from "../lib/temporaryAccess";

const router: IRouter = Router();

/**
 * GET /admin/doctors/pending
 * Returns all doctors awaiting approval.
 */
router.get("/admin/doctors/pending", requireAdmin, async (req, res): Promise<void> => {
  const pending = await db
    .select()
    .from(doctorsTable)
    .where(eq(doctorsTable.aprovado, false))
    .orderBy(doctorsTable.createdAt);

  const result = pending.map((doctor) => {
    const data = serializeDoctor(doctor);
    return {
      ...data,
      createdAt: data.createdAt.toISOString(),
    };
  });
  res.json(result);
});

/**
 * GET /admin/doctors/:doctorId/surgeries
 * Returns all surgeries for a specific doctor.
 * Patient data: only sexo and lado are exposed (clinical). Personal info omitted.
 */
router.get("/admin/doctors/:doctorId/surgeries", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);

  if (isNaN(doctorId)) {
    res.status(400).json({ error: "ID de médico inválido" });
    return;
  }

  const surgeries = await db
    .select({
      surgery: surgeriesTable,
      patientSexo: patientsTable.sexo,
      patientLado: patientsTable.lado,
    })
    .from(surgeriesTable)
    .leftJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .where(eq(surgeriesTable.doctorId, doctorId))
    .orderBy(surgeriesTable.dataCirurgia);

  const result = surgeries.map(({ surgery, patientSexo, patientLado }) => ({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patientSexo,
    patientLado,
    // Personal data intentionally omitted
  }));

  res.json(result);
});

/**
 * GET /admin/all-surgeries
 * Returns all surgeries across all doctors with doctor name and patient name for admin view.
 */
router.get("/admin/all-surgeries", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: surgeriesTable.id,
      dataCirurgia: surgeriesTable.dataCirurgia,
      hospital: surgeriesTable.hospital,
      tipoCaso: surgeriesTable.tipoCaso,
      tiposProcedimento: surgeriesTable.tiposProcedimento,
      ligamentosAcometidos: surgeriesTable.ligamentosAcometidos,
      createdAt: surgeriesTable.createdAt,
      doctorId: surgeriesTable.doctorId,
      doctorNome: doctorsTable.nome,
      doctorCrm: doctorsTable.crm,
      doctorCrmEstado: doctorsTable.crmEstado,
      patientId: surgeriesTable.patientId,
      patientNome: patientsTable.nome,
      patientSexo: patientsTable.sexo,
    })
    .from(surgeriesTable)
    .leftJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .leftJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .orderBy(desc(surgeriesTable.dataCirurgia));

  res.json(rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    patientNome: toInitials(r.patientNome),
  })));
});

/**
 * GET /admin/surgeries/:id
 * Returns full surgery detail + followups for admin view.
 * Patient personal fields (nome, cpf, telefone, email, dataNascimento) are excluded.
 */
router.get("/admin/surgeries/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de cirurgia inválido" });
    return;
  }

  const [surgery] = await db
    .select()
    .from(surgeriesTable)
    .where(eq(surgeriesTable.id, id))
    .limit(1);

  if (!surgery) {
    res.status(404).json({ error: "Cirurgia não encontrada" });
    return;
  }

  const [patient] = await db
    .select({
      id: patientsTable.id,
      nome: patientsTable.nome,
      sexo: patientsTable.sexo,
      lado: patientsTable.lado,
      // cpf, telefone, email, dataNascimento intentionally omitted
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, surgery.patientId))
    .limit(1);

  const [exame] = await db.select().from(exameLigamentarTable).where(eq(exameLigamentarTable.surgeryId, id)).limit(1);
  const [lca] = await db.select().from(lcaAlgorithmTable).where(eq(lcaAlgorithmTable.surgeryId, id)).limit(1);
  const [lcp] = await db.select().from(lcpReconstructionTable).where(eq(lcpReconstructionTable.surgeryId, id)).limit(1);
  const [cpm] = await db.select().from(cpmReconstructionTable).where(eq(cpmReconstructionTable.surgeryId, id)).limit(1);
  const [cpl] = await db.select().from(cplReconstructionTable).where(eq(cplReconstructionTable.surgeryId, id)).limit(1);
  const [menisco] = await db.select().from(procedimentoMeniscalTable).where(eq(procedimentoMeniscalTable.surgeryId, id)).limit(1);
  const [patelar] = await db.select().from(examePatelarTable).where(eq(examePatelarTable.surgeryId, id)).limit(1);
  const [pics] = await db.select().from(picsScoreTable).where(eq(picsScoreTable.surgeryId, id)).limit(1);
  const followups = (await db.select().from(followupTable)
    .where(eq(followupTable.surgeryId, id))
    .orderBy(followupTable.createdAt))
    .filter((followup) => !isHiddenFracturePreoperative(
      surgery.tiposProcedimento as string[] | null,
      followup.tempo,
    ));

  res.json({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patient: patient ? { ...patient, nome: toInitials(patient.nome) } : null,
    exameLigamentar: exame ?? null,
    lcaAlgorithm: lca ?? null,
    lcpReconstruction: lcp ?? null,
    cpmReconstruction: cpm ?? null,
    cplReconstruction: cpl ?? null,
    procedimentoMeniscal: menisco ?? null,
    examePatelar: patelar ?? null,
    picsScore: pics ?? null,
    followups: followups.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
  });
});

/**
 * PATCH /admin/doctors/:doctorId/approve
 * Approve a pending doctor registration.
 */
router.patch("/admin/doctors/:doctorId/approve", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);

  if (isNaN(doctorId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [doctor] = await db
    .update(doctorsTable)
    .set({ aprovado: true })
    .where(eq(doctorsTable.id, doctorId))
    .returning();

  if (!doctor) {
    res.status(404).json({ error: "Médico não encontrado" });
    return;
  }

  const data = serializeDoctor(doctor);
  res.json({ ...data, createdAt: data.createdAt.toISOString() });
});

/**
 * PATCH /admin/doctors/:doctorId/reject
 * Reject (delete) a pending doctor registration.
 */
router.patch("/admin/doctors/:doctorId/reject", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);

  if (isNaN(doctorId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  await db.delete(doctorsTable).where(and(eq(doctorsTable.id, doctorId), eq(doctorsTable.aprovado, false)));
  res.json({ success: true });
});

/**
 * PATCH /admin/doctors/:doctorId/block
 * Block (suspend) an active doctor — revokes platform access without deleting data.
 * Doctor can be re-approved later.
 */
router.patch("/admin/doctors/:doctorId/block", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);

  if (isNaN(doctorId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const doctor = await db.transaction(async (tx) => {
    const [blockedDoctor] = await tx
      .update(doctorsTable)
      .set({
        aprovado: false,
        sessionVersion: sql`${doctorsTable.sessionVersion} + 1`,
      })
      .where(and(eq(doctorsTable.id, doctorId), eq(doctorsTable.isAdmin, false)))
      .returning();

    if (blockedDoctor) {
      await tx
        .update(secretariesTable)
        .set({ sessionVersion: sql`${secretariesTable.sessionVersion} + 1` })
        .where(eq(secretariesTable.doctorId, doctorId));
    }

    return blockedDoctor;
  });

  if (!doctor) { res.status(404).json({ error: "Médico não encontrado ou é administrador" }); return; }

  const data = serializeDoctor(doctor);
  res.json({ ...data, createdAt: data.createdAt.toISOString() });
});

/**
 * PATCH /admin/doctors/:doctorId/set-free
 * Toggle the isFree flag — marks a doctor as exempt from subscription billing.
 */
router.patch("/admin/doctors/:doctorId/set-free", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);

  if (isNaN(doctorId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { isFree } = req.body as { isFree: boolean };
  if (typeof isFree !== "boolean") { res.status(400).json({ error: "isFree deve ser boolean" }); return; }

  const [doctor] = await db
    .update(doctorsTable)
    .set({ isFree })
    .where(and(eq(doctorsTable.id, doctorId), eq(doctorsTable.isAdmin, false)))
    .returning();

  if (!doctor) { res.status(404).json({ error: "Médico não encontrado ou é administrador" }); return; }

  const data = serializeDoctor(doctor);
  res.json({ ...data, createdAt: data.createdAt.toISOString() });
});

/**
 * PATCH /admin/doctors/:doctorId/grant-temporary-access
 * Grants 30 days of billing-exempt access without changing Stripe.
 */
router.patch("/admin/doctors/:doctorId/grant-temporary-access", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);
  if (isNaN(doctorId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const expiresAt = createTemporaryAccessExpiration();
  const [doctor] = await db
    .update(doctorsTable)
    .set({
      isFree: false,
      temporaryAccessExpiresAt: expiresAt,
    })
    .where(and(eq(doctorsTable.id, doctorId), eq(doctorsTable.isAdmin, false)))
    .returning();

  if (!doctor) {
    res.status(404).json({ error: "Médico não encontrado ou é administrador" });
    return;
  }

  req.log.info({
    doctorId,
    adminId: req.doctorId,
    temporaryAccessExpiresAt: expiresAt.toISOString(),
  }, "Admin granted 30-day temporary access");

  const data = serializeDoctor(doctor);
  res.json({
    ...data,
    createdAt: data.createdAt.toISOString(),
    temporaryAccessExpiresAt: data.temporaryAccessExpiresAt?.toISOString() ?? null,
  });
});

/**
 * DELETE /admin/doctors/:doctorId
 * Permanently delete a doctor and ALL their data (patients, surgeries, exams — cascade).
 * Returns counts of data that will be deleted for frontend confirmation.
 */
router.delete("/admin/doctors/:doctorId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);

  if (isNaN(doctorId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const result = await db.transaction(async (tx) => {
    const [doctor] = await tx
      .select({ id: doctorsTable.id, nome: doctorsTable.nome, isAdmin: doctorsTable.isAdmin })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .for("update");
    if (!doctor) return { kind: "not_found" as const };
    if (doctor.isAdmin) return { kind: "admin" as const };

    const attachments = await tx
      .select({ objectPath: patientAttachmentsTable.objectPath })
      .from(patientAttachmentsTable)
      .where(eq(patientAttachmentsTable.doctorId, doctorId));
    const media = await tx
      .select({
        originalPath: surgeryMediaTable.originalPath,
        previewPath: surgeryMediaTable.previewPath,
      })
      .from(surgeryMediaTable)
      .innerJoin(surgeriesTable, eq(surgeryMediaTable.surgeryId, surgeriesTable.id))
      .where(eq(surgeriesTable.doctorId, doctorId));
    const surgeryFiles = await tx
      .select({ rxImageUrl: surgeriesTable.rxImageUrl })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.doctorId, doctorId));
    const uploadGrants = await tx
      .select({ objectPath: uploadGrantsTable.objectPath })
      .from(uploadGrantsTable)
      .where(eq(uploadGrantsTable.doctorId, doctorId));

    const cleanupJobs = await enqueueStorageCleanup(tx, [
      ...attachments.map((item) => item.objectPath),
      ...media.flatMap((item) => [item.originalPath, item.previewPath]),
      ...surgeryFiles.map((item) => item.rxImageUrl),
      ...uploadGrants.map((item) => item.objectPath),
    ]);

    await tx.delete(regenCasesTable).where(eq(regenCasesTable.doctorId, doctorId));
    await tx.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
    return { kind: "deleted" as const, nome: doctor.nome, cleanupJobs };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Médico não encontrado" });
    return;
  }
  if (result.kind === "admin") {
    res.status(403).json({ error: "Não é possível excluir um administrador" });
    return;
  }

  void processStorageCleanupJobs().then((cleanup) => {
    if (cleanup.failed > 0) {
      req.log.warn(
        { doctorId, failed: cleanup.failed },
        "Arquivos do médico permaneceram na fila de exclusão",
      );
    }
  }).catch((error) => {
    req.log.warn({ err: error, doctorId }, "Falha ao processar fila de exclusão");
  });

  res.json({ success: true, nome: result.nome });
});

// ─── Contact messages (Admin inbox) ───────────────────────────────────────────

/**
 * POST /admin/contact
 * Optionally authenticated — doctors can send messages; doctorId is saved if JWT present.
 */
router.post("/admin/contact", async (req, res): Promise<void> => {
  const { nome, email, crm, mensagem } = req.body ?? {};
  if (!mensagem || String(mensagem).trim().length < 5) {
    res.status(400).json({ error: "Mensagem é obrigatória." });
    return;
  }
  // Try to extract doctorId from JWT if present (optional auth)
  let doctorId: number | null = null;
  try {
    const authHeader = req.headers.authorization;
    const token =
      getSessionCookie(req, "doctor") ??
      getSessionCookie(req, "secretary") ??
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
    if (token) {
      const payload = verifyToken(token);
      if (
        payload &&
        (payload.role === "doctor" || payload.role === "secretary") &&
        !payload.isAdmin
      ) {
        doctorId = payload.doctorId;
      }
    }
  } catch {}

  const [msg] = await db.insert(adminContactMessages).values({
    doctorId,
    nome: nome ? String(nome).trim() : null,
    email: email ? String(email).trim() : null,
    crm: crm ? String(crm).trim() : null,
    mensagem: String(mensagem).trim(),
  }).returning();
  res.status(201).json(msg);
});

/**
 * GET /admin/contact-messages
 * Admin only — returns all contact messages, newest first.
 */
router.get("/admin/contact-messages", requireAdmin, async (_req, res): Promise<void> => {
  const msgs = await db
    .select()
    .from(adminContactMessages)
    .orderBy(desc(adminContactMessages.createdAt));
  res.json(msgs.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    respondidaEm: m.respondidaEm?.toISOString() ?? null,
  })));
});

/**
 * PATCH /admin/contact-messages/:id/read
 * Admin only — marks a message as read.
 */
router.patch("/admin/contact-messages/:id/read", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db.update(adminContactMessages).set({ lida: true }).where(eq(adminContactMessages.id, id));
  res.json({ success: true });
});

/**
 * PATCH /admin/contact-messages/:id/reply
 * Admin only — sends an in-app reply to a contact message.
 */
router.patch("/admin/contact-messages/:id/reply", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { resposta } = req.body ?? {};
  if (!resposta || String(resposta).trim().length < 2) {
    res.status(400).json({ error: "Resposta é obrigatória." });
    return;
  }
  const now = new Date();
  const [updated] = await db
    .update(adminContactMessages)
    .set({
      resposta: String(resposta).trim(),
      respondidaEm: now,
      firstResponseAt: sql`coalesce(${adminContactMessages.firstResponseAt}, ${now})`,
      lida: true,
      respostaLida: false,
    })
    .where(eq(adminContactMessages.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Mensagem não encontrada." }); return; }
  res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    respondidaEm: updated.respondidaEm?.toISOString() ?? null,
    firstResponseAt: updated.firstResponseAt?.toISOString() ?? null,
  });
});

/**
 * GET /admin/contact-messages/unread-count
 * Admin only — returns count of unread messages (for badge).
 */
router.get("/admin/contact-messages/unread-count", requireAdmin, async (_req, res): Promise<void> => {
  const msgs = await db
    .select({ id: adminContactMessages.id })
    .from(adminContactMessages)
    .where(eq(adminContactMessages.lida, false));
  res.json({ count: msgs.length });
});

// ─── Doctor Inbox (replies from admin) ────────────────────────────────────────

/**
 * GET /inbox
 * Doctor only — returns their own messages and admin replies.
 */
router.get("/inbox", requireAuth, async (req, res): Promise<void> => {
  if (req.isAdmin) { res.status(403).json({ error: "Admins não possuem inbox de médico." }); return; }
  const msgs = await db
    .select()
    .from(adminContactMessages)
    .where(eq(adminContactMessages.doctorId, req.doctorId!))
    .orderBy(desc(adminContactMessages.createdAt));
  res.json(msgs.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    respondidaEm: m.respondidaEm?.toISOString() ?? null,
  })));
});

/**
 * GET /inbox/unread-count
 * Doctor only — count of messages that have an unread admin reply.
 */
router.get("/inbox/unread-count", requireAuth, async (req, res): Promise<void> => {
  if (req.isAdmin) { res.json({ count: 0 }); return; }
  const msgs = await db
    .select({ id: adminContactMessages.id })
    .from(adminContactMessages)
    .where(
      and(
        eq(adminContactMessages.doctorId, req.doctorId!),
        eq(adminContactMessages.respostaLida, false),
        isNotNull(adminContactMessages.resposta),
      )
    );
  res.json({ count: msgs.length });
});

/**
 * GET /admin/contact-reply
 * Public (no auth) — allows a locked-out user to check if the admin replied
 * to their contact message using only their email. Returns the most recent
 * replied message for that email address.
 * Rate-limited by checking that the email actually has a message in DB.
 */
router.get("/admin/contact-reply", async (req, res): Promise<void> => {
  const email = String(req.query["email"] ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "E-mail inválido." });
    return;
  }
  const msgs = await db
    .select()
    .from(adminContactMessages)
    .where(and(
      isNotNull(adminContactMessages.resposta),
      eq(adminContactMessages.email, email),
    ))
    .orderBy(desc(adminContactMessages.createdAt))
    .limit(1);

  if (msgs.length === 0) {
    // Don't reveal whether email exists — just say no reply yet
    res.json({ hasReply: false });
    return;
  }
  const msg = msgs[0]!;
  res.json({
    hasReply: true,
    resposta: msg.resposta,
    respondidaEm: msg.respondidaEm?.toISOString() ?? null,
    mensagemOriginal: msg.mensagem,
  });
});

/**
 * PATCH /inbox/:id/read-reply
 * Doctor only — marks admin reply as read.
 */
router.patch("/inbox/:id/read-reply", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db
    .update(adminContactMessages)
    .set({ respostaLida: true })
    .where(and(eq(adminContactMessages.id, id), eq(adminContactMessages.doctorId, req.doctorId!)));
  res.json({ success: true });
});

/**
 * GET /admin/audit-logs
 * Returns audit log entries with optional filters: days, doctorId, resourceId, method
 */
router.get("/admin/audit-logs", requireAdmin, async (req, res): Promise<void> => {
  const days = parseInt((req.query["days"] as string) ?? "7", 10);
  const doctorId = req.query["doctorId"] ? parseInt(req.query["doctorId"] as string, 10) : null;
  const resourceId = req.query["resourceId"] as string | undefined;
  const method = req.query["method"] as string | undefined;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conditions = [gte(auditLogsTable.createdAt, since)];
  if (doctorId) conditions.push(eq(auditLogsTable.doctorId, doctorId));
  if (resourceId) conditions.push(eq(auditLogsTable.resourceId, resourceId));
  if (method) conditions.push(eq(auditLogsTable.method, method.toUpperCase()));

  const [logs, [{ total }]] = await Promise.all([
    db.select().from(auditLogsTable)
      .where(and(...conditions))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(500),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLogsTable)
      .where(and(...conditions)),
  ]);

  res.json({ total, logs });
});

/**
 * GET /admin/audit-logs/doctor/:doctorId
 * Returns audit logs for a specific doctor.
 */
router.get("/admin/audit-logs/doctor/:doctorId", requireAdmin, async (req, res): Promise<void> => {
  const doctorId = parseInt(String(req.params["doctorId"] ?? ""), 10);
  if (isNaN(doctorId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const logs = await db.select().from(auditLogsTable)
    .where(eq(auditLogsTable.doctorId, doctorId))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(200);

  res.json({ total: logs.length, logs });
});

/**
 * GET /admin/lgpd/exclusoes
 * Returns doctors who have requested data deletion.
 */
router.get("/admin/lgpd/exclusoes", requireAdmin, async (req, res): Promise<void> => {
  const pending = await db
    .select({
      id: doctorsTable.id,
      nome: doctorsTable.nome,
      email: doctorsTable.email,
      crm: doctorsTable.crm,
      crmEstado: doctorsTable.crmEstado,
      deletionRequestedAt: doctorsTable.deletionRequestedAt,
    })
    .from(doctorsTable)
    .where(isNotNull(doctorsTable.deletionRequestedAt))
    .orderBy(desc(doctorsTable.deletionRequestedAt));

  res.json({ total: pending.length, pending });
});

/**
 * GET /admin/lgpd/compliance-report
 * Generates a dynamic LGPD compliance report with live DB statistics.
 */
router.get("/admin/lgpd/compliance-report", requireAdmin, async (req, res): Promise<void> => {
  const [
    [{ totalDoctors }],
    [{ totalPatients }],
    [{ totalSurgeries }],
    [{ totalAuditLogs }],
    [{ totalConsentimentos }],
    deletionPending,
  ] = await Promise.all([
    db.select({ totalDoctors: sql<number>`count(*)::int` }).from(doctorsTable),
    db.select({ totalPatients: sql<number>`count(*)::int` }).from(patientsTable),
    db.select({ totalSurgeries: sql<number>`count(*)::int` }).from(surgeriesTable),
    db.select({ totalAuditLogs: sql<number>`count(*)::int` }).from(auditLogsTable),
    db.select({ totalConsentimentos: sql<number>`count(*)::int` }).from(consentimentosTable).where(eq(consentimentosTable.aceito, true)),
    db.select({ id: doctorsTable.id }).from(doctorsTable).where(isNotNull(doctorsTable.deletionRequestedAt)),
  ]);

  const report = {
    geradoEm: new Date().toISOString(),
    versao: "1.0",
    lei: "Lei nº 13.709/2018 — LGPD",
    plataforma: {
      nome: "DocSholder",
      finalidade: "Documentação e análise de cirurgias ortopédicas do joelho",
      classificacaoDados: "Dados pessoais sensíveis — Art. 5º, II (dados de saúde)",
    },
    estatisticasAtivas: {
      medicos: totalDoctors,
      pacientes: totalPatients,
      cirurgias: totalSurgeries,
      logsAuditoria: totalAuditLogs,
      consentimentosAtivos: totalConsentimentos,
      solicitacoesExclusaoPendentes: deletionPending.length,
    },
    direitosDoTitular: {
      implementados: [
        { direito: "Confirmação de tratamento", endpoint: "GET /api/lgpd/consentimento", status: "ativo" },
        { direito: "Acesso aos dados (Art. 18, II)", endpoint: "GET /api/lgpd/dados", status: "ativo" },
        { direito: "Correção (Art. 18, III)", endpoint: "PATCH /api/doctors/me", status: "ativo" },
        { direito: "Anonimização (Art. 18, IV)", endpoint: "POST /api/lgpd/anonimizar-paciente/:id", status: "ativo" },
        { direito: "Portabilidade (Art. 18, V)", endpoint: "GET /api/lgpd/exportar", status: "ativo" },
        { direito: "Eliminação (Art. 18, VI)", endpoint: "DELETE /api/lgpd/solicitar-exclusao", status: "ativo" },
        { direito: "Revogação de consentimento (Art. 18, IX)", endpoint: "POST /api/lgpd/consentimento {aceito:false}", status: "ativo" },
      ],
      prazoResposta: "15 dias úteis (Art. 18, §5º)",
    },
    medidasSeguranca: {
      autenticacao: "JWT + bcryptjs",
      bola: "Verificação doctorId em todos os 23 endpoints",
      headersSeguranca: "Helmet.js — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy",
      rateLimiting: ["300 req/min global", "10/15min auth (brute-force)", "3/hora registro", "20/dia IA"],
      auditoria: "Todas as operações /api/* registradas em audit_logs com hash SHA-256",
      redacaoSensiveis: "Campos senha/CPF/token removidos antes do hash",
    },
    retencaoDados: {
      dadosMedico: "Vigência + 5 anos",
      prontuariosPacientes: "20 anos (CFM Res. 1.821/2007)",
      logsAuditoria: "5 anos (Art. 16, I LGPD)",
      consentimentos: "Vigência + 5 anos",
    },
    consentimento: {
      tabelaDB: "consentimentos",
      provaHash: "SHA-256 do texto completo do termo",
      versaoAtual: "1.0",
      revogacaoDisponivel: true,
    },
    baseJuridica: [
      { categoria: "Dados do médico", base: "Art. 7º, V — execução de contrato" },
      { categoria: "Dados de saúde dos pacientes", base: "Art. 11, §2º, f — tutela da saúde" },
      { categoria: "Pesquisa científica", base: "Art. 11, §2º, c — pesquisa" },
      { categoria: "Logs de acesso", base: "Art. 7º, IX — legítimo interesse" },
    ],
    suboperadores: [
      { nome: "Replit", finalidade: "Hospedagem e infraestrutura", pais: "EUA" },
      { nome: "PostgreSQL (Replit)", finalidade: "Banco de dados", pais: "EUA" },
      { nome: "OpenAI (opcional)", finalidade: "Análise de imagens radiográficas anonimizadas", pais: "EUA" },
    ],
  };

  res.json(report);
});

const VALID_UF_ADMIN = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO",
  "MA","MG","MS","MT","PA","PB","PE","PI","PR",
  "RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);

const AdminRegisterDoctorBody = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6),
  crm: z.string().min(1),
  crmEstado: z.string().min(2).max(2),
  cpf: z.string().min(11),
  telefone: z.string().optional(),
  especialidade: z.string().optional(),
});

const AdminUpdateDoctorBody = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  crm: z.string().optional(),
  crmEstado: z.string().optional(),
  cpf: z.string().optional(),
  telefone: z.string().optional(),
  estrangeiro: z.boolean().optional(),
  paisOrigem: z.string().optional(),
  dataNascimento: z.string().nullable().optional(),
  endereco: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  especialidade: z.string().optional(),
  idioma: z.enum(["pt-BR", "es"]).optional(),
  whatsappBusiness: z.string().optional(),
});

/**
 * PATCH /admin/doctors/:doctorId/profile
 * Admin-only: update a doctor's registration/profile fields.
 * Credential fields and billing/role flags intentionally remain separate.
 */
router.patch("/admin/doctors/:doctorId/profile", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);
  if (isNaN(doctorId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = AdminUpdateDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos: " + parsed.error.message });
    return;
  }

  const body = parsed.data;
  const email = body.email.trim().toLowerCase();
  const crm = body.crm?.replace(/\D/g, "") ?? "";
  const crmEstado = body.crmEstado?.trim().toUpperCase() ?? "";
  const cpf = body.cpf?.replace(/\D/g, "") ?? "";
  const estado = body.estado?.trim().toUpperCase() ?? "";
  const dataNascimento = body.dataNascimento?.trim() || null;

  if (crmEstado && !VALID_UF_ADMIN.has(crmEstado)) {
    res.status(400).json({ error: `Estado do CRM inválido: "${crmEstado}"` });
    return;
  }
  if (crm && !crmEstado) {
    res.status(400).json({ error: "Informe o estado do CRM quando houver número de CRM." });
    return;
  }
  if (estado && !VALID_UF_ADMIN.has(estado)) {
    res.status(400).json({ error: `Estado de endereço inválido: "${estado}"` });
    return;
  }
  if (cpf && cpf.length !== 11) {
    res.status(400).json({ error: "CPF deve conter 11 dígitos." });
    return;
  }
  if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
    res.status(400).json({ error: "Data de nascimento inválida. Use o formato AAAA-MM-DD." });
    return;
  }

  const [emailOwner] = await db
    .select({ id: doctorsTable.id })
    .from(doctorsTable)
    .where(sql`lower(${doctorsTable.email}) = ${email}`)
    .limit(1);
  if (emailOwner && emailOwner.id !== doctorId) {
    res.status(409).json({ error: "Este e-mail já está cadastrado para outro médico." });
    return;
  }

  const [doctor] = await db
    .update(doctorsTable)
    .set({
      nome: body.nome.trim(),
      email,
      crm: crm || null,
      crmEstado: crmEstado || null,
      cpf: cpf || null,
      telefone: body.telefone?.trim() || null,
      estrangeiro: body.estrangeiro ?? false,
      paisOrigem: body.paisOrigem?.trim() || null,
      dataNascimento,
      endereco: body.endereco?.trim() || null,
      cidade: body.cidade?.trim() || null,
      estado: estado || null,
      cep: body.cep?.trim() || null,
      especialidade: body.especialidade?.trim() || null,
      idioma: body.idioma ?? "pt-BR",
      whatsappBusiness: body.whatsappBusiness?.trim() || null,
    })
    .where(eq(doctorsTable.id, doctorId))
    .returning();

  if (!doctor) {
    res.status(404).json({ error: "Médico não encontrado" });
    return;
  }

  req.log.info({ doctorId, adminId: (req as any).doctor?.id }, "Admin updated doctor profile");
  const data = serializeDoctor(doctor);
  res.json({ doctor: { ...data, createdAt: data.createdAt.toISOString() } });
});

/**
 * POST /admin/doctors/register
 * Admin-only: create a doctor account directly (approved + free), bypassing Stripe.
 */
router.post("/admin/doctors/register", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AdminRegisterDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos: " + parsed.error.message });
    return;
  }

  const { nome, email, senha, crm, crmEstado, cpf, telefone, especialidade } = parsed.data;

  if (!VALID_UF_ADMIN.has(crmEstado.toUpperCase())) {
    res.status(400).json({ error: `Estado do CRM inválido: "${crmEstado}"` });
    return;
  }

  const [byEmail] = await db.select({ id: doctorsTable.id }).from(doctorsTable)
    .where(sql`lower(${doctorsTable.email}) = ${email.trim().toLowerCase()}`).limit(1);
  if (byEmail) {
    res.status(409).json({ error: "Email já cadastrado na plataforma." });
    return;
  }

  const [byCrm] = await db.select({ id: doctorsTable.id }).from(doctorsTable)
    .where(and(
      eq(doctorsTable.crm, crm.replace(/\D/g, "")),
      eq(doctorsTable.crmEstado, crmEstado.toUpperCase()),
      eq(doctorsTable.isAdmin, false),
    )).limit(1);
  if (byCrm) {
    res.status(409).json({ error: `CRM ${crmEstado.toUpperCase()} ${crm} já cadastrado.` });
    return;
  }

  const senhaHash = await hashPassword(senha);

  const [doctor] = await db.insert(doctorsTable).values({
    nome: nome.trim(),
    email: email.trim().toLowerCase(),
    senhaHash,
    crm: crm.replace(/\D/g, ""),
    crmEstado: crmEstado.toUpperCase(),
    cpf: cpf.replace(/\D/g, ""),
    telefone: telefone?.trim() || null,
    especialidade: especialidade?.trim() || null,
    isAdmin: false,
    aprovado: true,
    isFree: true,
  }).returning();

  const doctorData = serializeDoctor(doctor);
  res.status(201).json({
    doctor: { ...doctorData, createdAt: doctorData.createdAt.toISOString() },
  });
});

/**
 * PATCH /admin/doctors/:doctorId/reset-password
 * Admin sets a new password for a doctor directly (no email needed).
 */
router.patch("/admin/doctors/:doctorId/reset-password", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.doctorId) ? req.params.doctorId[0] : req.params.doctorId;
  const doctorId = parseInt(raw, 10);
  if (isNaN(doctorId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { novaSenha } = req.body ?? {};
  if (!novaSenha || typeof novaSenha !== "string" || novaSenha.length < 6) {
    res.status(400).json({ error: "Nova senha deve ter no mínimo 6 caracteres." });
    return;
  }

  const [doctor] = await db.select({ id: doctorsTable.id, nome: doctorsTable.nome })
    .from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
  if (!doctor) { res.status(404).json({ error: "Médico não encontrado." }); return; }

  const senhaHash = await hashPassword(novaSenha);
  await db
    .update(doctorsTable)
    .set({
      senhaHash,
      sessionVersion: sql`${doctorsTable.sessionVersion} + 1`,
    })
    .where(eq(doctorsTable.id, doctorId));

  req.log.info({ doctorId, adminId: (req as any).doctor?.id }, "Admin reset doctor password");
  res.json({ success: true });
});

export default router;

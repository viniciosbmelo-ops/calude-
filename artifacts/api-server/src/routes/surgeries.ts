import { Router, type IRouter } from "express";
import {
  db,
  surgeriesTable,
  patientsTable,
  doctorsTable,
  followupTable,
  scheduledNotificationsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { checkClinicalPayload } from "./shoulder-surgeries";
import {
  filterSupportedFollowupScales,
  hasFractureProcedure,
  isPreoperativePeriod,
} from "../lib/followup-schedule";
import {
  ensurePreoperativeNotification,
  removePreoperativeNotifications,
  syncSurgerySchedule,
} from "../lib/surgery-schedule-sync";
import { sendWhatsAppText, buildFollowupMessage } from "../lib/whatsapp";
import { getBaseUrl } from "../lib/base-url";
import { buildRequestAppLink } from "../lib/app-links";
import { randomUUID } from "crypto";
import { z } from "zod/v4";
import { resolveDoctorLocale } from "../lib/locale";
import { localeForDoctorId } from "../lib/locale";
import { message as localizedMessage } from "../lib/locale-catalog";
import { loadClinicianScales, loadPatientScales } from "../lib/clinician-scales";

const router: IRouter = Router();

async function patientBelongsToDoctor(
  patientId: number,
  doctorId: number,
): Promise<boolean> {
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(
      eq(patientsTable.id, patientId),
      eq(patientsTable.doctorId, doctorId),
    ))
    .limit(1);
  return Boolean(patient);
}

async function updateSurgeryWithLifecycleLock(
  surgeryId: number,
  doctorId: number,
  values: Record<string, unknown>,
): Promise<typeof surgeriesTable.$inferSelect | undefined> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const [surgery] = await tx
      .update(surgeriesTable)
      .set(values)
      .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, doctorId)))
      .returning();
    return surgery;
  });
}

class PreoperativeFractureError extends Error {}

async function ensureFollowupForNotification(
  surgeryId: number,
  notificationId: number,
  preferredFollowupId?: number,
): Promise<typeof followupTable.$inferSelect | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );

    const [surgery] = await tx
      .select({ tiposProcedimento: surgeriesTable.tiposProcedimento })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.id, surgeryId))
      .for("update")
      .limit(1);
    if (!surgery) return null;

    const [notification] = await tx
      .select()
      .from(scheduledNotificationsTable)
      .where(and(
        eq(scheduledNotificationsTable.id, notificationId),
        eq(scheduledNotificationsTable.surgeryId, surgeryId),
      ))
      .for("update")
      .limit(1);
    if (!notification) return null;

    if (
      hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(notification.periodo)
    ) {
      throw new PreoperativeFractureError();
    }

    if (preferredFollowupId) {
      const [preferred] = await tx
        .select()
        .from(followupTable)
        .where(and(
          eq(followupTable.id, preferredFollowupId),
          eq(followupTable.surgeryId, surgeryId),
        ))
        .limit(1);
      return preferred ?? null;
    }

    if (notification.followupId) {
      const [existing] = await tx
        .select()
        .from(followupTable)
        .where(and(
          eq(followupTable.id, notification.followupId),
          eq(followupTable.surgeryId, surgeryId),
        ))
        .limit(1);

      if (existing) {
        if (existing.token) return existing;
        const [updated] = await tx
          .update(followupTable)
          .set({
            token: randomUUID(),
            escalasEnviadas: filterSupportedFollowupScales(notification.scales),
          })
          .where(eq(followupTable.id, existing.id))
          .returning();
        return updated;
      }
    }

    const [created] = await tx
      .insert(followupTable)
      .values({
        surgeryId,
        tempo: notification.periodo,
        dataAvaliacao: new Date().toISOString().slice(0, 10),
        token: randomUUID(),
        escalasEnviadas: filterSupportedFollowupScales(notification.scales),
      })
      .returning();

    await tx
      .update(scheduledNotificationsTable)
      .set({ followupId: created.id })
      .where(eq(scheduledNotificationsTable.id, notificationId));

    return created;
  });
}

// ── Corpo das cirurgias de ombro/cotovelo ─────────────────────────────────
// Rascunho, finalização e criação aceitam o mesmo corpo; os dados clínicos
// estruturados (dadosClinicos) são validados em checkClinicalPayload.

const DraftSurgeryBody = z.object({
  id: z.number().int().nullish(),
  patientId: z.number().int().nullish(),
  dataCirurgia: z.string().nullish(),
  hospital: z.string().nullish(),
  lado: z.string().nullish(),
  tipoCaso: z.string().nullish(),
  diagnostico: z.string().nullish(),
  tiposProcedimento: z.array(z.string()).nullish(),
  procedimentoRealizado: z.string().nullish(),
  observacoes: z.string().nullish(),
  regiao: z.enum(["shoulder", "elbow"]).nullish(),
  dadosClinicos: z.record(z.string(), z.any()).nullish(),
});

const UpdateSurgeryWithClinicalBody = z.object({
  dataCirurgia: z.string().optional(),
  hospital: z.string().optional(),
  lado: z.string().nullish(),
  tipoCaso: z.string().optional(),
  diagnostico: z.string().nullish(),
  tiposProcedimento: z.array(z.string()).optional(),
  procedimentoRealizado: z.string().optional(),
  observacoes: z.string().optional(),
  regiao: z.enum(["shoulder", "elbow"]).nullish(),
  dadosClinicos: z.record(z.string(), z.any()).nullish(),
});

function scheduleSource(surgery: typeof surgeriesTable.$inferSelect) {
  return {
    id: surgery.id,
    patientId: surgery.patientId,
    tiposProcedimento: (surgery.tiposProcedimento ?? []) as string[],
    dataCirurgia: surgery.dataCirurgia,
  };
}

router.post("/surgeries/draft", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = DraftSurgeryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (
    typeof parsed.data.patientId === "number" &&
    !(await patientBelongsToDoctor(parsed.data.patientId, req.doctorId!))
  ) {
    res.status(404).json({ error: localizedMessage(locale, "patientNotFound") });
    return;
  }
  // Rascunho aceita dados clínicos incompletos, mas com a forma correta
  const clinicalDraft = checkClinicalPayload(parsed.data.dadosClinicos, parsed.data, false);
  if (!clinicalDraft.ok) {
    res.status(clinicalDraft.status).json(clinicalDraft.body);
    return;
  }
  if (clinicalDraft.payload) {
    parsed.data.dadosClinicos = clinicalDraft.payload as unknown as Record<string, unknown>;
    parsed.data.regiao = clinicalDraft.payload.regiao;
  }

  try {
    const { id, ...surgeryFields } = parsed.data;

    let surgery: typeof surgeriesTable.$inferSelect;

    if (id) {
      const updated = await updateSurgeryWithLifecycleLock(
        id,
        req.doctorId!,
        { ...(surgeryFields as any), status: "rascunho" },
      );
      if (!updated) {
        res.status(404).json({ error: localizedMessage(locale, "draftNotFound") });
        return;
      }
      surgery = updated;
    } else {
      if (!surgeryFields.patientId) {
        res.status(400).json({ error: localizedMessage(locale, "selectPatientForDraft") });
        return;
      }
      const [created] = await db
        .insert(surgeriesTable)
        .values({ ...surgeryFields, patientId: surgeryFields.patientId, doctorId: req.doctorId!, tiposProcedimento: surgeryFields.tiposProcedimento ?? [], status: "rascunho" })
        .returning();
      surgery = created;
    }

    if (hasFractureProcedure(surgery.tiposProcedimento as string[] | null)) {
      await removePreoperativeNotifications(surgery.id);
    }

    res.json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
  } catch (err) {
    console.error("[POST /surgeries/draft]", err);
    res.status(500).json({ error: localizedMessage(locale, "draftSaveFailed") });
  }
});

router.post("/surgeries/:id/finalize", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }

  const parsed = DraftSurgeryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }

  if (
    typeof parsed.data.patientId === "number" &&
    !(await patientBelongsToDoctor(parsed.data.patientId, req.doctorId!))
  ) {
    res.status(404).json({ error: localizedMessage(locale, "patientNotFound") });
    return;
  }

  // Finalizar exige o registro de ombro/cotovelo completo e válido
  const clinicalFinal = checkClinicalPayload(parsed.data.dadosClinicos, parsed.data, true);
  if (!clinicalFinal.ok) {
    res.status(clinicalFinal.status).json(clinicalFinal.body);
    return;
  }
  parsed.data.dadosClinicos = clinicalFinal.payload as unknown as Record<string, unknown>;
  parsed.data.regiao = clinicalFinal.payload!.regiao;

  const { id: _draftId, ...surgeryData } = parsed.data;

  try {
    const surgery = await updateSurgeryWithLifecycleLock(
      id,
      req.doctorId!,
      { ...(surgeryData as any), status: "completo" },
    );

    if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }

    await syncSurgerySchedule(scheduleSource(surgery));

    res.json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
  } catch (err) {
    console.error("[POST /surgeries/:id/finalize]", err);
    res.status(500).json({ error: localizedMessage(locale, "surgeryFinalizeFailed") });
  }
});

router.get("/surgeries", requireAuth, async (req, res): Promise<void> => {
  const surgeries = await db
    .select({
      surgery: surgeriesTable,
      patientNome: patientsTable.nome,
      patientSexo: patientsTable.sexo,
      patientLado: patientsTable.lado,
    })
    .from(surgeriesTable)
    .leftJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .where(eq(surgeriesTable.doctorId, req.doctorId!))
    .orderBy(sql`${surgeriesTable.dataCirurgia} DESC NULLS LAST`, desc(surgeriesTable.createdAt));

  const result = surgeries.map(({ surgery, patientNome, patientSexo, patientLado }) => ({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patientNome: patientNome ?? "",
    patientSexo,
    patientLado,
  }));

  res.json(result);
});

router.post("/surgeries", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = DraftSurgeryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }

  if (!parsed.data.patientId) {
    res.status(400).json({ error: localizedMessage(locale, "patientIdRequired") });
    return;
  }

  if (!(await patientBelongsToDoctor(parsed.data.patientId, req.doctorId!))) {
    res.status(404).json({ error: localizedMessage(locale, "patientNotFound") });
    return;
  }

  // Criar cirurgia completa exige o registro de ombro/cotovelo completo e válido
  const clinicalCreate = checkClinicalPayload(parsed.data.dadosClinicos, parsed.data, true);
  if (!clinicalCreate.ok) {
    res.status(clinicalCreate.status).json(clinicalCreate.body);
    return;
  }
  parsed.data.dadosClinicos = clinicalCreate.payload as unknown as Record<string, unknown>;
  parsed.data.regiao = clinicalCreate.payload!.regiao;

  const { id: _draftId, ...surgeryData } = parsed.data;

  const [surgery] = await db.insert(surgeriesTable).values({
    ...surgeryData,
    patientId: surgeryData.patientId!,
    tiposProcedimento: surgeryData.tiposProcedimento ?? [],
    doctorId: req.doctorId!,
  }).returning();

  await syncSurgerySchedule(scheduleSource(surgery));

  res.status(201).json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
});

router.post("/surgeries/:id/schedule/preop", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }

  const [surgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(
      eq(surgeriesTable.id, id),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);

  if (hasFractureProcedure(surgery.tiposProcedimento as string[] | null)) {
    await removePreoperativeNotifications(id);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  const notification = await ensurePreoperativeNotification(scheduleSource(surgery));

  if (!notification) {
    res.status(422).json({ error: localizedMessage(await localeForDoctorId(surgery.doctorId), "preoperativeProtocolUnavailable") });
    return;
  }
  res.json(notification);
});

router.post("/surgeries/:id/schedule/generate", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }
  const [surgery] = await db.select().from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);
  const rows = await syncSurgerySchedule(scheduleSource(surgery));
  res.json(rows);
});

router.get("/surgeries/:id/schedule", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }
  const [surgery] = await db.select({
    id: surgeriesTable.id,
    doctorId: surgeriesTable.doctorId,
    tiposProcedimento: surgeriesTable.tiposProcedimento,
  }).from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);

  if (hasFractureProcedure(surgery.tiposProcedimento as string[] | null)) {
    await removePreoperativeNotifications(id);
  }

  const rows = await db
    .select()
    .from(scheduledNotificationsTable)
    .where(eq(scheduledNotificationsTable.surgeryId, id))
    .orderBy(scheduledNotificationsTable.daysAfterSurgery);
  res.json(
    hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
      ? rows.filter((row) => !isPreoperativePeriod(row.periodo))
      : rows,
  );
});

// GET preview of whatsapp message before sending (also creates the followup/token)
router.post("/surgeries/:id/schedule/:notifId/prepare-whatsapp", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const notifId = parseInt(String(req.params.notifId ?? ""), 10);

  const [row] = await db
    .select({ notif: scheduledNotificationsTable, patient: patientsTable, surgery: surgeriesTable, doctor: doctorsTable })
    .from(scheduledNotificationsTable)
    .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
    .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(and(
      eq(scheduledNotificationsTable.id, notifId),
      eq(scheduledNotificationsTable.surgeryId, surgeryId),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ));

  if (!row) { res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") }); return; }
  locale = resolveDoctorLocale(row.doctor.idioma);

  if (
    hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
    && isPreoperativePeriod(row.notif.periodo)
  ) {
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  let followup: typeof followupTable.$inferSelect | null;
  try {
    followup = await ensureFollowupForNotification(surgeryId, notifId);
  } catch (error) {
    if (!(error instanceof PreoperativeFractureError)) throw error;
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (!followup?.token) {
    res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") });
    return;
  }

  const link = buildRequestAppLink(req, getBaseUrl(req), `/patient/${followup.token}`);

  const message = buildFollowupMessage({
    patientName: row.patient.nome,
    periodo: row.notif.periodo,
    scales: filterSupportedFollowupScales(row.notif.scales),
    link,
    doctorName: row.doctor.nome,
    locale: resolveDoctorLocale(row.doctor.idioma),
  });

  res.json({ token: followup.token, link, message, followupId: followup.id, hasTelefone: !!row.patient.telefone });
});

router.post("/surgeries/:id/schedule/:notifId/whatsapp", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const notifId = parseInt(String(req.params.notifId ?? ""), 10);
  const { customMessage, followupId } = req.body as { customMessage?: string; followupId?: number };

  const [row] = await db
    .select({ notif: scheduledNotificationsTable, patient: patientsTable, surgery: surgeriesTable, doctor: doctorsTable })
    .from(scheduledNotificationsTable)
    .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
    .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(and(
      eq(scheduledNotificationsTable.id, notifId),
      eq(scheduledNotificationsTable.surgeryId, surgeryId),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ));

  if (!row) { res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") }); return; }
  locale = resolveDoctorLocale(row.doctor.idioma);

  if (
    hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
    && isPreoperativePeriod(row.notif.periodo)
  ) {
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  if (!row.patient.telefone) {
    res.status(400).json({ error: localizedMessage(locale, "patientNoPhone") });
    return;
  }

  // Use pre-created followup or create a new one
  if (
    followupId !== undefined &&
    (!Number.isInteger(followupId) || followupId <= 0)
  ) {
    res.status(400).json({ error: localizedMessage(locale, "invalidFollowupId") });
    return;
  }

  let existingF: typeof followupTable.$inferSelect | null;
  try {
    existingF = await ensureFollowupForNotification(surgeryId, notifId, followupId);
  } catch (error) {
    if (!(error instanceof PreoperativeFractureError)) throw error;
    await removePreoperativeNotifications(surgeryId);
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (!existingF?.token) { res.status(404).json({ error: localizedMessage(locale, "followupNotFound") }); return; }

  const sendOutcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const [locked] = await tx
      .select({ notif: scheduledNotificationsTable, patient: patientsTable, surgery: surgeriesTable, doctor: doctorsTable })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
      .where(and(
        eq(scheduledNotificationsTable.id, notifId),
        eq(scheduledNotificationsTable.surgeryId, surgeryId),
        eq(surgeriesTable.doctorId, req.doctorId!),
      ))
      .for("update")
      .limit(1);
    if (!locked) return { kind: "missing" as const };
    if (
      hasFractureProcedure(locked.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(locked.notif.periodo)
    ) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, notifId));
      return { kind: "blocked" as const };
    }
    if (!locked.patient.telefone) return { kind: "no_phone" as const };

    const link = buildRequestAppLink(req, getBaseUrl(req), `/patient/${existingF.token}`);
    const text = customMessage ?? buildFollowupMessage({
      patientName: locked.patient.nome,
      periodo: locked.notif.periodo,
      scales: filterSupportedFollowupScales(locked.notif.scales),
      link,
      doctorName: locked.doctor.nome,
      locale: resolveDoctorLocale(locked.doctor.idioma),
    });
    const result = await sendWhatsAppText(locked.patient.telefone, text, {
      idempotencyKey: `scheduled-notification:${notifId}`,
    });
    if (result.ok) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "sent", sentAt: new Date(), followupId: existingF.id, whatsappMessageId: result.messageId })
        .where(eq(scheduledNotificationsTable.id, notifId));
    }
    return { kind: "sent" as const, result };
  });

  if (sendOutcome.kind === "missing") {
    res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") });
  } else if (sendOutcome.kind === "blocked") {
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
  } else if (sendOutcome.kind === "no_phone") {
    res.status(400).json({ error: localizedMessage(locale, "patientNoPhone") });
  } else if (sendOutcome.result.ok) {
    res.json({ ok: true, followupId: existingF.id, messageId: sendOutcome.result.messageId });
  } else {
    res.status(502).json({ ok: false, error: localizedMessage(locale, "sendFailed") });
  }
});

router.patch("/surgeries/:id/schedule/:notifId/status", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const notifId = parseInt(String(req.params.notifId ?? ""), 10);
  const { status } = req.body as { status: string };
  if (!["pending", "sent", "skipped", "completed"].includes(status)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidStatus") }); return;
  }
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${surgeryId} AS integer))`,
    );
    const [owned] = await tx
      .select({
        notification: scheduledNotificationsTable,
        surgery: surgeriesTable,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(and(
        eq(scheduledNotificationsTable.id, notifId),
        eq(scheduledNotificationsTable.surgeryId, surgeryId),
        eq(surgeriesTable.doctorId, req.doctorId!),
      ))
      .for("update")
      .limit(1);
    if (!owned) return { kind: "missing" as const };
    if (
      hasFractureProcedure(owned.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(owned.notification.periodo)
    ) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, notifId));
      return { kind: "blocked" as const, doctorId: owned.surgery.doctorId };
    }

    const [updated] = await tx
      .update(scheduledNotificationsTable)
      .set({ status, ...(status === "sent" ? { sentAt: new Date() } : {}) })
      .where(eq(scheduledNotificationsTable.id, notifId))
      .returning();
    return { kind: "updated" as const, updated, doctorId: owned.surgery.doctorId };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: localizedMessage(locale, "appointmentNotFound") });
    return;
  }
  locale = await localeForDoctorId(outcome.doctorId);
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: localizedMessage(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  res.json(outcome.updated);
});

router.get("/surgeries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidId") });
    return;
  }

  const [surgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);

  if (!surgery) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, surgery.patientId)).limit(1);
  const followups = await db.select().from(followupTable).where(eq(followupTable.surgeryId, id)).orderBy(followupTable.createdAt);
  const visibleFollowups = hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
    ? followups.filter((followup) => !isPreoperativePeriod(followup.tempo))
    : followups;
  const followupIds = visibleFollowups.map((f) => f.id);
  const [clinicianScales, patientScales] = await Promise.all([
    loadClinicianScales(followupIds),
    loadPatientScales(followupIds),
  ]);

  res.json({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patient: patient ? { ...patient, createdAt: patient.createdAt.toISOString() } : null,
    followups: visibleFollowups.map(f => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      escalasClinicas: clinicianScales.get(f.id) ?? [],
      escalasPaciente: patientScales.get(f.id) ?? [],
    })),
  });
});

router.patch("/surgeries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidId") });
    return;
  }

  const parsed = UpdateSurgeryWithClinicalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: localizedMessage(locale, "invalidData") });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: localizedMessage(locale, "noValidSurgeryFields") });
    return;
  }

  const [existingSurgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!existingSurgery) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }
  // Dados clínicos alterados por PATCH seguem as mesmas regras da finalização
  if (parsed.data.dadosClinicos !== undefined) {
    const complete = existingSurgery.status !== "rascunho";
    const clinical = checkClinicalPayload(parsed.data.dadosClinicos, { ...existingSurgery, ...parsed.data }, complete);
    if (!clinical.ok) {
      res.status(clinical.status).json(clinical.body);
      return;
    }
    if (clinical.payload) {
      parsed.data.dadosClinicos = clinical.payload as unknown as Record<string, unknown>;
      parsed.data.regiao = clinical.payload.regiao;
    }
  }

  const surgery = await updateSurgeryWithLifecycleLock(
    id,
    req.doctorId!,
    parsed.data as Record<string, unknown>,
  );

  if (!surgery) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }

  // Se a data da cirurgia foi alterada, recalcula o calendário de follow-up
  if (
    parsed.data.dataCirurgia !== undefined
    || "tiposProcedimento" in parsed.data
  ) {
    await syncSurgerySchedule(scheduleSource(surgery));
  }

  res.json({ ...surgery, createdAt: surgery.createdAt.toISOString() });
});

router.delete("/surgeries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: localizedMessage(locale, "invalidId") });
    return;
  }

  const [deleted] = await db
    .delete(surgeriesTable)
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") });
    return;
  }

  res.status(200).json({ success: true });
});

// PATCH /surgeries/:id/followups/:fId — doctor updates ADM + complications + notes
router.patch("/surgeries/:id/followups/:fId", requireAuth, async (req, res): Promise<void> => {
  let locale = await localeForDoctorId(req.doctorId);
  const surgeryId = parseInt(String(req.params.id ?? ""), 10);
  const fId = parseInt(String(req.params.fId ?? ""), 10);
  if (isNaN(surgeryId) || isNaN(fId)) { res.status(400).json({ error: localizedMessage(locale, "invalidId") }); return; }

  // Verify surgery belongs to this doctor
  const [surgery] = await db.select({ id: surgeriesTable.id, doctorId: surgeriesTable.doctorId }).from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: localizedMessage(locale, "surgeryNotFound") }); return; }
  locale = await localeForDoctorId(surgery.doctorId);

  const { admFlexao, admExtensao, complicacoes, observacoes } = req.body as {
    admFlexao?: number | null;
    admExtensao?: number | null;
    complicacoes?: string[];
    observacoes?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (admFlexao !== undefined) patch.admFlexao = admFlexao === null ? null : Number(admFlexao);
  if (admExtensao !== undefined) patch.admExtensao = admExtensao === null ? null : Number(admExtensao);
  if (complicacoes !== undefined) patch.complicacoes = complicacoes;
  if (observacoes !== undefined) patch.observacoes = observacoes;

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: localizedMessage(locale, "noFollowupFields") }); return; }

  const [updated] = await db
    .update(followupTable)
    .set(patch)
    .where(and(
      eq(followupTable.id, fId),
      eq(followupTable.surgeryId, surgeryId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ error: localizedMessage(locale, "followupNotFound") }); return; }

  res.json(updated);
});

export default router;

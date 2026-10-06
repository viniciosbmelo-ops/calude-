import { Router, type IRouter } from "express";
import {
  db,
  patientAttachmentsTable,
  patientsTable,
  physioPatientsTable,
  regenCasesTable,
  surgeriesTable,
  surgeryMediaTable,
  uploadGrantsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireDoctorOrSecretary } from "../middlewares/requireAuth";
import { CreatePatientBody, UpdatePatientBody } from "@workspace/api-zod";
import {
  enqueueStorageCleanup,
  processStorageCleanupJobs,
} from "../lib/storageCleanup";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";

const router: IRouter = Router();

function normalizePatientName(nome: string): string {
  return nome.trim().toLocaleUpperCase("pt-BR");
}

/**
 * LGPD Art. 11: perfil clínico do cadastro (lado dominante, tabagismo, diabetes, nível de atividade)
 * é dado de saúde sensível e fica restrito ao médico. Secretárias não o recebem nas respostas
 * nem conseguem gravá-lo.
 */
const SENSITIVE_PATIENT_PROFILE_FIELDS = [
  "ladoDominante",
  "tabagismo",
  "diabetes",
  "nivelAtividade",
] as const;

type SensitiveProfileField = (typeof SENSITIVE_PATIENT_PROFILE_FIELDS)[number];

function isSecretaryRequest(req: { role?: string }): boolean {
  return req.role === "secretary";
}

/** Remove (omite) os campos do perfil clínico sensível; os campos são opcionais no contrato. */
function stripSensitivePatientProfile<T extends object>(value: T): Omit<T, SensitiveProfileField> {
  const copy = { ...value } as Record<string, unknown>;
  for (const field of SENSITIVE_PATIENT_PROFILE_FIELDS) delete copy[field];
  return copy as Omit<T, SensitiveProfileField>;
}

router.get("/patients", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const patients = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.doctorId, req.doctorId!))
    .orderBy(sql`lower(${patientsTable.nome}) COLLATE "pt-BR-x-icu"`, patientsTable.id);

  const result = await Promise.all(patients.map(async (patient) => {
    const surgeries = await db
      .select()
      .from(surgeriesTable)
      .where(eq(surgeriesTable.patientId, patient.id))
      .orderBy(sql`${surgeriesTable.dataCirurgia} DESC NULLS LAST`, desc(surgeriesTable.createdAt));

    const visiblePatient = isSecretaryRequest(req) ? stripSensitivePatientProfile(patient) : patient;
    return {
      ...visiblePatient,
      createdAt: patient.createdAt.toISOString(),
      surgeries: surgeries.map(s => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }));

  res.json(result);
});

router.post("/patients", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidPatientData") });
    return;
  }

  // Secretária: os campos do perfil clínico sensível são ignorados em silêncio (não 403), para que
  // um formulário antigo ou um valor residual não impeça o cadastro administrativo. O médico os
  // preenche depois em PATCH /patients/:id (somente médico).
  const data = isSecretaryRequest(req) ? stripSensitivePatientProfile(parsed.data) : parsed.data;

  const [patient] = await db.insert(patientsTable).values({
    ...data,
    nome: normalizePatientName(parsed.data.nome),
    doctorId: req.doctorId!,
  }).returning();

  // Generate registro number: PAC-YYYY-NNNNN
  const year = patient.createdAt.getFullYear();
  const numeroRegistro = `PAC-${year}-${String(patient.id).padStart(5, "0")}`;
  const [updated] = await db
    .update(patientsTable)
    .set({ numeroRegistro })
    .where(eq(patientsTable.id, patient.id))
    .returning();

  const visible = isSecretaryRequest(req) ? stripSensitivePatientProfile(updated) : updated;
  res.status(201).json({ ...visible, createdAt: updated.createdAt.toISOString() });
});

router.get("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, id), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);

  if (!patient) {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }

  const surgeries = await db
    .select()
    .from(surgeriesTable)
    .where(eq(surgeriesTable.patientId, patient.id))
    .orderBy(sql`${surgeriesTable.dataCirurgia} DESC NULLS LAST`, desc(surgeriesTable.createdAt));

  res.json({
    ...patient,
    createdAt: patient.createdAt.toISOString(),
    surgeries: surgeries.map(s => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

router.patch("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidPatientData") });
    return;
  }

  const patientData = parsed.data.nome === undefined
    ? parsed.data
    : { ...parsed.data, nome: normalizePatientName(parsed.data.nome) };

  const [patient] = await db
    .update(patientsTable)
    .set(patientData)
    .where(and(eq(patientsTable.id, id), eq(patientsTable.doctorId, req.doctorId!)))
    .returning();

  if (!patient) {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }

  res.json({ ...patient, createdAt: patient.createdAt.toISOString() });
});

router.delete("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Lock the parent before collecting paths. New FK-backed uploads then wait
    // for this transaction and cannot slip in between collection and deletion.
    const [existing] = await tx
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(
        eq(patientsTable.id, id),
        eq(patientsTable.doctorId, req.doctorId!),
      ))
      .for("update");
    if (!existing) return { found: false as const, cleanupJobs: 0 };

    const attachments = await tx
      .select({ objectPath: patientAttachmentsTable.objectPath })
      .from(patientAttachmentsTable)
      .where(and(
        eq(patientAttachmentsTable.patientId, id),
        eq(patientAttachmentsTable.doctorId, req.doctorId!),
      ));
    const media = await tx
      .select({
        originalPath: surgeryMediaTable.originalPath,
        previewPath: surgeryMediaTable.previewPath,
      })
      .from(surgeryMediaTable)
      .innerJoin(surgeriesTable, eq(surgeryMediaTable.surgeryId, surgeriesTable.id))
      .where(and(
        eq(surgeriesTable.patientId, id),
        eq(surgeriesTable.doctorId, req.doctorId!),
      ));
    const uploadGrants = await tx
      .select({ objectPath: uploadGrantsTable.objectPath })
      .from(uploadGrantsTable)
      .where(and(
        eq(uploadGrantsTable.patientId, id),
        eq(uploadGrantsTable.doctorId, req.doctorId!),
      ));

    const cleanupJobs = await enqueueStorageCleanup(tx, [
      ...attachments.map((item) => item.objectPath),
      ...media.flatMap((item) => [item.originalPath, item.previewPath]),
      ...uploadGrants.map((item) => item.objectPath),
    ]);

    // Delete direct relations that predate their database cascade constraint.
    // Their dependent records are cascaded by their own case/patient foreign keys.
    await tx
      .delete(regenCasesTable)
      .where(and(
        eq(regenCasesTable.patientId, id),
        eq(regenCasesTable.doctorId, req.doctorId!),
      ));

    // A physiotherapy patient can reference this patient and its care link.
    // Remove it first so the patient deletion cannot leave a private rehab record behind.
    await tx
      .delete(physioPatientsTable)
      .where(eq(physioPatientsTable.patientId, id));

    // The patient delete cascades surgeries, exams, follow-ups, agenda entries,
    // attachments, upload grants, care links, invitations, and surgery media.
    await tx
      .delete(patientsTable)
      .where(and(eq(patientsTable.id, id), eq(patientsTable.doctorId, req.doctorId!)));
    return { found: true as const, cleanupJobs };
  });

  if (!result.found) {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }

  // Best-effort immediate drain; durable rows keep retrying after any outage.
  void processStorageCleanupJobs().then((cleanup) => {
    if (cleanup.failed > 0) {
      req.log.warn(
        { patientId: id, failed: cleanup.failed },
        "Arquivos do paciente permaneceram na fila de exclusão",
      );
    }
  }).catch((error) => {
    req.log.warn({ err: error, patientId: id }, "Falha ao processar fila de exclusão");
  });

  res.sendStatus(204);
});

export default router;

import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@workspace/api-zod";
import {
  db,
  doctorsTable,
  patientAttachmentsTable,
  patientsTable,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
} from "@workspace/db";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { requireAuth, requireDoctorOrSecretary } from "../middlewares/requireAuth";
import {
  checkLockout,
  clearLockout,
  getPatientSession,
  issuePatientSession,
  recordFailedAttempt,
} from "../lib/patient-session";
import { getBaseUrl } from "../lib/base-url";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  abandonGrantAndEnqueueCleanup,
  claimGrant,
  createGrant,
  findAvailableGrant,
} from "../lib/uploadGrants";
import { enqueueStorageCleanup, lockStoragePath } from "../lib/storageCleanup";
import { validateUploadedObject } from "../lib/validateUploadedObject";
import { localeForDoctorId, resolveDoctorLocale } from "../lib/locale";
import { message } from "../lib/locale-catalog";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const QUESTIONNAIRE_VERSION = 1;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRE_CONSULT_LOCK_NAMESPACE = 87004;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PRE_CONSULT_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const boundedText = (max: number) => z.string().max(max).default("");
const stringList = <T extends [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).max(values.length).default([]);

export const PreConsultAnswersSchema = z.object({
  sobreVoce: boundedText(4_000),
  queixaPrincipal: boundedText(4_000),
  tempoProblema: boundedText(1_000),
  inicioSintomasTipo: z
    .enum(["", "trauma", "atividade_fisica", "progressivo", "pos_cirurgia", "outro"])
    .default(""),
  inicioSintomasDescricao: boundedText(2_000),
  localProblema: boundedText(2_000),
  caracteristicaDor: boundedText(2_000),
  intensidadeDor: z.number().int().min(0).max(10).nullable().default(null),
  pioraSintomas: stringList([
    "caminhar",
    "escadas",
    "agachar",
    "correr",
    "esporte",
    "sentado",
    "em_pe",
    "noite",
    "outro",
  ]),
  pioraSintomasOutro: boundedText(1_000),
  melhoraSintomas: boundedText(2_000),
  limitacoesDiarias: boundedText(3_000),
  condicoesSaude: boundedText(3_000),
  medicamentos: boundedText(3_000),
  alergias: boundedText(2_000),
  cirurgiasPrevias: boundedText(4_000),
  complicacoes: boundedText(3_000),
  tratamentosPrevios: stringList([
    "fisioterapia",
    "medicamentos",
    "infiltracao",
    "acido_hialuronico",
    "prp",
    "bma",
    "gordura_microfragmentada",
    "cirurgia",
    "outro",
  ]),
  tratamentosDescricao: boundedText(4_000),
  cirurgiaRegiaoAfetada: boundedText(3_000),
  ortobiologicos: stringList(["prp", "bma", "gordura_microfragmentada", "outro"]),
  ortobiologicosDescricao: boundedText(3_000),
  examesPossui: stringList([
    "radiografia",
    "ressonancia",
    "tomografia",
    "ultrassom",
    "laboratoriais",
    "outro",
  ]),
  examesInfo: boundedText(3_000),
  outrasInformacoesMedicas: boundedText(3_000),
  objetivoTratamento: z
    .enum([
      "",
      "reduzir_dor",
      "caminhar_melhor",
      "retornar_trabalho",
      "atividade_fisica",
      "retornar_esporte",
      "evitar_cirurgia",
      "avaliar_cirurgia",
      "outro",
    ])
    .default(""),
  objetivoTratamentoOutro: boundedText(1_000),
  preocupacaoCirurgia: boundedText(3_000),
  expectativaConsulta: boundedText(3_000),
  observacoes: boundedText(4_000),
}).strict();

type PreConsultAnswers = z.infer<typeof PreConsultAnswersSchema>;

/**
 * Canonical questionnaire contract: 25 patient-visible questions.
 *
 * Some questions intentionally map to multiple structured storage fields, and
 * question 20 maps to attachment records rather than JSON. The flattened JSON
 * keys therefore total 30 without changing the visible question count.
 */
export const PRE_CONSULT_QUESTIONS = [
  { number: 1, answerKeys: ["sobreVoce"] },
  { number: 2, answerKeys: ["queixaPrincipal"] },
  { number: 3, answerKeys: ["tempoProblema"] },
  { number: 4, answerKeys: ["inicioSintomasTipo", "inicioSintomasDescricao"] },
  { number: 5, answerKeys: ["localProblema"] },
  { number: 6, answerKeys: ["caracteristicaDor"] },
  { number: 7, answerKeys: ["intensidadeDor"] },
  { number: 8, answerKeys: ["pioraSintomas", "pioraSintomasOutro"] },
  { number: 9, answerKeys: ["melhoraSintomas"] },
  { number: 10, answerKeys: ["limitacoesDiarias"] },
  { number: 11, answerKeys: ["condicoesSaude"] },
  { number: 12, answerKeys: ["medicamentos"] },
  { number: 13, answerKeys: ["alergias"] },
  { number: 14, answerKeys: ["cirurgiasPrevias"] },
  { number: 15, answerKeys: ["complicacoes"] },
  { number: 16, answerKeys: ["tratamentosPrevios", "tratamentosDescricao"] },
  { number: 17, answerKeys: ["cirurgiaRegiaoAfetada"] },
  { number: 18, answerKeys: ["ortobiologicos", "ortobiologicosDescricao"] },
  { number: 19, answerKeys: ["examesPossui", "examesInfo"] },
  { number: 20, answerKeys: [] },
  { number: 21, answerKeys: ["outrasInformacoesMedicas"] },
  { number: 22, answerKeys: ["objetivoTratamento", "objetivoTratamentoOutro"] },
  { number: 23, answerKeys: ["preocupacaoCirurgia"] },
  { number: 24, answerKeys: ["expectativaConsulta"] },
  { number: 25, answerKeys: ["observacoes"] },
] as const satisfies ReadonlyArray<{
  number: number;
  answerKeys: ReadonlyArray<keyof PreConsultAnswers>;
}>;

const AnswersBodySchema = z.object({
  answers: PreConsultAnswersSchema,
}).strict();

const VerifyBodySchema = z.object({
  cpf: z.string().min(1).max(32),
}).strict();

const UploadRequestSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  mimeType: z.string().min(1).max(100),
}).strict();

const FinalizeUploadSchema = z.object({
  uploadToken: z.string().min(32).max(200),
}).strict();

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parsePositiveId(value: string | string[] | undefined): number | null {
  const parsed = Number.parseInt(routeParam(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeFilename(name: string): string | null {
  if (/[/\\]/.test(name)) return null;
  const base = name.trim();
  if (!base || base === "." || base === ".." || base.length > 255) return null;
  if (!/^[\p{L}\p{N}_.\-\s()[\]{}@!+=#^~,']+$/u.test(base)) return null;
  return base;
}

async function localeForInvite(invite: { doctorId: number } | null): Promise<ReturnType<typeof resolveDoctorLocale>> {
  return localeForDoctorId(invite?.doctorId);
}

async function requireBoundPatientSession(
  req: Request,
  res: Response,
  rawToken: string,
): Promise<boolean> {
  const session = getPatientSession(req);
  if (
    session?.tokenType !== "preconsult" ||
    session.linkToken !== rawToken
  ) {
    res.status(401).json({ error: message(await localeForInvite(rawToken ? await findInvite(rawToken, true) : null), "confirmCpf") });
    return false;
  }
  return true;
}

async function findInvite(rawToken: string, includeSubmitted = false) {
  const allowedStatuses = includeSubmitted ? ["active", "submitted"] : ["active"];
  const [invite] = await db
    .select()
    .from(preConsultInvitesTable)
    .where(and(
      eq(preConsultInvitesTable.tokenHash, tokenHash(rawToken)),
      inArray(preConsultInvitesTable.status, allowedStatuses),
      gt(preConsultInvitesTable.expiresAt, new Date()),
    ))
    .limit(1);
  return invite ?? null;
}

async function lockPatient<T>(
  patientId: number,
  operation: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${PRE_CONSULT_LOCK_NAMESPACE}, CAST(${patientId} AS integer))`,
    );
    return operation(tx);
  });
}

function questionnaireResponse(questionnaire: typeof preConsultQuestionnairesTable.$inferSelect) {
  return {
    id: questionnaire.id,
    status: questionnaire.status,
    questionnaireVersion: questionnaire.questionnaireVersion,
    patientAnswers: questionnaire.patientAnswers,
    currentAnswers: questionnaire.currentAnswers,
    lastPatientSavedAt: questionnaire.lastPatientSavedAt,
    submittedAt: questionnaire.submittedAt,
    doctorEditedAt: questionnaire.doctorEditedAt,
    createdAt: questionnaire.createdAt,
    updatedAt: questionnaire.updatedAt,
  };
}

// ── Physician endpoints ──────────────────────────────────────────────────────

router.get("/patients/:id/pre-consult", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const patientId = parsePositiveId(req.params.id);
  if (!patientId) {
    res.status(400).json({ error: message(locale, "invalidPatient") });
    return;
  }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(
      eq(patientsTable.id, patientId),
      eq(patientsTable.doctorId, req.doctorId!),
    ))
    .limit(1);
  if (!patient) {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }

  const [questionnaire] = await db
    .select()
    .from(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.patientId, patientId))
    .limit(1);

  const [latestInvite] = await db
    .select()
    .from(preConsultInvitesTable)
    .where(and(
      eq(preConsultInvitesTable.patientId, patientId),
      eq(preConsultInvitesTable.doctorId, req.doctorId!),
    ))
    .orderBy(desc(preConsultInvitesTable.createdAt))
    .limit(1);

  const attachments = questionnaire
    ? await db
      .select()
      .from(patientAttachmentsTable)
      .where(and(
        eq(patientAttachmentsTable.patientId, patientId),
        eq(patientAttachmentsTable.doctorId, req.doctorId!),
        eq(patientAttachmentsTable.preConsultQuestionnaireId, questionnaire.id),
      ))
      .orderBy(desc(patientAttachmentsTable.createdAt))
    : [];

  const attachmentResults = await Promise.all(attachments.map(async (attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    createdAt: attachment.createdAt,
    url: await storage.getSignedGetUrl(attachment.objectPath, 3_600),
  })));

  res.json({
    questionnaire: questionnaire ? questionnaireResponse(questionnaire) : null,
    invite: latestInvite ? {
      id: latestInvite.id,
      status:
        latestInvite.status === "active" && latestInvite.expiresAt <= new Date()
          ? "expired"
          : latestInvite.status,
      expiresAt: latestInvite.expiresAt,
      createdAt: latestInvite.createdAt,
      revokedAt: latestInvite.revokedAt,
    } : null,
    attachments: attachmentResults,
  });
});

router.post("/patients/:id/pre-consult/invite", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const patientId = parsePositiveId(req.params.id);
  if (!patientId) {
    res.status(400).json({ error: message(locale, "invalidPatient") });
    return;
  }

  const outcome = await lockPatient(patientId, async (tx) => {
  const [patient] = await tx
      .select({ id: patientsTable.id, cpf: patientsTable.cpf })
      .from(patientsTable)
      .where(and(
        eq(patientsTable.id, patientId),
        eq(patientsTable.doctorId, req.doctorId!),
      ))
      .limit(1);

    if (!patient) return { kind: "not_found" as const };
    if (!isValidCpf(patient.cpf)) return { kind: "cpf_invalid" as const };

    let [questionnaire] = await tx
      .select()
      .from(preConsultQuestionnairesTable)
      .where(eq(preConsultQuestionnairesTable.patientId, patientId))
      .limit(1);

    if (questionnaire?.status === "submitted") {
      return { kind: "already_submitted" as const };
    }

    if (!questionnaire) {
      [questionnaire] = await tx
        .insert(preConsultQuestionnairesTable)
        .values({
          patientId,
          doctorId: req.doctorId!,
          questionnaireVersion: QUESTIONNAIRE_VERSION,
        })
        .returning();
    }

    const now = new Date();
    await tx
      .update(preConsultInvitesTable)
      .set({ status: "revoked", revokedAt: now })
      .where(and(
        eq(preConsultInvitesTable.questionnaireId, questionnaire.id),
        eq(preConsultInvitesTable.status, "active"),
      ));

    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const [invite] = await tx
      .insert(preConsultInvitesTable)
      .values({
        questionnaireId: questionnaire.id,
        patientId,
        doctorId: req.doctorId!,
        tokenHash: tokenHash(rawToken),
        expiresAt,
      })
      .returning();

    const [doctor] = await tx
      .select({ idioma: doctorsTable.idioma })
      .from(doctorsTable)
      .where(eq(doctorsTable.id, req.doctorId!))
      .limit(1);
    return { kind: "created" as const, rawToken, expiresAt, inviteId: invite.id, locale: resolveDoctorLocale(doctor?.idioma) };
  });

  if (outcome.kind === "not_found") {
    res.status(404).json({ error: message(locale, "patientNotFound") });
    return;
  }
  if (outcome.kind === "cpf_invalid") {
    res.status(422).json({
      error: message(locale, "cpfRegistrationRequired"),
    });
    return;
  }
  if (outcome.kind === "already_submitted") {
    res.status(409).json({ error: message(locale, "preConsultSubmitted") });
    return;
  }

  const baseUrl = getBaseUrl(req).replace(/\/$/, "");
  const link = `${baseUrl}/pre-consulta/${outcome.rawToken}`;
  const whatsappMessage = message(outcome.locale, "preConsultInvite", { link });

  res.status(201).json({
    link,
    whatsappMessage,
    expiresAt: outcome.expiresAt,
    inviteId: outcome.inviteId,
  });
});

router.post(
  "/patients/:id/pre-consult/invite/:inviteId/revoke",
  requireAuth,
  async (req, res): Promise<void> => {
    const locale = await localeForDoctorId(req.doctorId);
    const patientId = parsePositiveId(req.params.id);
    const inviteId = parsePositiveId(req.params.inviteId);
    if (!patientId || !inviteId) {
      res.status(400).json({ error: message(locale, "invalidInvite") });
      return;
    }

    const [revoked] = await db
      .update(preConsultInvitesTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(
        eq(preConsultInvitesTable.id, inviteId),
        eq(preConsultInvitesTable.patientId, patientId),
        eq(preConsultInvitesTable.doctorId, req.doctorId!),
        eq(preConsultInvitesTable.status, "active"),
      ))
      .returning({ id: preConsultInvitesTable.id });

    if (!revoked) {
      res.status(404).json({ error: message(locale, "activeInviteNotFound") });
      return;
    }
    res.json({ revoked: true });
  },
);

router.patch("/patients/:id/pre-consult", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const patientId = parsePositiveId(req.params.id);
  const parsed = AnswersBodySchema.safeParse(req.body);
  if (!patientId || !parsed.success) {
    res.status(400).json({ error: message(locale, "invalidAnswers") });
    return;
  }

  const [updated] = await db
    .update(preConsultQuestionnairesTable)
    .set({
      currentAnswers: parsed.data.answers,
      doctorEditedAt: new Date(),
      doctorEditedById: req.doctorId!,
      updatedAt: new Date(),
    })
    .where(and(
      eq(preConsultQuestionnairesTable.patientId, patientId),
      eq(preConsultQuestionnairesTable.doctorId, req.doctorId!),
      eq(preConsultQuestionnairesTable.status, "submitted"),
    ))
    .returning();

  if (!updated) {
    res.status(404).json({ error: message(locale, "preConsultNotFound") });
    return;
  }
  res.json({ questionnaire: questionnaireResponse(updated) });
});

// ── Public patient endpoints ─────────────────────────────────────────────────

router.get("/pre-consult/:token", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  const invite = rawToken ? await findInvite(rawToken, true) : null;
  if (!invite) {
    res.status(404).json({ valid: false, error: message("pt-BR", "invalidLink") });
    return;
  }

  // Locale is selected exclusively from the responsible doctor's profile. It is
  // deliberately not accepted from this public, patient-controlled request.
  const [doctor] = await db
    .select({ idioma: doctorsTable.idioma })
    .from(doctorsTable)
    .where(eq(doctorsTable.id, invite.doctorId))
    .limit(1);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    valid: true,
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    expiresAt: invite.expiresAt,
    submitted: invite.status === "submitted",
      doctorLocale: resolveDoctorLocale(doctor?.idioma),
  });
});

router.post("/pre-consult/:token/verify", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  const parsed = VerifyBodySchema.safeParse(req.body);
  const locale = await localeForInvite(rawToken ? await findInvite(rawToken, true) : null);
  if (!rawToken || !parsed.success || !isValidCpf(parsed.data.cpf)) {
    res.status(400).json({ error: message(locale, "invalidCpf") });
    return;
  }

  const lockedForMs = await checkLockout(req, rawToken);
  if (lockedForMs > 0) {
    res.status(429).json({
      error: message(locale, "tooManyAttempts"),
      retryAfterSeconds: Math.ceil(lockedForMs / 1_000),
    });
    return;
  }

  const invite = await findInvite(rawToken);
  if (!invite) {
    res.status(404).json({ error: message(locale, "invalidLink") });
    return;
  }

  const [patient] = await db
    .select({ cpf: patientsTable.cpf })
    .from(patientsTable)
    .where(eq(patientsTable.id, invite.patientId))
    .limit(1);

  const suppliedCpf = normalizeCpf(parsed.data.cpf);
  const storedCpf = normalizeCpf(patient?.cpf);
  if (!isValidCpf(storedCpf) || suppliedCpf !== storedCpf) {
    await recordFailedAttempt(req, rawToken);
    res.status(401).json({ error: message(locale, "verificationFailed") });
    return;
  }

  await clearLockout(req, rawToken);
  issuePatientSession(res, "preconsult", rawToken);
  await db
    .update(preConsultInvitesTable)
    .set({ lastAccessedAt: new Date() })
    .where(eq(preConsultInvitesTable.id, invite.id));

  res.setHeader("Cache-Control", "no-store");
  res.json({ verified: true });
});

router.get("/pre-consult/:token/form", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  if (!await requireBoundPatientSession(req, res, rawToken)) return;

  const invite = await findInvite(rawToken, true);
  if (!invite) {
    res.status(404).json({ error: message("pt-BR", "invalidLink") });
    return;
  }
  const locale = await localeForInvite(invite);

  const [questionnaire] = await db
    .select()
    .from(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.id, invite.questionnaireId))
    .limit(1);
  if (!questionnaire) {
    res.status(404).json({ error: message(locale, "preConsultNotFound") });
    return;
  }

  const attachments = await db
    .select({
      id: patientAttachmentsTable.id,
      fileName: patientAttachmentsTable.fileName,
      fileSize: patientAttachmentsTable.fileSize,
      mimeType: patientAttachmentsTable.mimeType,
      createdAt: patientAttachmentsTable.createdAt,
    })
    .from(patientAttachmentsTable)
    .where(eq(patientAttachmentsTable.preConsultQuestionnaireId, questionnaire.id))
    .orderBy(desc(patientAttachmentsTable.createdAt));

  res.setHeader("Cache-Control", "no-store");
  res.json({
    status: questionnaire.status,
    answers: questionnaire.status === "submitted"
      ? questionnaire.patientAnswers
      : questionnaire.draftAnswers,
    attachments,
    questionnaireVersion: questionnaire.questionnaireVersion,
    lastSavedAt: questionnaire.lastPatientSavedAt,
    submittedAt: questionnaire.submittedAt,
  });
});

router.patch("/pre-consult/:token/answers", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  if (!await requireBoundPatientSession(req, res, rawToken)) return;

  const invite = await findInvite(rawToken);
  if (!invite) {
    res.status(404).json({ error: message("pt-BR", "invalidLink") });
    return;
  }
  const locale = await localeForInvite(invite);
  const parsed = AnswersBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidAnswers") });
    return;
  }

  const savedAt = new Date();
  const [updated] = await db
    .update(preConsultQuestionnairesTable)
    .set({
      draftAnswers: parsed.data.answers,
      lastPatientSavedAt: savedAt,
      updatedAt: savedAt,
    })
    .where(and(
      eq(preConsultQuestionnairesTable.id, invite.questionnaireId),
      eq(preConsultQuestionnairesTable.status, "draft"),
    ))
    .returning({ id: preConsultQuestionnairesTable.id });

  if (!updated) {
    res.status(409).json({ error: message(locale, "preConsultAlreadySubmitted") });
    return;
  }
  res.json({ saved: true, lastSavedAt: savedAt });
});

router.post("/pre-consult/:token/submit", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  if (!await requireBoundPatientSession(req, res, rawToken)) return;

  const invite = await findInvite(rawToken, true);
  if (!invite) {
    res.status(404).json({ error: message("pt-BR", "invalidLink") });
    return;
  }
  const locale = await localeForInvite(invite);
  const parsed = AnswersBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidAnswers") });
    return;
  }

  const result = await lockPatient(invite.patientId, async (tx) => {
    const [questionnaire] = await tx
      .select()
      .from(preConsultQuestionnairesTable)
      .where(eq(preConsultQuestionnairesTable.id, invite.questionnaireId))
      .limit(1);
    if (!questionnaire) return null;
    if (questionnaire.status === "submitted") {
      return { submittedAt: questionnaire.submittedAt ?? new Date() };
    }

    const submittedAt = new Date();
    const [updated] = await tx
      .update(preConsultQuestionnairesTable)
      .set({
        draftAnswers: parsed.data.answers,
        patientAnswers: parsed.data.answers,
        currentAnswers: parsed.data.answers,
        status: "submitted",
        submittedAt,
        lastPatientSavedAt: submittedAt,
        updatedAt: submittedAt,
      })
      .where(and(
        eq(preConsultQuestionnairesTable.id, invite.questionnaireId),
        eq(preConsultQuestionnairesTable.status, "draft"),
      ))
      .returning({ submittedAt: preConsultQuestionnairesTable.submittedAt });

    if (!updated) {
      const [existing] = await tx
        .select({ submittedAt: preConsultQuestionnairesTable.submittedAt })
        .from(preConsultQuestionnairesTable)
        .where(eq(preConsultQuestionnairesTable.id, invite.questionnaireId))
        .limit(1);
      return existing ? { submittedAt: existing.submittedAt ?? submittedAt } : null;
    }

    await tx
      .update(preConsultInvitesTable)
      .set({ status: "submitted", submittedAt })
      .where(and(
        eq(preConsultInvitesTable.questionnaireId, invite.questionnaireId),
        eq(preConsultInvitesTable.status, "active"),
      ));

    return { submittedAt: updated.submittedAt ?? submittedAt };
  });

  if (!result) {
    res.status(404).json({ error: message(locale, "preConsultNotFound") });
    return;
  }
  res.json({ submitted: true, submittedAt: result.submittedAt });
});

router.post("/pre-consult/:token/uploads/request-url", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  if (!await requireBoundPatientSession(req, res, rawToken)) return;

  const invite = await findInvite(rawToken);
  const locale = await localeForInvite(invite);
  if (!invite) {
    res.status(404).json({ error: message(locale, "invalidLink") });
    return;
  }
  const parsed = UploadRequestSchema.safeParse(req.body);
  if (!parsed.success || !PRE_CONSULT_MIMES.has(parsed.data.mimeType)) {
    res.status(400).json({
      error: message(locale, "preConsultFileRequirements"),
    });
    return;
  }

  const safeFilename = sanitizeFilename(parsed.data.name);
  if (!safeFilename) {
    res.status(400).json({ error: message(locale, "invalidFileName") });
    return;
  }

  const [questionnaire] = await db
    .select({ status: preConsultQuestionnairesTable.status })
    .from(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.id, invite.questionnaireId))
    .limit(1);
  if (questionnaire?.status !== "draft") {
    res.status(409).json({ error: message(locale, "preConsultAlreadySubmitted") });
    return;
  }

  try {
    const uploadUrl = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadUrl);
    const uploadToken = await createGrant({
      purpose: "pre_consult_attachment",
      doctorId: invite.doctorId,
      patientId: invite.patientId,
      objectPath,
      fileName: safeFilename,
      mimeType: parsed.data.mimeType,
      expectedSize: parsed.data.size,
    });
    res.json({ uploadUrl, uploadToken });
  } catch (error) {
    req.log.error({ err: error }, "Failed to prepare pre-consult attachment upload");
    res.status(500).json({ error: message(locale, "preConsultUploadFailed") });
  }
});

router.post("/pre-consult/:token/attachments", async (req, res): Promise<void> => {
  const rawToken = routeParam(req.params.token);
  if (!await requireBoundPatientSession(req, res, rawToken)) return;

  const invite = await findInvite(rawToken);
  if (!invite) {
    res.status(404).json({ error: message("pt-BR", "invalidLink") });
    return;
  }
  const locale = await localeForInvite(invite);
  const parsed = FinalizeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidUpload") });
    return;
  }

  const grant = await findAvailableGrant(parsed.data.uploadToken);
  if (
    !grant ||
    grant.purpose !== "pre_consult_attachment" ||
    grant.patientId !== invite.patientId ||
    grant.doctorId !== invite.doctorId
  ) {
    res.status(403).json({ error: message(locale, "invalidOrUsedUpload") });
    return;
  }

  const validation = await validateUploadedObject(storage, {
    objectPath: grant.objectPath,
    mimeType: grant.mimeType,
    expectedSize: grant.expectedSize,
  });
  if (!validation.ok) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.uploadToken, grant, validation.generation);
    } catch (error) {
      req.log.error({ err: error, uploadGrantId: grant.id }, "Failed to persist pre-consult orphan cleanup");
      res.status(500).json({ error: message(locale, "preConsultUploadFailed") });
      return;
    }
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  let attachment;
  try {
    attachment = await db.transaction(async (tx) => {
      await lockStoragePath(tx, grant.objectPath);
      if (await storage.getObjectEntityGeneration(grant.objectPath) !== validation.generation) {
        throw new Error("Pre-consult attachment object generation changed before linking");
      }
      if (!await claimGrant(tx, parsed.data.uploadToken, grant.id, validation.generation)) return null;
      const [inserted] = await tx
        .insert(patientAttachmentsTable)
        .values({
          patientId: invite.patientId,
          doctorId: invite.doctorId,
          preConsultQuestionnaireId: invite.questionnaireId,
          fileName: grant.fileName,
          fileSize: validation.size,
          mimeType: grant.mimeType,
          objectPath: grant.objectPath,
          category: "pre_consulta",
          descricao: "Exame enviado pelo paciente na pré-consulta",
        })
        .returning();
      return inserted;
    });
  } catch (error) {
    try {
      await abandonGrantAndEnqueueCleanup(parsed.data.uploadToken, grant, validation.generation);
    } catch (cleanupError) {
      req.log.error(
        { err: cleanupError, cause: error, uploadGrantId: grant.id },
        "Failed to persist cleanup after pre-consult attachment failure",
      );
      res.status(500).json({ error: message(locale, "preConsultUploadFailed") });
      return;
    }
    req.log.error({ err: error, uploadGrantId: grant.id }, "Pre-consult attachment registration failed");
    res.status(500).json({ error: message(locale, "preConsultUploadFailed") });
    return;
  }
  if (!attachment) {
    await db.transaction((tx) => enqueueStorageCleanup(tx, [{
      objectPath: grant.objectPath,
      objectGeneration: validation.generation,
    }]));
    res.status(403).json({ error: message(locale, "invalidOrUsedUpload") });
    return;
  }

  res.status(201).json({
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    createdAt: attachment.createdAt,
  });
});

export default router;
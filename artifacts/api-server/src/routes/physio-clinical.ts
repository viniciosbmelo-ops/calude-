import { Router, type IRouter } from "express";
import {
  db,
  physioPatientsTable,
  physiotherapistsTable,
  rehabProtocolsTable,
  physioFollowupsTable,
  physioAppointmentsTable,
  rehabAssessmentsTable,
  rehabInvitesTable,
  careLinksTable,
  patientsTable,
  surgeriesTable,
  doctorsTable,
  whatsappOutboxTable,
  whatsappDeliveryAuditTable,
} from "@workspace/db";
import { procedimentoMeniscalTable } from "@workspace/db/schema";
import crypto from "crypto";
import { and, or, eq, sql, desc, asc, lt, gt, gte, lte, inArray } from "drizzle-orm";
import { mapSurgeryToProtocol, PROTOCOL_LABELS } from "../services/surgeryProtocolMap";
import { buildRedFlagMessage } from "../services/redFlagAlerts";
import { requirePhysio } from "../middlewares/requireAuth";
import { enforcePatientLimit, physioWriteGuard } from "../middlewares/physioPlanGuard";
import { claimPatientSlot } from "../lib/physioBilling";
import { z } from "zod/v4";
import {
  generateFollowupsPreview,
  getProtocolDefinition,
} from "../services/protocolGenerator";
import {
  ASSESSMENT_TYPES,
  type AssessmentType,
  validateAssessmentPayload,
  computeAssessment,
  autoCompleteFollowups,
} from "../services/rehabAssessments";

const router: IRouter = Router();

router.use("/physio", requirePhysio);
router.use("/physio", physioWriteGuard);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNEE_CODES = [
  "lca_r", "lcp_r", "menisc_sutura", "meniscectomia",
  "atj", "osteotomia", "mpfl", "tend_patelar",
] as const;

function parseId(raw: unknown): number | null {
  const id = parseInt(String(raw ?? ""), 10);
  return Number.isNaN(id) ? null : id;
}

async function getOwnedPatient(physioId: number, patientId: number) {
  const [patient] = await db.select().from(physioPatientsTable)
    .where(and(
      eq(physioPatientsTable.id, patientId),
      eq(physioPatientsTable.physioId, physioId),
    ))
    .limit(1);
  return patient ?? null;
}

// ── Catálogo de protocolos ──────────────────────────────────────────────────

router.get("/physio/protocols", async (_req, res): Promise<void> => {
  const rows = await db.select().from(rehabProtocolsTable)
    .where(eq(rehabProtocolsTable.isActive, true))
    .orderBy(asc(rehabProtocolsTable.code), desc(rehabProtocolsTable.version));

  // maior versão ativa por code
  const byCode = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, row);
  }

  res.json(Array.from(byCode.values()).map((p) => {
    const def = getProtocolDefinition(p);
    return {
      id: p.id,
      code: p.code,
      version: p.version,
      name: p.name,
      startReference: def.start_reference,
      phases: def.phases.map((ph) => ({ phase: ph.phase, label: ph.label, weeks: ph.weeks })),
    };
  }));
});

// ── Pacientes ───────────────────────────────────────────────────────────────

const CreatePatientBody = z.object({
  fullName: z.string().min(2),
  cpf: z.string().optional(),
  birthDate: z.string().regex(DATE_RE).optional(),
  phone: z.string().optional(),
  diagnosisCode: z.string().min(1),
  diagnosis: z.string().optional(), // texto livre quando 'outro'
  protocolStartDate: z.string().regex(DATE_RE).optional(),
});

router.post("/physio/patients", enforcePatientLimit, async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos. Verifique os campos obrigatórios." });
    return;
  }
  const body = parsed.data;
  const isKnee = (KNEE_CODES as readonly string[]).includes(body.diagnosisCode);

  if (!isKnee && body.diagnosisCode !== "outro") {
    res.status(400).json({ error: "Diagnóstico inválido" });
    return;
  }
  if (body.diagnosisCode === "outro" && !body.diagnosis?.trim()) {
    res.status(400).json({ error: "Descreva o diagnóstico" });
    return;
  }

  let protocol = null;
  if (isKnee) {
    if (!body.protocolStartDate) {
      res.status(400).json({ error: "Informe a data da cirurgia (ou início do tratamento)" });
      return;
    }
    const [found] = await db.select().from(rehabProtocolsTable)
      .where(and(
        eq(rehabProtocolsTable.code, body.diagnosisCode),
        eq(rehabProtocolsTable.isActive, true),
      ))
      .orderBy(desc(rehabProtocolsTable.version))
      .limit(1);
    if (!found) {
      res.status(400).json({ error: "Protocolo não encontrado para este diagnóstico" });
      return;
    }
    protocol = found;
  }

  // Claim atômico do slot + insert na MESMA transação (evita race TOCTOU no paywall)
  const protocolRef = protocol;
  const patient = await db.transaction(async (tx) => {
    const claimed = await claimPatientSlot(tx, req.physioId!);
    if (!claimed) return null;
    const [created] = await tx.insert(physioPatientsTable).values({
      physioId: req.physioId!,
      fullName: body.fullName.trim(),
      cpf: body.cpf?.trim() || null,
      birthDate: body.birthDate ?? null,
      phone: body.phone?.trim() || null,
      diagnosisCode: body.diagnosisCode,
      diagnosis: body.diagnosisCode === "outro" ? body.diagnosis!.trim() : null,
      protocolId: protocolRef?.id ?? null,
      protocolStartDate: isKnee ? body.protocolStartDate! : null,
    }).returning();
    return created;
  });

  if (!patient) {
    res.status(402).json({
      error: "PLAN_LIMIT_REACHED",
      message:
        "Seus 2 pacientes de teste gratuitos já foram utilizados. Assine o plano para adicionar novos pacientes.",
      checkoutUrl: null,
    });
    return;
  }

  const followupsPreview = protocol
    ? generateFollowupsPreview(protocol, body.protocolStartDate!)
    : null;

  res.status(201).json({ patient, followupsPreview });
});

router.get("/physio/patients", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conditions = [eq(physioPatientsTable.physioId, req.physioId!)];
  if (status) conditions.push(eq(physioPatientsTable.status, status));

  const rows = await db.select({
    patient: physioPatientsTable,
    protocolName: rehabProtocolsTable.name,
    pendingFollowups: sql<number>`(select count(*)::int from ${physioFollowupsTable} f where f.physio_patient_id = ${physioPatientsTable.id} and f.status = 'pending')`,
  })
    .from(physioPatientsTable)
    .leftJoin(rehabProtocolsTable, eq(physioPatientsTable.protocolId, rehabProtocolsTable.id))
    .where(and(...conditions))
    .orderBy(sql`lower(${physioPatientsTable.fullName}) COLLATE "pt-BR-x-icu"`, physioPatientsTable.id);

  res.json(rows.map((r) => ({ ...r.patient, protocolName: r.protocolName, pendingFollowups: r.pendingFollowups })));
});

router.get("/physio/patients/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [protocol, followups, assessments] = await Promise.all([
    patient.protocolId
      ? db.select().from(rehabProtocolsTable).where(eq(rehabProtocolsTable.id, patient.protocolId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select().from(physioFollowupsTable)
      .where(eq(physioFollowupsTable.physioPatientId, id))
      .orderBy(asc(physioFollowupsTable.dueDate)),
    listAssessmentsWithSharedHistory(patient),
  ]);

  res.json({
    patient,
    protocol: protocol ? { id: protocol.id, code: protocol.code, name: protocol.name, definition: protocol.definition } : null,
    followups,
    assessments,
  });
});

const UpdatePatientBody = z.object({
  fullName: z.string().min(2).optional(),
  cpf: z.string().nullable().optional(),
  birthDate: z.string().regex(DATE_RE).nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.enum(["active", "discharged", "abandoned"]).optional(),
});

router.patch("/physio/patients/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const [updated] = await db.update(physioPatientsTable)
    .set(parsed.data)
    .where(eq(physioPatientsTable.id, id))
    .returning();
  res.json(updated);
});

// ── Confirmação do cronograma (preview → confirm) ───────────────────────────

const ConfirmFollowupItem = z.object({
  phase: z.number().int().min(1).max(4).nullable().optional(),
  title: z.string().min(1),
  requiredAssessments: z.array(z.enum(ASSESSMENT_TYPES)).optional(),
  dueDate: z.string().regex(DATE_RE),
});

const ConfirmProtocolBody = z.object({
  followups: z.array(ConfirmFollowupItem).min(1),
  customized: z.boolean(),
});

router.post("/physio/patients/:id/confirm-protocol", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }
  if (!patient.protocolId) {
    res.status(400).json({ error: "Paciente sem protocolo de joelho — cronograma não se aplica" });
    return;
  }

  const [existing] = await db.select({ id: physioFollowupsTable.id })
    .from(physioFollowupsTable)
    .where(and(
      eq(physioFollowupsTable.physioPatientId, id),
      eq(physioFollowupsTable.source, "protocol"),
    ))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Cronograma já confirmado para este paciente" });
    return;
  }

  const parsed = ConfirmProtocolBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos no cronograma" }); return; }

  const inserted = await db.insert(physioFollowupsTable).values(
    parsed.data.followups.map((f) => ({
      physioId: req.physioId!,
      physioPatientId: id,
      careLinkId: patient.careLinkId,
      source: "protocol",
      phase: f.phase ?? null,
      title: f.title,
      requiredAssessments: f.requiredAssessments ?? [],
      dueDate: f.dueDate,
    })),
  ).returning();

  await db.update(physioPatientsTable)
    .set({ protocolCustomized: parsed.data.customized })
    .where(eq(physioPatientsTable.id, id));

  res.status(201).json({ followups: inserted, protocolCustomized: parsed.data.customized });
});

// ── Follow-up manual + gestão ───────────────────────────────────────────────

const ManualFollowupBody = z.object({
  title: z.string().min(1),
  dueDate: z.string().regex(DATE_RE),
  requiredAssessments: z.array(z.enum(ASSESSMENT_TYPES)).optional(),
});

router.post("/physio/patients/:id/followups", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const parsed = ManualFollowupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const [followup] = await db.insert(physioFollowupsTable).values({
    physioId: req.physioId!,
    physioPatientId: id,
    careLinkId: patient.careLinkId,
    source: "manual",
    title: parsed.data.title,
    requiredAssessments: parsed.data.requiredAssessments ?? [],
    dueDate: parsed.data.dueDate,
  }).returning();

  res.status(201).json(followup);
});

const UpdateFollowupBody = z.object({
  status: z.enum(["pending", "done", "skipped"]),
});

router.patch("/physio/followups/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const parsed = UpdateFollowupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const [followup] = await db.select().from(physioFollowupsTable)
    .where(and(
      eq(physioFollowupsTable.id, id),
      eq(physioFollowupsTable.physioId, req.physioId!),
    ))
    .limit(1);
  if (!followup) { res.status(404).json({ error: "Follow-up não encontrado" }); return; }

  const [updated] = await db.update(physioFollowupsTable)
    .set({
      status: parsed.data.status,
      completedAt: parsed.data.status === "done" ? new Date() : null,
    })
    .where(eq(physioFollowupsTable.id, id))
    .returning();
  res.json(updated);
});

// ── Avaliações estruturadas ─────────────────────────────────────────────────

const CreateAssessmentBody = z.object({
  assessmentType: z.string().min(1),
  phase: z.number().int().min(1).max(4).nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});

router.post("/physio/patients/:id/assessments", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const parsed = CreateAssessmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const validation = validateAssessmentPayload(parsed.data.assessmentType, parsed.data.payload);
  if (!validation.success) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const { computed, redFlags } = computeAssessment(
    parsed.data.assessmentType as AssessmentType,
    validation.data,
    parsed.data.phase ?? null,
    patient.diagnosisCode,
  );

  const [assessment] = await db.transaction(async (tx) => {
    const [activeLink] = patient.careLinkId
      ? await tx.select({ id: careLinksTable.id }).from(careLinksTable)
          .where(and(
            eq(careLinksTable.id, patient.careLinkId),
            eq(careLinksTable.status, "active"),
            eq(careLinksTable.physioId, req.physioId!),
          ))
          .for("update")
          .limit(1)
      : [];
    const activeCareLinkId = activeLink?.id ?? null;
    const inserted = await tx.insert(rehabAssessmentsTable).values({
      physioPatientId: id,
      physioId: req.physioId!,
      careLinkId: activeCareLinkId,
      phase: parsed.data.phase ?? null,
      assessmentType: parsed.data.assessmentType,
      payload: validation.data,
      computed,
      redFlags: redFlags.length > 0 ? redFlags : null,
    }).returning();
    const created = inserted[0]!;

    if (redFlags.length > 0 && activeCareLinkId) {
      const [recipient] = await tx.select({
        phone: doctorsTable.telefone,
        physioName: physiotherapistsTable.nome,
        patientName: physioPatientsTable.fullName,
      })
        .from(careLinksTable)
        .innerJoin(doctorsTable, eq(careLinksTable.surgeonId, doctorsTable.id))
        .innerJoin(physiotherapistsTable, eq(careLinksTable.physioId, physiotherapistsTable.id))
        .innerJoin(physioPatientsTable, eq(physioPatientsTable.id, id))
        .where(and(
          eq(careLinksTable.id, activeCareLinkId),
          eq(careLinksTable.status, "active"),
          eq(careLinksTable.physioId, req.physioId!),
        ))
        .limit(1);

      if (recipient) {
        const noPhone = !recipient.phone;
        const [outbox] = await tx.insert(whatsappOutboxTable).values({
          eventType: "rehab_red_flag",
          assessmentId: created.id,
          idempotencyKey: `rehab-red-flag:${created.id}`,
          recipient: recipient.phone ?? "",
          message: buildRedFlagMessage({
            patientName: recipient.patientName,
            physioName: recipient.physioName,
            redFlags,
          }),
          status: noPhone ? "failed" : "pending",
          lastError: noPhone ? "Cirurgião sem telefone cadastrado." : null,
          failedAt: noPhone ? new Date() : null,
        }).returning({ id: whatsappOutboxTable.id });
        if (noPhone) {
          await tx.insert(whatsappDeliveryAuditTable).values({
            outboxId: outbox!.id,
            attempt: 0,
            outcome: "failed_final",
            error: "Cirurgião sem telefone cadastrado.",
          });
        }
      }
    }
    return inserted;
  });

  const completedFollowupIds = await autoCompleteFollowups(id);

  res.status(201).json({ assessment, completedFollowupIds });
});

router.get("/physio/patients/:id/assessments", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const patient = await getOwnedPatient(req.physioId!, id);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const rows = await listAssessmentsWithSharedHistory(patient);
  res.json(rows);
});

/**
 * Avaliações do próprio prontuário do fisio + histórico compartilhado:
 * se o paciente veio de encaminhamento (careLinkId preenchido) e o vínculo
 * do fisio atual está ATIVO, inclui as rehab_assessments feitas por fisios
 * anteriores em care_links do mesmo paciente, mas apenas as registradas
 * ANTES do início do vínculo atual (continuidade de cuidado após
 * revogação/novo convite). Fisio com vínculo revogado vê somente o próprio
 * prontuário — nunca dados novos de outros fisios.
 */
async function listAssessmentsWithSharedHistory(patient: {
  id: number;
  patientId: number | null;
  careLinkId: number | null;
}) {
  const ownOnly = () => db.select().from(rehabAssessmentsTable)
    .where(eq(rehabAssessmentsTable.physioPatientId, patient.id))
    .orderBy(desc(rehabAssessmentsTable.createdAt));

  if (!patient.patientId || !patient.careLinkId) return ownOnly();

  const [ownLink] = await db.select().from(careLinksTable)
    .where(eq(careLinksTable.id, patient.careLinkId)).limit(1);
  if (!ownLink || ownLink.status !== "active") return ownOnly();

  const otherLinkIds = (await db.select({ id: careLinksTable.id }).from(careLinksTable)
    .where(eq(careLinksTable.patientId, patient.patientId)))
    .map((l) => l.id)
    .filter((linkId) => linkId !== patient.careLinkId);
  if (otherLinkIds.length === 0) return ownOnly();

  return db.select().from(rehabAssessmentsTable)
    .where(or(
      eq(rehabAssessmentsTable.physioPatientId, patient.id),
      and(
        inArray(rehabAssessmentsTable.careLinkId, otherLinkIds),
        lt(rehabAssessmentsTable.createdAt, ownLink.createdAt),
      ),
    ))
    .orderBy(desc(rehabAssessmentsTable.createdAt));
}

// ── Convites de encaminhamento (lado fisio) ─────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

class InviteAlreadyUsedError extends Error {}
class PlanLimitError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null &&
    ("code" in err && (err as { code?: string }).code === "23505" ||
     "cause" in err && isUniqueViolation((err as { cause?: unknown }).cause));
}

async function findInviteByToken(token: string) {
  const [invite] = await db.select().from(rehabInvitesTable)
    .where(eq(rehabInvitesTable.tokenHash, hashToken(token)))
    .limit(1);
  return invite ?? null;
}

router.get("/physio/invites/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 20) { res.status(400).json({ error: "Token inválido" }); return; }

  const invite = await findInviteByToken(token);
  if (!invite) { res.status(404).json({ error: "Convite não encontrado" }); return; }

  const expired = invite.status === "pending" && invite.expiresAt < new Date();
  const status = expired ? "expired" : invite.status;

  const [[doctor], [patient], [surgery]] = await Promise.all([
    db.select({ nome: doctorsTable.nome, crm: doctorsTable.crm }).from(doctorsTable)
      .where(eq(doctorsTable.id, invite.surgeonId)).limit(1),
    db.select({ nome: patientsTable.nome }).from(patientsTable)
      .where(eq(patientsTable.id, invite.patientId)).limit(1),
    db.select().from(surgeriesTable)
      .where(eq(surgeriesTable.id, invite.surgeryId)).limit(1),
  ]);

  let procedureLabel: string | null = null;
  let protocolCode: string | null = null;
  if (surgery) {
    const meniscal = await db.select({
      sutura: procedimentoMeniscalTable.sutura,
      meniscectomia: procedimentoMeniscalTable.meniscectomia,
    }).from(procedimentoMeniscalTable).where(eq(procedimentoMeniscalTable.surgeryId, surgery.id));
    protocolCode = mapSurgeryToProtocol(surgery, meniscal);
    procedureLabel = protocolCode
      ? PROTOCOL_LABELS[protocolCode as keyof typeof PROTOCOL_LABELS]
      : (surgery.diagnostico ?? "Cirurgia de joelho");
  }

  const initials = patient
    ? patient.nome.trim().split(/\s+/).map((p) => p.charAt(0).toUpperCase() + ".").join("")
    : null;

  res.json({
    status,
    doctorName: doctor?.nome ?? null,
    doctorCrm: doctor?.crm ?? null,
    patientInitials: initials,
    procedureLabel,
    protocolCode,
    surgeryDate: surgery?.dataCirurgia ?? null,
    expiresAt: invite.expiresAt.toISOString(),
  });
});

const AcceptInviteBody = z.object({ token: z.string().min(20) });

router.post("/physio/invites/accept", enforcePatientLimit, async (req, res): Promise<void> => {
  const parsed = AcceptInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Token inválido" }); return; }

  const invite = await findInviteByToken(parsed.data.token);
  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
    res.status(410).json({ error: "Convite expirado ou inválido." });
    return;
  }

  // Já existe vínculo deste fisio com esta cirurgia?
  const [existingLink] = await db.select().from(careLinksTable)
    .where(and(
      eq(careLinksTable.physioId, req.physioId!),
      eq(careLinksTable.surgeryId, invite.surgeryId),
    ))
    .limit(1);
  if (existingLink) {
    res.status(409).json({ error: "Você já possui vínculo com este paciente/cirurgia." });
    return;
  }

  const [[patient], [surgery]] = await Promise.all([
    db.select().from(patientsTable).where(eq(patientsTable.id, invite.patientId)).limit(1),
    db.select().from(surgeriesTable).where(eq(surgeriesTable.id, invite.surgeryId)).limit(1),
  ]);
  if (!patient || !surgery) {
    res.status(410).json({ error: "Paciente ou cirurgia não encontrados — convite inválido." });
    return;
  }

  const meniscal = await db.select({
    sutura: procedimentoMeniscalTable.sutura,
    meniscectomia: procedimentoMeniscalTable.meniscectomia,
  }).from(procedimentoMeniscalTable).where(eq(procedimentoMeniscalTable.surgeryId, surgery.id));
  const protocolCode = mapSurgeryToProtocol(surgery, meniscal);

  let protocol = null;
  if (protocolCode) {
    const [found] = await db.select().from(rehabProtocolsTable)
      .where(and(
        eq(rehabProtocolsTable.code, protocolCode),
        eq(rehabProtocolsTable.isActive, true),
      ))
      .orderBy(desc(rehabProtocolsTable.version))
      .limit(1);
    protocol = found ?? null;
  }

  const startDate = surgery.dataCirurgia; // YYYY-MM-DD ou null

  let result;
  try {
    result = await db.transaction(async (tx) => {
      // Claim atômico do slot de paciente (evita race TOCTOU no paywall).
      // Roda ANTES do consumo do convite: se falhar, o rollback preserva o token.
      const slotClaimed = await claimPatientSlot(tx, req.physioId!);
      if (!slotClaimed) {
        throw new PlanLimitError();
      }

      // Claim atômico do convite: garante uso único mesmo sob concorrência
      const claimed = await tx.update(rehabInvitesTable)
        .set({ status: "accepted", acceptedBy: req.physioId!, acceptedAt: new Date() })
        .where(and(
          eq(rehabInvitesTable.id, invite.id),
          eq(rehabInvitesTable.status, "pending"),
          gt(rehabInvitesTable.expiresAt, new Date()),
        ))
        .returning({ id: rehabInvitesTable.id });
      if (claimed.length !== 1) {
        throw new InviteAlreadyUsedError();
      }

      const [careLink] = await tx.insert(careLinksTable).values({
        patientId: invite.patientId,
        surgeonId: invite.surgeonId,
        physioId: req.physioId!,
        surgeryId: invite.surgeryId,
      }).returning();

      const [physioPatient] = await tx.insert(physioPatientsTable).values({
        physioId: req.physioId!,
        patientId: invite.patientId,
        careLinkId: careLink.id,
        fullName: patient.nome,
        cpf: patient.cpf ?? null,
        birthDate: patient.dataNascimento ?? null,
        phone: patient.telefone ?? null,
        diagnosisCode: protocolCode ?? "outro",
        diagnosis: protocolCode ? null : (surgery.diagnostico ?? "Encaminhamento médico"),
        protocolId: protocol?.id ?? null,
        protocolStartDate: protocol && startDate ? startDate : null,
      }).returning();

      return { careLink, physioPatient };
    });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      res.status(402).json({
        error: "PLAN_LIMIT_REACHED",
        message:
          "Seus 2 pacientes de teste gratuitos já foram utilizados. Assine o plano para aceitar novos pacientes.",
        checkoutUrl: null,
      });
      return;
    }
    if (err instanceof InviteAlreadyUsedError) {
      res.status(410).json({ error: "Convite expirado ou inválido." });
      return;
    }
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Você já possui vínculo com este paciente/cirurgia." });
      return;
    }
    throw err;
  }

  const followupsPreview = protocol && startDate
    ? generateFollowupsPreview(protocol, startDate)
    : null;

  res.status(201).json({
    careLinkId: result.careLink.id,
    patient: result.physioPatient,
    followupsPreview,
  });
});

// ── Dashboard ───────────────────────────────────────────────────────────────

router.get("/physio/dashboard", async (req, res): Promise<void> => {
  const physioId = req.physioId!;
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startOfDay = new Date(`${today}T00:00:00`);
  const endOfDay = new Date(`${today}T23:59:59.999`);

  const followupBase = {
    id: physioFollowupsTable.id,
    physioPatientId: physioFollowupsTable.physioPatientId,
    title: physioFollowupsTable.title,
    dueDate: physioFollowupsTable.dueDate,
    phase: physioFollowupsTable.phase,
    source: physioFollowupsTable.source,
    requiredAssessments: physioFollowupsTable.requiredAssessments,
    patientName: physioPatientsTable.fullName,
  };

  const [overdue, next7days, [upcoming], todayAgenda, [activePatients]] = await Promise.all([
    db.select(followupBase)
      .from(physioFollowupsTable)
      .innerJoin(physioPatientsTable, eq(physioPatientsTable.id, physioFollowupsTable.physioPatientId))
      .where(and(
        eq(physioFollowupsTable.physioId, physioId),
        eq(physioFollowupsTable.status, "pending"),
        lt(physioFollowupsTable.dueDate, today),
      ))
      .orderBy(asc(physioFollowupsTable.dueDate)),
    db.select(followupBase)
      .from(physioFollowupsTable)
      .innerJoin(physioPatientsTable, eq(physioPatientsTable.id, physioFollowupsTable.physioPatientId))
      .where(and(
        eq(physioFollowupsTable.physioId, physioId),
        eq(physioFollowupsTable.status, "pending"),
        gte(physioFollowupsTable.dueDate, today),
        lte(physioFollowupsTable.dueDate, in7),
      ))
      .orderBy(asc(physioFollowupsTable.dueDate)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(physioFollowupsTable)
      .where(and(
        eq(physioFollowupsTable.physioId, physioId),
        eq(physioFollowupsTable.status, "pending"),
        gt(physioFollowupsTable.dueDate, in7),
      )),
    db.select({
      id: physioAppointmentsTable.id,
      startsAt: physioAppointmentsTable.startsAt,
      endsAt: physioAppointmentsTable.endsAt,
      appointmentType: physioAppointmentsTable.appointmentType,
      patientName: physioPatientsTable.fullName,
    })
      .from(physioAppointmentsTable)
      .leftJoin(physioPatientsTable, eq(physioPatientsTable.id, physioAppointmentsTable.physioPatientId))
      .where(and(
        eq(physioAppointmentsTable.physioId, physioId),
        eq(physioAppointmentsTable.status, "scheduled"),
        gte(physioAppointmentsTable.startsAt, startOfDay),
        lte(physioAppointmentsTable.startsAt, endOfDay),
      ))
      .orderBy(asc(physioAppointmentsTable.startsAt)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(physioPatientsTable)
      .where(and(
        eq(physioPatientsTable.physioId, physioId),
        eq(physioPatientsTable.status, "active"),
      )),
  ]);

  res.json({
    followups: {
      overdue,
      next7days,
      upcomingCount: upcoming?.count ?? 0,
    },
    todayAgenda: todayAgenda.map((a) => ({
      ...a,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
    })),
    activePatients: activePatients?.count ?? 0,
  });
});

export default router;

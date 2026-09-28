import { Router, type IRouter } from "express";
import crypto from "crypto";
import {
  db,
  patientsTable,
  surgeriesTable,
  doctorsTable,
  rehabInvitesTable,
  careLinksTable,
  physiotherapistsTable,
  rehabAssessmentsTable,
  physioFollowupsTable,
} from "@workspace/db";
import { procedimentoMeniscalTable } from "@workspace/db/schema";
import { and, eq, desc, asc, gte, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/requireAuth";
import { getBaseUrl } from "../lib/base-url";
import { mapSurgeryToProtocol, patientInitials, PROTOCOL_LABELS } from "../services/surgeryProtocolMap";

const router: IRouter = Router();

const CreateInviteBody = z.object({
  surgeryId: z.number().int().positive(),
  consentMethod: z.enum(["verbal_presencial", "whatsapp", "termo_assinado"]),
});

// ── POST /patients/:patientId/rehab-invite — médico gera convite ───────────
router.post("/patients/:patientId/rehab-invite", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(String(req.params.patientId ?? ""), 10);
  if (Number.isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Informe a cirurgia e o método de consentimento do paciente." });
    return;
  }

  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [surgery] = await db.select().from(surgeriesTable)
    .where(and(
      eq(surgeriesTable.id, parsed.data.surgeryId),
      eq(surgeriesTable.patientId, patientId),
      eq(surgeriesTable.doctorId, req.doctorId!),
    ))
    .limit(1);
  if (!surgery) { res.status(404).json({ error: "Cirurgia não encontrada para este paciente" }); return; }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invite] = await db.insert(rehabInvitesTable).values({
    tokenHash,
    surgeonId: req.doctorId!,
    patientId,
    surgeryId: surgery.id,
    consentRecordedAt: new Date(),
    consentMethod: parsed.data.consentMethod,
    expiresAt,
  }).returning();

  const [doctor] = await db.select({ nome: doctorsTable.nome }).from(doctorsTable)
    .where(eq(doctorsTable.id, req.doctorId!)).limit(1);

  const link = `${getBaseUrl()}/fisio/convite/${rawToken}`;
  const initials = patientInitials(patient.nome);
  const protocolCode = mapSurgeryToProtocol(surgery, await db.select({
    sutura: procedimentoMeniscalTable.sutura,
    meniscectomia: procedimentoMeniscalTable.meniscectomia,
  }).from(procedimentoMeniscalTable).where(eq(procedimentoMeniscalTable.surgeryId, surgery.id)));
  const procedureLabel = protocolCode ? PROTOCOL_LABELS[protocolCode] : (surgery.diagnostico ?? "Cirurgia de joelho");

  const whatsappText =
    `Olá! Sou Dr(a). ${doctor?.nome ?? ""} e encaminho o paciente ${initials} ` +
    `(${procedureLabel}${surgery.dataCirurgia ? `, cirurgia ${surgery.dataCirurgia.split("-").reverse().join("/")}` : ""}) ` +
    `para reabilitação pós-operatória. Acompanhe as avaliações pelo DocSholder: ${link}`;

  res.status(201).json({
    inviteId: invite.id,
    link,
    whatsappText,
    expiresAt: invite.expiresAt.toISOString(),
  });
});

// ── GET /patients/:patientId/rehab — visão do médico (convites + vínculo + resumo) ──
router.get("/patients/:patientId/rehab", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(String(req.params.patientId ?? ""), 10);
  if (Number.isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const now = new Date();
  const invites = await db.select().from(rehabInvitesTable)
    .where(and(
      eq(rehabInvitesTable.patientId, patientId),
      eq(rehabInvitesTable.surgeonId, req.doctorId!),
    ))
    .orderBy(desc(rehabInvitesTable.createdAt));

  const careLinks = await db.select({
    careLink: careLinksTable,
    physioNome: physiotherapistsTable.nome,
    physioCrefito: physiotherapistsTable.crefito,
    physioClinica: physiotherapistsTable.clinica,
  })
    .from(careLinksTable)
    .innerJoin(physiotherapistsTable, eq(physiotherapistsTable.id, careLinksTable.physioId))
    .where(and(
      eq(careLinksTable.patientId, patientId),
      eq(careLinksTable.surgeonId, req.doctorId!),
    ))
    .orderBy(desc(careLinksTable.createdAt));

  const activeLinkIds = careLinks
    .filter((c) => c.careLink.status === "active")
    .map((c) => c.careLink.id);

  let rehabSummary: Record<string, unknown> | null = null;
  let assessments: Array<Record<string, unknown>> = [];

  if (activeLinkIds.length > 0) {
    const rows = await db.select().from(rehabAssessmentsTable)
      .where(inArray(rehabAssessmentsTable.careLinkId, activeLinkIds))
      .orderBy(desc(rehabAssessmentsTable.createdAt));

    assessments = rows.map((a) => ({
      id: a.id,
      assessmentType: a.assessmentType,
      phase: a.phase,
      computed: a.computed,
      redFlags: a.redFlags,
      createdAt: a.createdAt.toISOString(),
    }));

    const latestOf = (type: string) => rows.find((a) => a.assessmentType === type);
    const forca = latestOf("forca");
    const hop = latestOf("hop");
    const aclRsi = latestOf("acl_rsi");

    const followups = await db.select().from(physioFollowupsTable)
      .where(inArray(physioFollowupsTable.careLinkId, activeLinkIds))
      .orderBy(asc(physioFollowupsTable.dueDate));

    const protocolFollowups = followups.filter((f) => f.source === "protocol");
    const doneCount = protocolFollowups.filter((f) => f.status === "done").length;
    const todayISO = now.toISOString().slice(0, 10);
    const nextPending = followups.find((f) => f.status === "pending" && f.dueDate >= todayISO)
      ?? followups.find((f) => f.status === "pending");

    const redFlagsAll = rows.flatMap((a) =>
      (a.redFlags ?? []).map((flag) => ({ flag, assessmentType: a.assessmentType, createdAt: a.createdAt.toISOString() })),
    );

    rehabSummary = {
      progressPercent: protocolFollowups.length > 0
        ? Math.round((doneCount / protocolFollowups.length) * 100)
        : null,
      lsiQuadriceps: (forca?.computed as Record<string, unknown> | null)?.["lsi_quadriceps"] ?? null,
      lsiHop: (hop?.computed as Record<string, unknown> | null)?.["lsi_hop_medio"] ?? null,
      aclRsi: aclRsi ? (aclRsi.payload as Record<string, unknown>)["escore"] ?? null : null,
      nextFollowup: nextPending ? { title: nextPending.title, dueDate: nextPending.dueDate } : null,
      totalAssessments: rows.length,
      redFlags: redFlagsAll.slice(0, 10),
    };
  }

  res.json({
    invites: invites.map((i) => ({
      id: i.id,
      surgeryId: i.surgeryId,
      status: i.status === "pending" && i.expiresAt < now ? "expired" : i.status,
      consentMethod: i.consentMethod,
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
    careLinks: careLinks.map((c) => ({
      id: c.careLink.id,
      surgeryId: c.careLink.surgeryId,
      status: c.careLink.status,
      physioNome: c.physioNome,
      physioCrefito: c.physioCrefito,
      physioClinica: c.physioClinica,
      createdAt: c.careLink.createdAt.toISOString(),
    })),
    rehabSummary,
    assessments,
  });
});

// ── POST /care-links/:id/revoke — médico revoga o vínculo ──────────────────
router.post("/care-links/:id/revoke", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [link] = await db.select().from(careLinksTable)
    .where(and(eq(careLinksTable.id, id), eq(careLinksTable.surgeonId, req.doctorId!)))
    .limit(1);
  if (!link) { res.status(404).json({ error: "Vínculo não encontrado" }); return; }
  if (link.status !== "active") {
    res.status(409).json({ error: "Vínculo já encerrado" });
    return;
  }

  const [updated] = await db.update(careLinksTable)
    .set({ status: "revoked_by_surgeon" })
    .where(eq(careLinksTable.id, id))
    .returning();

  res.json({ id: updated.id, status: updated.status });
});

export default router;

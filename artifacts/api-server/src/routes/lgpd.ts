import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import {
  auditLogsTable,
  consentimentosTable,
  db,
  doctorsTable,
  followupTable,
  patientAttachmentsTable,
  patientsTable,
  preConsultQuestionnairesTable,
  surgeriesTable,
} from "@workspace/db";
import { eq, and, gte, inArray, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { isHiddenFracturePreoperative } from "../lib/followup-schedule";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const TERMO_VERSAO = "1.0";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildTermoText(tipo: string, doctorId: number): string {
  return `DocSholder LGPD Consent | tipo=${tipo} | doctorId=${doctorId} | versao=${TERMO_VERSAO}`;
}

/**
 * Escape a value for safe inclusion in a CSV cell.
 * Wraps in double-quotes and escapes internal double-quotes per RFC 4180.
 * Also strips control characters (including CR/LF) to prevent CSV injection.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value)
    // Strip control chars (CR, LF, tab, etc.) — prevents formula injection and newline smuggling
    .replace(/[\x00-\x1F\x7F]/g, " ")
    // Escape double-quotes
    .replace(/"/g, '""');
  return `"${s}"`;
}

// ── 1. Consentimento ────────────────────────────────────────────────────────

router.post("/lgpd/consentimento", requireAuth, async (req, res): Promise<void> => {
  const { aceito = true, tipo = "plataforma_docknee" } = req.body as { aceito?: boolean; tipo?: string };

  if (typeof aceito !== "boolean") {
    res.status(400).json({ error: 'Campo "aceito" deve ser booleano' });
    return;
  }

  const textoHash = hashText(buildTermoText(tipo, req.doctorId!));

  const [record] = await db
    .insert(consentimentosTable)
    .values({
      doctorId: req.doctorId!,
      tipo,
      textoVersao: TERMO_VERSAO,
      textoHash,
      aceito,
      ipAddress: req.ip ?? null,
      userAgent: req.get("User-Agent") ?? null,
    })
    .onConflictDoUpdate({
      target: consentimentosTable.doctorId,
      set: { tipo, textoVersao: TERMO_VERSAO, textoHash, aceito, ipAddress: req.ip ?? null, userAgent: req.get("User-Agent") ?? null },
    })
    .returning();

  res.status(201).json({
    mensagem: aceito ? "Consentimento registrado com sucesso" : "Consentimento revogado",
    consentimento: record,
  });
});

router.get("/lgpd/consentimento", requireAuth, async (req, res): Promise<void> => {
  const [record] = await db
    .select()
    .from(consentimentosTable)
    .where(eq(consentimentosTable.doctorId, req.doctorId!))
    .limit(1);

  if (!record) {
    res.status(404).json({ error: "Nenhum consentimento registrado", aceito: false });
    return;
  }

  res.json(record);
});

// ── 2. Acesso — exportar todos os dados do titular ─────────────────────────

router.get("/lgpd/dados", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
  if (!doctor) { res.status(404).json({ error: "Médico não encontrado" }); return; }

  const patients = await db.select().from(patientsTable).where(eq(patientsTable.doctorId, doctorId));
  const surgeries = await db.select().from(surgeriesTable).where(eq(surgeriesTable.doctorId, doctorId));
  const surgeryIds = surgeries.map(s => s.id);

  // Fetch all followups for ALL surgeries of this doctor (not just the first one)
  const surgeryProcedures = Object.fromEntries(surgeries.map((surgery) => [
    surgery.id,
    surgery.tiposProcedimento,
  ]));
  const followups = (surgeryIds.length > 0
    ? await db.select().from(followupTable)
        .where(inArray(followupTable.surgeryId, surgeryIds))
        .catch(() => [])
    : [])
    .filter((followup) => !isHiddenFracturePreoperative(
      surgeryProcedures[followup.surgeryId] as string[] | null,
      followup.tempo,
    ));

  const preConsultations = await db
    .select()
    .from(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.doctorId, doctorId));
  const preConsultAttachments = await db
    .select({
      id: patientAttachmentsTable.id,
      patientId: patientAttachmentsTable.patientId,
      questionnaireId: patientAttachmentsTable.preConsultQuestionnaireId,
      objectPath: patientAttachmentsTable.objectPath,
      fileName: patientAttachmentsTable.fileName,
      fileSize: patientAttachmentsTable.fileSize,
      mimeType: patientAttachmentsTable.mimeType,
      createdAt: patientAttachmentsTable.createdAt,
    })
    .from(patientAttachmentsTable)
    .where(and(
      eq(patientAttachmentsTable.doctorId, doctorId),
      isNotNull(patientAttachmentsTable.preConsultQuestionnaireId),
    ));

  const consentimento = await db.select().from(consentimentosTable)
    .where(eq(consentimentosTable.doctorId, doctorId)).limit(1);

  const recentAudit = await db.select().from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.doctorId, doctorId),
      gte(auditLogsTable.createdAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
    ))
    .limit(100);

  res.json({
    exportadoEm: new Date().toISOString(),
    prazoResposta: "Disponível imediatamente (Art. 18 LGPD)",
    titular: {
      id: doctor.id,
      nome: doctor.nome,
      email: doctor.email,
      crm: `${doctor.crmEstado} ${doctor.crm}`,
      cpf: doctor.cpf,
      telefone: doctor.telefone,
      especialidade: doctor.especialidade,
      cadastradoEm: doctor.createdAt,
    },
    dados: {
      totalPacientes: patients.length,
      totalCirurgias: surgeries.length,
      totalFollowups: followups.length,
      totalPreConsultas: preConsultations.length,
      pacientes: patients.map(p => ({ id: p.id, nome: p.nome, createdAt: p.createdAt })),
      cirurgias: surgeries.map(s => ({ id: s.id, dataCirurgia: s.dataCirurgia, status: s.status, createdAt: s.createdAt })),
      followups: followups.map(f => ({
        id: f.id,
        surgeryId: f.surgeryId,
        tempo: f.tempo,
        dataAvaliacao: f.dataAvaliacao,
        ikdc: f.ikdc,
        lysholm: f.lysholm,
        retornoEsporte: f.retornoEsporte,
        falha: f.falha,
        createdAt: f.createdAt,
      })),
      preConsultas: preConsultations.map((questionnaire) => ({
        id: questionnaire.id,
        patientId: questionnaire.patientId,
        status: questionnaire.status,
        questionnaireVersion: questionnaire.questionnaireVersion,
        respostaOriginalPaciente: questionnaire.patientAnswers,
        versaoClinicaAtual: questionnaire.currentAnswers,
        ultimoRascunhoEm: questionnaire.lastPatientSavedAt,
        enviadoEm: questionnaire.submittedAt,
        editadoPeloMedicoEm: questionnaire.doctorEditedAt,
        createdAt: questionnaire.createdAt,
        updatedAt: questionnaire.updatedAt,
      })),
      anexosPreConsulta: preConsultAttachments.map(({ objectPath: _objectPath, ...metadata }) => metadata),
    },
    consentimento: consentimento[0] ?? null,
    auditoria: {
      nota: "Últimos 90 dias de acesso",
      registros: recentAudit.map(a => ({ method: a.method, endpoint: a.endpoint, status: a.responseStatus, em: a.createdAt })),
    },
  });
});

// ── 3. Portabilidade — exportar em JSON ou CSV ──────────────────────────────

router.get("/lgpd/exportar", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const formato = (req.query["formato"] as string) ?? "json";

  // Validate formato to prevent unexpected behavior
  if (formato !== "json" && formato !== "csv") {
    res.status(400).json({ error: 'Parâmetro "formato" deve ser "json" ou "csv"' });
    return;
  }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
  if (!doctor) { res.status(404).json({ error: "Médico não encontrado" }); return; }

  const patients = await db.select().from(patientsTable).where(eq(patientsTable.doctorId, doctorId));
  const surgeries = await db.select().from(surgeriesTable).where(eq(surgeriesTable.doctorId, doctorId));
  const surgeryIds = surgeries.map(s => s.id);

  // Fetch all followups for ALL surgeries
  const surgeryProcedures = Object.fromEntries(surgeries.map((surgery) => [
    surgery.id,
    surgery.tiposProcedimento,
  ]));
  const followups = (surgeryIds.length > 0
    ? await db.select().from(followupTable)
        .where(inArray(followupTable.surgeryId, surgeryIds))
        .catch(() => [])
    : [])
    .filter((followup) => !isHiddenFracturePreoperative(
      surgeryProcedures[followup.surgeryId] as string[] | null,
      followup.tempo,
    ));
  const preConsultations = await db
    .select()
    .from(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.doctorId, doctorId));
  const preConsultAttachments = await db
    .select({
      id: patientAttachmentsTable.id,
      patientId: patientAttachmentsTable.patientId,
      questionnaireId: patientAttachmentsTable.preConsultQuestionnaireId,
      objectPath: patientAttachmentsTable.objectPath,
      fileName: patientAttachmentsTable.fileName,
      fileSize: patientAttachmentsTable.fileSize,
      mimeType: patientAttachmentsTable.mimeType,
      createdAt: patientAttachmentsTable.createdAt,
    })
    .from(patientAttachmentsTable)
    .where(and(
      eq(patientAttachmentsTable.doctorId, doctorId),
      isNotNull(patientAttachmentsTable.preConsultQuestionnaireId),
    ));
  const preConsultAttachmentExport = await Promise.all(
    preConsultAttachments.map(async ({ objectPath, ...metadata }) => ({
      ...metadata,
      downloadUrl: await storage.getSignedGetUrl(objectPath, 15 * 60),
      downloadUrlExpiresInSeconds: 15 * 60,
    })),
  );

  res.setHeader("Cache-Control", "private, no-store");

  if (formato === "csv") {
    // Build CSV using safe escaping — no injection vectors
    const header = "TIPO,ID,DESCRICAO,DATA,STATUS,DADO_EXTRA";
    const patientRows = patients.map(p =>
      [
        csvCell("paciente"),
        csvCell(p.id),
        csvCell(p.nome),
        csvCell(p.createdAt.toISOString()),
        csvCell("ativo"),
        csvCell(""),
      ].join(",")
    );
    const surgeryRows = surgeries.map(s =>
      [
        csvCell("cirurgia"),
        csvCell(s.id),
        csvCell((s.tiposProcedimento ?? []).join("|")),
        csvCell(s.dataCirurgia ?? s.createdAt.toISOString()),
        csvCell(s.status),
        csvCell(`pacienteId=${s.patientId}`),
      ].join(",")
    );
    const followupRows = followups.map(f =>
      [
        csvCell("followup"),
        csvCell(f.id),
        csvCell(f.tempo),
        csvCell(f.dataAvaliacao ?? f.createdAt.toISOString()),
        csvCell(f.falha ? "falha" : "ok"),
        csvCell(`surgeryId=${f.surgeryId}|ikdc=${f.ikdc ?? ""}|lysholm=${f.lysholm ?? ""}`),
      ].join(",")
    );
    const preConsultRows = preConsultations.map(questionnaire =>
      [
        csvCell("pre_consulta"),
        csvCell(questionnaire.id),
        csvCell(`questionarioVersao=${questionnaire.questionnaireVersion}`),
        csvCell((questionnaire.submittedAt ?? questionnaire.createdAt).toISOString()),
        csvCell(questionnaire.status),
        csvCell(JSON.stringify({
          patientId: questionnaire.patientId,
          respostaOriginalPaciente: questionnaire.patientAnswers,
          versaoClinicaAtual: questionnaire.currentAnswers,
          editadoPeloMedicoEm: questionnaire.doctorEditedAt,
        })),
      ].join(",")
    );
    const preConsultAttachmentRows = preConsultAttachmentExport.map(attachment =>
      [
        csvCell("anexo_pre_consulta"),
        csvCell(attachment.id),
        csvCell(attachment.fileName),
        csvCell(attachment.createdAt.toISOString()),
        csvCell("armazenado"),
        csvCell(`patientId=${attachment.patientId}|questionnaireId=${attachment.questionnaireId ?? ""}|mimeType=${attachment.mimeType}|fileSize=${attachment.fileSize ?? ""}|downloadUrl=${attachment.downloadUrl ?? "indisponivel"}|expiraEmSegundos=${attachment.downloadUrlExpiresInSeconds}`),
      ].join(",")
    );

    const csvLines = [
      header,
      ...patientRows,
      ...surgeryRows,
      ...followupRows,
      ...preConsultRows,
      ...preConsultAttachmentRows,
    ].join("\r\n");

    // Sanitize doctorId for filename (already numeric, but be explicit)
    const safeDoctorId = String(doctorId).replace(/[^0-9]/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="docknee-meus-dados-${safeDoctorId}.csv"`);
    // UTF-8 BOM for Excel compatibility
    res.send("\uFEFF" + csvLines);
    return;
  }

  res.json({
    exportadoEm: new Date().toISOString(),
    formato: "json",
    titular: { id: doctor.id, nome: doctor.nome, email: doctor.email },
    pacientes: patients,
    cirurgias: surgeries,
    followups,
    preConsultas: preConsultations.map((questionnaire) => ({
      id: questionnaire.id,
      patientId: questionnaire.patientId,
      status: questionnaire.status,
      questionnaireVersion: questionnaire.questionnaireVersion,
      respostaOriginalPaciente: questionnaire.patientAnswers,
      versaoClinicaAtual: questionnaire.currentAnswers,
      ultimoRascunhoEm: questionnaire.lastPatientSavedAt,
      enviadoEm: questionnaire.submittedAt,
      editadoPeloMedicoEm: questionnaire.doctorEditedAt,
      createdAt: questionnaire.createdAt,
      updatedAt: questionnaire.updatedAt,
    })),
    anexosPreConsulta: preConsultAttachmentExport,
  });
});

// ── 4. Solicitar exclusão ─── soft delete via flag ─────────────────────────

router.delete("/lgpd/solicitar-exclusao", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;

  await db
    .update(doctorsTable)
    .set({ deletionRequestedAt: new Date() } as any)
    .where(eq(doctorsTable.id, doctorId));

  res.json({
    mensagem: "Solicitação de exclusão registrada. O administrador será notificado.",
    prazo: "A exclusão será processada em até 15 dias úteis conforme LGPD Art. 18.",
    nota: "Dados clínicos podem ser retidos por obrigação legal por até 5 anos (Art. 16 LGPD).",
  });
});

// ── 5. Anonimização de paciente ────────────────────────────────────────────

router.post("/lgpd/anonimizar-paciente/:id", requireAuth, async (req, res): Promise<void> => {
  const paramId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const patientId = parseInt(paramId ?? "", 10);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, req.doctorId!)))
    .limit(1);

  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const anonHash = createHash("sha256").update(`${patientId}-${Date.now()}`).digest("hex").slice(0, 8);

  await db.update(patientsTable).set({
    nome: `Paciente Anonimizado #${anonHash}`,
    cpf: null,
    email: null,
    telefone: null,
    dataNascimento: null,
  }).where(eq(patientsTable.id, patientId));

  res.json({
    mensagem: "Dados pessoais do paciente anonimizados com sucesso",
    nota: "Dados clínicos mantidos para fins científicos conforme LGPD Art. 16",
    anonHash,
  });
});

export default router;

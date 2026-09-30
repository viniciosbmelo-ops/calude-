import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import {
  appointmentsTable,
  auditLogsTable,
  consentimentosTable,
  db,
  doctorsTable,
  lgpdRequestsTable,
  patientAttachmentsTable,
  patientsTable,
  pool,
  preConsultQuestionnairesTable,
  regenCasesTable,
} from "@workspace/docregen-db";
import { eq, and, desc, gte, isNotNull, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { csvCell } from "../lib/csv";
import { anonymizePatient } from "../lib/patientAnonymization";
import { processStorageCleanupJobs } from "../lib/storageCleanup";
import { operatorContactEmail, sendLgpdDeletionRequestEmail } from "../lib/mailer";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const TERMO_VERSAO = "1.0";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildTermoText(tipo: string, doctorId: number): string {
  return `DocRegen LGPD Consent | tipo=${tipo} | doctorId=${doctorId} | versao=${TERMO_VERSAO}`;
}

// ── 1. Consentimento ────────────────────────────────────────────────────────

router.post("/lgpd/consentimento", requireAuth, async (req, res): Promise<void> => {
  const { aceito = true, tipo = "plataforma_docregen" } = req.body as { aceito?: boolean; tipo?: string };

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
  const regenCases = await db.select().from(regenCasesTable).where(eq(regenCasesTable.doctorId, doctorId));

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
      totalCasosRegenerativos: regenCases.length,
      totalPreConsultas: preConsultations.length,
      pacientes: patients.map(p => ({ id: p.id, nome: p.nome, createdAt: p.createdAt })),
      casosRegenerativos: regenCases.map(c => ({ id: c.id, patientId: c.patientId, condicao: c.conditionCode, status: c.status, createdAt: c.createdAt })),
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

/**
 * Everything the doctor controls in DocRegen, for portability (LGPD Art. 18, V):
 * patients, regenerative cases with procedures, PROMs, labs, performance
 * tests, follow-up schedule + patient scale responses, pré-consultas,
 * attachments (metadata + short-lived signed download URLs), appointments,
 * secretaries (no password hashes), consent and LGPD requests. Link tokens
 * and password hashes are never exported.
 */
async function collectPortableData(doctorId: number) {
  const [patients, regenCases, preConsultations, attachments, appointments, consent, lgpdRequests] = await Promise.all([
    db.select().from(patientsTable).where(eq(patientsTable.doctorId, doctorId)),
    db.select().from(regenCasesTable).where(eq(regenCasesTable.doctorId, doctorId)),
    db.select().from(preConsultQuestionnairesTable).where(eq(preConsultQuestionnairesTable.doctorId, doctorId)),
    db.select({
      id: patientAttachmentsTable.id,
      patientId: patientAttachmentsTable.patientId,
      questionnaireId: patientAttachmentsTable.preConsultQuestionnaireId,
      objectPath: patientAttachmentsTable.objectPath,
      fileName: patientAttachmentsTable.fileName,
      fileSize: patientAttachmentsTable.fileSize,
      mimeType: patientAttachmentsTable.mimeType,
      category: patientAttachmentsTable.category,
      descricao: patientAttachmentsTable.descricao,
      createdAt: patientAttachmentsTable.createdAt,
    }).from(patientAttachmentsTable).where(eq(patientAttachmentsTable.doctorId, doctorId)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.doctorId, doctorId)),
    db.select().from(consentimentosTable).where(eq(consentimentosTable.doctorId, doctorId)),
    db.select().from(lgpdRequestsTable).where(eq(lgpdRequestsTable.doctorId, doctorId)),
  ]);
  const caseIds = regenCases.map((c) => c.id);
  const byCases = async (query: string) => caseIds.length ? (await pool.query(query, [caseIds])).rows : [];
  const [procedures, proms, labs, performanceTests, followups, scaleResponses, aiSummaries] = await Promise.all([
    byCases(`SELECT * FROM regen_procedures WHERE case_id = ANY($1::uuid[]) ORDER BY performed_at`),
    byCases(`SELECT * FROM regen_prom_responses WHERE case_id = ANY($1::uuid[]) ORDER BY answered_at`),
    byCases(`SELECT * FROM regen_lab_results WHERE case_id = ANY($1::uuid[]) ORDER BY collected_at`),
    byCases(`SELECT * FROM regen_performance_tests WHERE case_id = ANY($1::uuid[]) ORDER BY measured_at`),
    byCases(`SELECT id, case_id, periodo, days_after_procedure, scheduled_date, scales, status, sent_at, notes, created_at
               FROM regen_followup_notifications WHERE case_id = ANY($1::uuid[]) ORDER BY case_id, days_after_procedure`),
    byCases(`SELECT r.id, n.case_id, r.notification_id, r.nome_escala, r.respostas, r.score, r.completado_em
               FROM regen_scale_responses r JOIN regen_followup_notifications n ON n.id = r.notification_id
              WHERE n.case_id = ANY($1::uuid[]) ORDER BY r.completado_em`),
    byCases(`SELECT id, case_id, model, accepted_output, review_action, created_at
               FROM regen_ai_interactions WHERE case_id = ANY($1::uuid[]) ORDER BY created_at`),
  ]);
  const secretaries = (await pool.query(
    `SELECT id, nome, email, ativo, created_at FROM secretaries WHERE doctor_id = $1 ORDER BY id`, [doctorId],
  )).rows;
  const attachmentExport = await Promise.all(
    attachments.map(async ({ objectPath, ...metadata }) => ({
      ...metadata,
      downloadUrl: await storage.getSignedGetUrl(objectPath, 15 * 60).catch(() => null),
      downloadUrlExpiresInSeconds: 15 * 60,
    })),
  );
  return {
    patients, regenCases, procedures, proms, labs, performanceTests, followups, scaleResponses,
    aiSummaries, preConsultations, attachments: attachmentExport, appointments, secretaries,
    consent: consent[0] ?? null, lgpdRequests,
  };
}

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

  const data = await collectPortableData(doctorId);
  res.setHeader("Cache-Control", "private, no-store");

  if (formato === "csv") {
    // One row per record: TIPO, ID, REFERENCIA (owner record), DATA, RESUMO, DADOS (JSON).
    const header = "TIPO,ID,REFERENCIA,DATA,RESUMO,DADOS";
    const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
    const line = (tipo: string, id: unknown, ref: unknown, date: unknown, resumo: unknown, dados: unknown) =>
      [csvCell(tipo), csvCell(String(id ?? "")), csvCell(String(ref ?? "")), csvCell(iso(date)), csvCell(String(resumo ?? "")), csvCell(JSON.stringify(dados ?? null))].join(",");
    const rows = [
      ...data.patients.map((p) => line("paciente", p.id, p.numeroRegistro, p.createdAt, p.nome, p)),
      ...data.regenCases.map((c) => line("caso_regenerativo", c.id, `paciente=${c.patientId ?? ""}`, c.createdAt, c.conditionCustom?.trim() || c.conditionCode, c)),
      ...data.procedures.map((r: any) => line("procedimento", r.id, `caso=${r.case_id}`, r.performed_at, r.product_code, r)),
      ...data.proms.map((r: any) => line("prom", r.id, `caso=${r.case_id}`, r.answered_at, `${r.instrument} ${r.score ?? ""}`, r)),
      ...data.labs.map((r: any) => line("exame_laboratorial", r.id, `caso=${r.case_id}`, r.collected_at, `${r.analyte} ${r.value_num ?? ""} ${r.unit ?? ""}`, r)),
      ...data.performanceTests.map((r: any) => line("teste_funcional", r.id, `caso=${r.case_id}`, r.measured_at, `${r.measure} ${r.value} ${r.unit}`, r)),
      ...data.followups.map((r: any) => line("seguimento", r.id, `caso=${r.case_id}`, r.scheduled_date, `${r.periodo} (${r.status})`, r)),
      ...data.scaleResponses.map((r: any) => line("resposta_escala", r.id, `caso=${r.case_id}`, r.completado_em, `${r.nome_escala} ${r.score ?? ""}`, r)),
      ...data.aiSummaries.map((r: any) => line("resumo_ia", r.id, `caso=${r.case_id}`, r.created_at, r.review_action ?? "", r)),
      ...data.preConsultations.map((q) => line("pre_consulta", q.id, `paciente=${q.patientId}`, q.submittedAt ?? q.createdAt, q.status, {
        respostaOriginalPaciente: q.patientAnswers, versaoClinicaAtual: q.currentAnswers, editadoPeloMedicoEm: q.doctorEditedAt,
      })),
      ...data.attachments.map((a) => line("anexo", a.id, `paciente=${a.patientId}`, a.createdAt, a.fileName, a)),
      ...data.appointments.map((a) => line("agendamento", a.id, `paciente=${a.patientId}`, `${a.data} ${a.hora}`, `${a.tipo} (${a.status})`, a)),
      ...data.secretaries.map((sec: any) => line("secretaria", sec.id, "", sec.created_at, sec.nome, sec)),
      ...data.lgpdRequests.map((r) => line("solicitacao_lgpd", r.id, r.kind, r.requestedAt, r.status, r)),
    ];

    const safeDoctorId = String(doctorId).replace(/[^0-9]/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="docregen-meus-dados-${safeDoctorId}.csv"`);
    res.send("\uFEFF" + [header, ...rows].join("\r\n"));
    return;
  }

  res.json({
    exportadoEm: new Date().toISOString(),
    formato: "json",
    titular: { id: doctor.id, nome: doctor.nome, email: doctor.email },
    pacientes: data.patients,
    casosRegenerativos: data.regenCases,
    procedimentos: data.procedures,
    proms: data.proms,
    examesLaboratoriais: data.labs,
    testesFuncionais: data.performanceTests,
    seguimentos: data.followups,
    respostasEscalas: data.scaleResponses,
    resumosIA: data.aiSummaries,
    preConsultas: data.preConsultations.map((questionnaire) => ({
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
    anexos: data.attachments,
    // Kept for clients of the previous export format.
    anexosPreConsulta: data.attachments.filter((a) => a.questionnaireId !== null),
    agendamentos: data.appointments,
    secretarias: data.secretaries,
    consentimento: data.consent,
    solicitacoesLgpd: data.lgpdRequests,
  });
});

// ── 4. Solicitar exclusão (LGPD Art. 18, VI) ──────────────────────────────
//
// Registered in lgpd_requests and e-mailed to the operator (DOCREGEN_CONTACT_EMAIL).
// Handling is manual (replit.md → "LGPD — solicitações de exclusão"): account
// data is deleted, but the patients' medical records must be kept for 20 years
// (Lei 13.787/2018) and are never erased by this request.

const RETENTION_NOTE =
  "Os prontuários dos seus pacientes (casos, procedimentos, escalas, exames) não serão apagados: a lei exige a guarda do prontuário por 20 anos (Lei 13.787/2018 e normas do CFM). A exclusão abrange os dados da sua conta que não estão sujeitos a essa obrigação.";

function lgpdRequestView(request: typeof lgpdRequestsTable.$inferSelect) {
  const statusText: Record<string, string> = {
    pending: "Solicitação registrada; notificação ao responsável pendente.",
    notified: "Solicitação registrada e encaminhada ao responsável pela plataforma. Prazo de resposta: até 15 dias.",
    notification_failed: "Solicitação registrada, mas a notificação automática falhou. Entre em contato pelo canal de suporte para garantir o atendimento.",
    completed: "Solicitação concluída.",
    rejected: "Solicitação analisada e não atendida. Veja a justificativa.",
  };
  return {
    id: request.id,
    tipo: request.kind,
    status: request.status,
    descricaoStatus: statusText[request.status] ?? request.status,
    solicitadaEm: request.requestedAt,
    notificadaEm: request.notifiedAt,
    concluidaEm: request.resolvedAt,
    observacao: request.resolutionNote,
  };
}

router.get("/lgpd/solicitacoes", requireAuth, async (req, res): Promise<void> => {
  const requests = await db.select().from(lgpdRequestsTable)
    .where(eq(lgpdRequestsTable.doctorId, req.doctorId!))
    .orderBy(desc(lgpdRequestsTable.requestedAt));
  res.setHeader("Cache-Control", "no-store");
  res.json({ solicitacoes: requests.map(lgpdRequestView), nota: RETENTION_NOTE });
});

router.delete("/lgpd/solicitar-exclusao", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
  if (!doctor) { res.status(404).json({ error: "Médico não encontrado" }); return; }

  // An open request is reused (idempotent); a failed notification is retried.
  const [open] = await db.select().from(lgpdRequestsTable)
    .where(and(
      eq(lgpdRequestsTable.doctorId, doctorId),
      eq(lgpdRequestsTable.kind, "account_deletion"),
      inArray(lgpdRequestsTable.status, ["pending", "notified", "notification_failed"]),
    ))
    .orderBy(desc(lgpdRequestsTable.requestedAt))
    .limit(1);

  let request = open;
  if (!request) {
    request = await db.transaction(async (tx) => {
      const [created] = await tx.insert(lgpdRequestsTable).values({ doctorId, kind: "account_deletion" }).returning();
      await tx.update(doctorsTable).set({ deletionRequestedAt: created!.requestedAt }).where(eq(doctorsTable.id, doctorId));
      return created!;
    });
  }

  if (request.status !== "notified") {
    try {
      if (!operatorContactEmail()) throw new Error("DOCREGEN_CONTACT_EMAIL não configurado");
      await sendLgpdDeletionRequestEmail({
        requestId: request.id,
        doctorId,
        doctorName: doctor.nome,
        doctorEmail: doctor.email,
        requestedAt: request.requestedAt,
      });
      [request] = await db.update(lgpdRequestsTable)
        .set({ status: "notified", notifiedAt: new Date(), notificationError: null })
        .where(eq(lgpdRequestsTable.id, request.id)).returning();
    } catch (err) {
      logger.error({ err, requestId: request.id }, "LGPD deletion request: operator notification failed");
      [request] = await db.update(lgpdRequestsTable)
        .set({ status: "notification_failed", notificationError: err instanceof Error ? err.message.slice(0, 300) : "erro" })
        .where(eq(lgpdRequestsTable.id, request.id)).returning();
    }
  }

  const view = lgpdRequestView(request!);
  res.status(open ? 200 : 201).json({
    solicitacao: view,
    mensagem: view.descricaoStatus,
    prazo: "Resposta em até 15 dias (LGPD Art. 19, II).",
    nota: RETENTION_NOTE,
  });
});

// ── 5. Anonimização de paciente ────────────────────────────────────────────
//
// NOT a deletion of the medical record: identifiers and identifying free text
// are removed (transactionally, see lib/patientAnonymization.ts), the
// structured clinical record is kept de-identified for the legal retention
// period.

router.post("/lgpd/anonimizar-paciente/:id", requireAuth, async (req, res): Promise<void> => {
  const paramId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const patientId = Number(paramId);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const result = await anonymizePatient(req.doctorId!, patientId);
  if (!result.found) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  void processStorageCleanupJobs().catch((error) => {
    req.log.warn({ err: error, patientId }, "Falha ao processar fila de exclusão após anonimização");
  });

  res.json({
    mensagem: "Dados identificáveis do paciente anonimizados.",
    nota: "Os registros clínicos (casos, procedimentos, escalas, exames) foram mantidos de forma desidentificada, conforme a obrigação legal de guarda do prontuário por 20 anos (Lei 13.787/2018). Anexos (exames e fotos) foram enviados para exclusão definitiva.",
    removidos: [
      "nome, CPF, e-mail, telefone, data de nascimento (casos: só o ano), endereço, CEP, plano e carteirinha",
      "anamnese, laudos, observações de agenda e de procedimentos, textos livres de pré-consulta e escalas",
      "anexos (arquivos) e links públicos ativos (pré-consulta e seguimento)",
      "resumos gerados por IA e mensagens de WhatsApp para o paciente",
    ],
    mantidos: [
      "número de prontuário interno, sexo, condição, lado, procedimentos, produtos, lotes, eventos adversos",
      "escores (EVA, SANE), exames laboratoriais, testes funcionais e datas de atendimento",
    ],
    anonHash: result.anonHash,
    resumo: {
      casosRegenerativos: result.regenCases,
      anexosEnviadosParaExclusao: result.attachmentsQueuedForDeletion,
      linksDeSeguimentoRevogados: result.followupLinksRevoked,
      convitesPreConsultaRevogados: result.preConsultInvitesRevoked,
      mensagensWhatsappRemovidas: result.whatsappMessagesRedacted,
    },
  });
});

export default router;

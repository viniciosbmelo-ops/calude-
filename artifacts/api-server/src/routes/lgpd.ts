import { patientClinicalCsvExtra, patientClinicalExport } from "../lib/patient-clinical-export";
import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import {
  apoioDecisaoEscolhasTable,
  apoioDecisaoExecucoesTable,
  appointmentsTable,
  auditLogsTable,
  careLinksTable,
  consentimentosTable,
  db,
  doctorsTable,
  followupTable,
  patientAttachmentsTable,
  patientsTable,
  physioAppointmentsTable,
  physioDocumentsTable,
  physioFollowupsTable,
  physioPatientsTable,
  PHYSIO_PATIENT_ANONYMIZED,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
  regenAiInteractionsTable,
  regenCasesTable,
  regenFollowupNotificationsTable,
  regenProceduresTable,
  rehabAssessmentsTable,
  rehabInvitesTable,
  scheduledNotificationsTable,
  scheduledSurgeriesTable,
  surgeriesTable,
  whatsappContactsTable,
  whatsappConversationsTable,
  whatsappMessagesTable,
  whatsappOutboxTable,
} from "@workspace/db";
import { anonimizarExecucao } from "@workspace/clinical";
import { eq, and, gte, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { csvCell } from "../lib/csv-cell";
import { enqueueStorageCleanup, processStorageCleanupJobs } from "../lib/storageCleanup";
import { logger } from "../lib/logger";
import { limparJsonRegen, limparPlanoOtimizacao } from "../lib/regen-anonymization";
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

/** Histórico do apoio à decisão (execuções e escolhas) e casos regenerativos do médico, para acesso/portabilidade. */
async function apoioDecisaoERegenDoMedico(doctorId: number) {
  const [execucoes, escolhas, casosRegen] = await Promise.all([
    db.select().from(apoioDecisaoExecucoesTable).where(eq(apoioDecisaoExecucoesTable.doctorId, doctorId)),
    db.select().from(apoioDecisaoEscolhasTable).where(eq(apoioDecisaoEscolhasTable.doctorId, doctorId)),
    db.select().from(regenCasesTable).where(eq(regenCasesTable.doctorId, doctorId)),
  ]);
  return { execucoes, escolhas, casosRegen };
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
  const apoioERegen = await apoioDecisaoERegenDoMedico(doctorId);

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
      totalExecucoesApoioDecisao: apoioERegen.execucoes.length,
      totalCasosRegen: apoioERegen.casosRegen.length,
      pacientes: patients.map(p => ({ id: p.id, nome: p.nome, ...patientClinicalExport(p), createdAt: p.createdAt })),
      cirurgias: surgeries.map(s => ({ id: s.id, dataCirurgia: s.dataCirurgia, status: s.status, createdAt: s.createdAt })),
      followups: followups.map(f => ({
        id: f.id,
        surgeryId: f.surgeryId,
        tempo: f.tempo,
        dataAvaliacao: f.dataAvaliacao,
        vasDor: f.vasDor,
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
      execucoesApoioDecisao: apoioERegen.execucoes,
      escolhasApoioDecisao: apoioERegen.escolhas,
      casosRegen: apoioERegen.casosRegen,
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

  const apoioERegen = await apoioDecisaoERegenDoMedico(doctorId);

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
        csvCell(patientClinicalCsvExtra(p)),
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
        csvCell(`surgeryId=${f.surgeryId}|vasDor=${f.vasDor ?? ""}`),
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
    const execucaoRows = apoioERegen.execucoes.map((e) =>
      [
        csvCell("apoio_decisao_execucao"),
        csvCell(e.id),
        csvCell(`${e.algoritmoId}@${e.algoritmoVersao}`),
        csvCell(e.createdAt.toISOString()),
        csvCell(e.modo),
        csvCell(JSON.stringify({
          patientId: e.patientId,
          surgeryId: e.surgeryId,
          algoritmoHash: e.algoritmoHash,
          statusNoMomento: e.statusNoMomento,
          motorVersao: e.motorVersao,
          entrada: e.entrada,
          proveniencia: e.proveniencia,
          conflitos: e.conflitos,
          parametrosIgnorados: e.parametrosIgnorados,
          resultado: e.resultado,
        })),
      ].join(",")
    );
    const escolhaRows = apoioERegen.escolhas.map((e) =>
      [
        csvCell("apoio_decisao_escolha"),
        csvCell(e.id),
        csvCell(e.opcao ?? e.outra ?? ""),
        csvCell(e.createdAt.toISOString()),
        csvCell(e.concordancia),
        csvCell(JSON.stringify({ execucaoId: e.execucaoId, opcao: e.opcao, outra: e.outra, justificativa: e.justificativa })),
      ].join(",")
    );
    const casoRegenRows = apoioERegen.casosRegen.map((c) => {
      const { id, conditionCode, status, createdAt, ...resto } = c;
      return [
        csvCell("caso_regen"),
        csvCell(id),
        csvCell(conditionCode),
        csvCell(createdAt?.toISOString() ?? ""),
        csvCell(status ?? ""),
        csvCell(JSON.stringify(resto)),
      ].join(",");
    });

    const csvLines = [
      header,
      ...patientRows,
      ...surgeryRows,
      ...followupRows,
      ...preConsultRows,
      ...preConsultAttachmentRows,
      ...execucaoRows,
      ...escolhaRows,
      ...casoRegenRows,
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
    execucoesApoioDecisao: apoioERegen.execucoes,
    escolhasApoioDecisao: apoioERegen.escolhas,
    casosRegen: apoioERegen.casosRegen,
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
  const doctorId = req.doctorId!;

  const anonHash = createHash("sha256").update(`${patientId}-${Date.now()}`).digest("hex").slice(0, 8);

  const agora = new Date();
  const nomeAnonimo = `Paciente Anonimizado #${anonHash}`;
  const TEXTO_ANONIMIZADO = "[anonimizado]";
  const MOTIVO_CANCELAMENTO = "Cancelado: paciente anonimizado (LGPD).";

  // Tudo numa transação: cadastro e todas as cópias do paciente. O paciente é travado FOR UPDATE logo no início:
  // uma avaliação do apoio à decisão concorrente (que lê o paciente FOR SHARE e grava a execução na mesma transação)
  // ou termina antes — e a execução dela é limpa aqui — ou espera e lê o cadastro já anonimizado.
  const resultado = await db.transaction(async (tx) => {
    const [patient] = await tx.select({ id: patientsTable.id }).from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, doctorId)))
      .limit(1)
      .for("update");
    if (!patient) return null;

    // Cadastro: identificação, contato, endereço, convênio, indicação e texto livre (anamnese/laudos) apagados.
    // Perfil clínico (lado dominante, tabagismo, diabetes, nível de atividade) também: tabagismo e diabetes são dados
    // de saúde sensíveis (Art. 11) e, numa base pequena, ajudam a reidentificar. Ficam: sexo, lado operado, Beighton
    // e o número de registro interno (derivado do id, sem dado pessoal).
    await tx.update(patientsTable).set({
      nome: nomeAnonimo,
      cpf: null,
      email: null,
      telefone: null,
      dataNascimento: null,
      ladoDominante: null,
      tabagismo: null,
      diabetes: null,
      nivelAtividade: null,
      anamnese: null,
      laudos: null,
      planoSaude: null,
      numeroCarteirinha: null,
      indicadoPor: null,
      pais: null,
      endereco: null,
      cidade: null,
      estado: null,
      cep: null,
    }).where(eq(patientsTable.id, patientId));

    // Apoio à decisão: execuções do paciente ou das cirurgias dele perdem as entradas do perfil do paciente
    // (e a idade); algoritmo, versão, hash, motor, status, modo, opções/forças e a escolha do cirurgião ficam.
    const cirurgias = tx.select({ id: surgeriesTable.id }).from(surgeriesTable)
      .where(and(eq(surgeriesTable.patientId, patientId), eq(surgeriesTable.doctorId, doctorId)));
    const execs = await tx.select().from(apoioDecisaoExecucoesTable).where(and(
      eq(apoioDecisaoExecucoesTable.doctorId, doctorId),
      or(eq(apoioDecisaoExecucoesTable.patientId, patientId), inArray(apoioDecisaoExecucoesTable.surgeryId, cirurgias)),
    ));
    for (const e of execs) {
      const a = anonimizarExecucao(e, agora);
      await tx.update(apoioDecisaoExecucoesTable).set({
        entrada: a.entrada,
        proveniencia: a.proveniencia,
        conflitos: a.conflitos,
        resultado: a.resultado,
      }).where(eq(apoioDecisaoExecucoesTable.id, e.id));
    }
    // Escolha do cirurgião: a opção e a concordância ficam; o texto livre ("outra" vira marcador, para não perder
    // que a escolha foi fora das opções) e a justificativa saem.
    const escolhas = execs.length === 0 ? [] : await tx.update(apoioDecisaoEscolhasTable).set({
      outra: sql`CASE WHEN ${apoioDecisaoEscolhasTable.outra} IS NULL THEN NULL ELSE ${TEXTO_ANONIMIZADO} END`,
      justificativa: null,
    }).where(and(
      eq(apoioDecisaoEscolhasTable.doctorId, doctorId),
      inArray(apoioDecisaoEscolhasTable.execucaoId, execs.map((e) => e.id)),
    )).returning({ id: apoioDecisaoEscolhasTable.id });

    // Regenerativa: o caso se liga ao paciente só por `patient_id` (vínculo opcional, sem FK; a rota confere que o
    // paciente é do médico ao gravar). Só casos vinculados a ESTE paciente e deste médico são limpos; casos legados
    // sem vínculo não são adivinhados por nome.
    const casos = await tx.select({
      id: regenCasesTable.id,
      anamneseRegen: regenCasesTable.anamneseRegen,
      planoOtimizacao: regenCasesTable.planoOtimizacao,
      productDetails: regenCasesTable.productDetails,
      priorTreatDates: regenCasesTable.priorTreatDates,
      complianceFlags: regenCasesTable.complianceFlags,
    }).from(regenCasesTable).where(and(
      eq(regenCasesTable.patientId, patientId),
      eq(regenCasesTable.doctorId, doctorId),
    ));
    for (const c of casos) {
      await tx.update(regenCasesTable).set({
        patientName: nomeAnonimo,
        patientDob: null,
        patientPhone: null,
        dm: null,
        hba1c: null,
        anamneseRegen: limparJsonRegen(c.anamneseRegen ?? {}),
        planoOtimizacao: limparPlanoOtimizacao(c.planoOtimizacao ?? {}),
        // Texto livre do caso (condição/objetivo "outro", local do atendimento) e chaves livres nos demais JSON.
        // `co_meds` ({ name, dose } do fármaco) fica: o filtro de chaves tiraria o nome do medicamento.
        conditionCustom: null,
        goalCustom: null,
        hospitalLocal: null,
        productDetails: limparJsonRegen(c.productDetails ?? {}),
        priorTreatDates: limparJsonRegen(c.priorTreatDates ?? {}),
        complianceFlags: limparJsonRegen(c.complianceFlags ?? []),
        updatedAt: agora,
      }).where(eq(regenCasesTable.id, c.id));
    }
    let notificacoesRegen = 0;
    let procedimentosRegen = 0;
    if (casos.length > 0) {
      const caseIds = casos.map((c) => c.id);
      // Resumos de IA do caso: texto livre gerado com nome, nascimento e diabetes. A linha (modelo, revisão) fica.
      const marca = { anonimizado: true, anonimizadoEm: agora.toISOString() };
      await tx.update(regenAiInteractionsTable)
        .set({ rawOutput: marca, acceptedOutput: marca, reviewNote: null })
        .where(inArray(regenAiInteractionsTable.caseId, caseIds));
      // Procedimentos: texto livre (notas, descrição do evento adverso) apagado; produto, lote, volume, via, se houve
      // evento adverso e o resultado de conformidade ficam. Chaves livres no JSON do biológico saem.
      const procs = await tx.select({ id: regenProceduresTable.id, biologicDetails: regenProceduresTable.biologicDetails })
        .from(regenProceduresTable)
        .where(and(inArray(regenProceduresTable.caseId, caseIds), eq(regenProceduresTable.doctorId, doctorId)));
      for (const pr of procs) {
        await tx.update(regenProceduresTable).set({
          notes: null,
          adverseEventDesc: null,
          biologicDetails: limparJsonRegen(pr.biologicDetails ?? {}),
        }).where(eq(regenProceduresTable.id, pr.id));
      }
      procedimentosRegen = procs.length;
      // Notas livres dos follow-ups do caso (escalas e respostas ficam).
      notificacoesRegen = (await tx.update(regenFollowupNotificationsTable)
        .set({ notes: null })
        .where(inArray(regenFollowupNotificationsTable.caseId, caseIds))
        .returning({ id: regenFollowupNotificationsTable.id })).length;
    }

    // Fisioterapia: o fisio perde o acesso ao paciente. Convites pendentes revogados, vínculos de cuidado
    // revogados, a cópia do cadastro do fisio vira "anonymized" (nenhuma rota do fisio lista ou abre) sem
    // identificação; prontuário privado do fisio (texto livre + PDF), agenda e tarefas de follow-up apagados.
    // As avaliações estruturadas (rehab_assessments: tipo, fase, medidas) ficam para estatística, inalcançáveis.
    const convitesFisio = await tx.update(rehabInvitesTable)
      .set({ status: "revoked" })
      .where(and(
        eq(rehabInvitesTable.patientId, patientId),
        eq(rehabInvitesTable.surgeonId, doctorId),
        eq(rehabInvitesTable.status, "pending"),
      ))
      .returning({ id: rehabInvitesTable.id });
    const vinculosFisio = await tx.update(careLinksTable)
      .set({ status: "revoked_by_surgeon" })
      .where(and(
        eq(careLinksTable.patientId, patientId),
        eq(careLinksTable.surgeonId, doctorId),
        eq(careLinksTable.status, "active"),
      ))
      .returning({ id: careLinksTable.id });
    const fisioPacientes = await tx.update(physioPatientsTable).set({
      fullName: nomeAnonimo,
      cpf: null,
      birthDate: null,
      phone: null,
      diagnosis: null,
      status: PHYSIO_PATIENT_ANONYMIZED,
    }).where(eq(physioPatientsTable.patientId, patientId))
      .returning({ id: physioPatientsTable.id });
    const fisioPacienteIds = fisioPacientes.map((p) => p.id);
    const caminhosArquivos: string[] = [];
    let documentosFisio = 0;
    if (fisioPacienteIds.length > 0) {
      const docs = await tx.delete(physioDocumentsTable)
        .where(inArray(physioDocumentsTable.physioPatientId, fisioPacienteIds))
        .returning({ id: physioDocumentsTable.id, pdfUrl: physioDocumentsTable.pdfUrl });
      documentosFisio = docs.length;
      for (const d of docs) if (d.pdfUrl) caminhosArquivos.push(d.pdfUrl);
      await tx.delete(physioAppointmentsTable).where(inArray(physioAppointmentsTable.physioPatientId, fisioPacienteIds));
      await tx.delete(physioFollowupsTable).where(inArray(physioFollowupsTable.physioPatientId, fisioPacienteIds));
    }

    // Pré-consulta: respostas (rascunho, original do paciente, versão clínica) zeradas; status e datas ficam.
    // Convites ativos revogados, para o link do paciente não reabrir o questionário.
    const preConsultas = await tx.update(preConsultQuestionnairesTable).set({
      draftAnswers: {},
      patientAnswers: sql`CASE WHEN ${preConsultQuestionnairesTable.patientAnswers} IS NULL THEN NULL ELSE '{}'::jsonb END`,
      currentAnswers: sql`CASE WHEN ${preConsultQuestionnairesTable.currentAnswers} IS NULL THEN NULL ELSE '{}'::jsonb END`,
    }).where(and(
      eq(preConsultQuestionnairesTable.patientId, patientId),
      eq(preConsultQuestionnairesTable.doctorId, doctorId),
    )).returning({ id: preConsultQuestionnairesTable.id });
    await tx.update(preConsultInvitesTable).set({ status: "revoked", revokedAt: agora }).where(and(
      eq(preConsultInvitesTable.patientId, patientId),
      eq(preConsultInvitesTable.doctorId, doctorId),
      eq(preConsultInvitesTable.status, "active"),
    ));

    // Anexos do paciente (pré-consulta e prontuário): linhas apagadas e arquivos na fila durável de remoção do
    // storage, gravada nesta mesma transação; a remoção roda depois do commit e é refeita até dar certo.
    const anexos = await tx.delete(patientAttachmentsTable).where(and(
      eq(patientAttachmentsTable.patientId, patientId),
      eq(patientAttachmentsTable.doctorId, doctorId),
    )).returning({ objectPath: patientAttachmentsTable.objectPath });
    caminhosArquivos.push(...anexos.map((a) => a.objectPath));
    await enqueueStorageCleanup(tx, caminhosArquivos);

    // Agenda do médico: observações livres das consultas e cirurgias agendadas; convênio da cirurgia agendada.
    const consultas = await tx.update(appointmentsTable).set({ observacoes: null }).where(and(
      eq(appointmentsTable.patientId, patientId),
      eq(appointmentsTable.doctorId, doctorId),
    )).returning({ id: appointmentsTable.id });
    const cirurgiasAgendadas = await tx.update(scheduledSurgeriesTable).set({ observacoes: null, planoSaude: null }).where(and(
      eq(scheduledSurgeriesTable.patientId, patientId),
      eq(scheduledSurgeriesTable.doctorId, doctorId),
    )).returning({ id: scheduledSurgeriesTable.id });

    // Fila de WhatsApp: mensagens ligadas ao paciente — follow-ups agendados dele, broadcast do médico para ele
    // (chave `broadcast:<médico>:<pedido>:<paciente>`) e alertas de reabilitação das avaliações dele. Texto vira
    // marcador; destinatário (telefone do paciente) apagado, exceto no alerta de reabilitação, cujo destinatário é o
    // cirurgião. O que ainda não saiu (pending) é cancelado; o que está em envio/incerto fica para a auditoria.
    const notificacoesDoPaciente = tx.select({ id: scheduledNotificationsTable.id }).from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.patientId, patientId));
    const condFollowup = inArray(whatsappOutboxTable.scheduledNotificationId, notificacoesDoPaciente);
    const condBroadcast = and(
      eq(whatsappOutboxTable.eventType, "doctor_broadcast"),
      like(whatsappOutboxTable.idempotencyKey, `broadcast:${doctorId}:%:${patientId}`),
    )!;
    const avaliacoesFisio = tx.select({ id: rehabAssessmentsTable.id }).from(rehabAssessmentsTable)
      .innerJoin(physioPatientsTable, eq(physioPatientsTable.id, rehabAssessmentsTable.physioPatientId))
      .where(eq(physioPatientsTable.patientId, patientId));
    const condAlertaFisio = and(
      eq(whatsappOutboxTable.eventType, "rehab_red_flag"),
      inArray(whatsappOutboxTable.assessmentId, avaliacoesFisio),
    )!;
    const cancelarPendente = {
      status: sql`CASE WHEN ${whatsappOutboxTable.status} = 'pending' THEN 'failed' ELSE ${whatsappOutboxTable.status} END`,
      failedAt: sql`CASE WHEN ${whatsappOutboxTable.status} = 'pending' THEN now() ELSE ${whatsappOutboxTable.failedAt} END`,
      lastError: sql`CASE WHEN ${whatsappOutboxTable.status} = 'pending' THEN ${MOTIVO_CANCELAMENTO} ELSE ${whatsappOutboxTable.lastError} END`,
    };
    const outboxPaciente = await tx.update(whatsappOutboxTable)
      .set({ recipient: "", message: TEXTO_ANONIMIZADO, ...cancelarPendente })
      .where(or(condFollowup, condBroadcast))
      .returning({ id: whatsappOutboxTable.id });
    const outboxAlerta = await tx.update(whatsappOutboxTable)
      .set({ message: TEXTO_ANONIMIZADO, ...cancelarPendente })
      .where(condAlertaFisio)
      .returning({ id: whatsappOutboxTable.id });
    // Follow-ups agendados do paciente que ainda não saíram não serão enviados (o telefone já foi apagado).
    await tx.update(scheduledNotificationsTable).set({
      status: "skipped", lastError: MOTIVO_CANCELAMENTO, nextAttemptAt: null, claimedAt: null,
    }).where(and(
      eq(scheduledNotificationsTable.patientId, patientId),
      inArray(scheduledNotificationsTable.status, ["pending", "processing"]),
    ));
    await tx.update(scheduledNotificationsTable).set({ notes: null })
      .where(eq(scheduledNotificationsTable.patientId, patientId));

    // CRM de WhatsApp: contatos ligados ao paciente (no contato ou numa conversa) perdem telefone e nomes; as
    // conversas perdem a prévia e o id do provedor; o texto das mensagens vira marcador. O telefone vira um
    // identificador único sem dado pessoal (a coluna é obrigatória e única); nova mensagem desse número cria outro
    // contato, sem vínculo.
    const conversasLigadas = await tx.select({ id: whatsappConversationsTable.id, contactId: whatsappConversationsTable.contactId })
      .from(whatsappConversationsTable)
      .where(eq(whatsappConversationsTable.patientId, patientId));
    const contatosLigados = await tx.select({ id: whatsappContactsTable.id }).from(whatsappContactsTable)
      .where(or(
        eq(whatsappContactsTable.patientId, patientId),
        conversasLigadas.length > 0
          ? inArray(whatsappContactsTable.id, conversasLigadas.map((c) => c.contactId))
          : sql`false`,
      ));
    const contatoIds = contatosLigados.map((c) => c.id);
    let conversasWhatsapp = 0;
    let mensagensWhatsapp = 0;
    if (contatoIds.length > 0) {
      for (const id of contatoIds) {
        await tx.update(whatsappContactsTable)
          .set({ phoneE164: `anonimizado:${id}:${anonHash}`, displayName: null, profileName: null })
          .where(eq(whatsappContactsTable.id, id));
      }
      const conversas = await tx.update(whatsappConversationsTable)
        .set({ lastMessagePreview: null, providerConversationId: null })
        .where(inArray(whatsappConversationsTable.contactId, contatoIds))
        .returning({ id: whatsappConversationsTable.id });
      conversasWhatsapp = conversas.length;
      if (conversas.length > 0) {
        mensagensWhatsapp = (await tx.update(whatsappMessagesTable)
          .set({ content: TEXTO_ANONIMIZADO })
          .where(inArray(whatsappMessagesTable.conversationId, conversas.map((c) => c.id)))
          .returning({ id: whatsappMessagesTable.id })).length;
      }
    }

    return {
      execucoes: execs.length,
      escolhas: escolhas.length,
      casosRegen: casos.length,
      notificacoesRegen,
      procedimentosRegen,
      fisio: {
        pacientes: fisioPacienteIds.length,
        vinculosRevogados: vinculosFisio.length,
        convitesRevogados: convitesFisio.length,
        documentosApagados: documentosFisio,
      },
      preConsultas: preConsultas.length,
      anexos: anexos.length,
      consultas: consultas.length,
      cirurgiasAgendadas: cirurgiasAgendadas.length,
      whatsappOutbox: outboxPaciente.length + outboxAlerta.length,
      whatsappContatos: contatoIds.length,
      conversasWhatsapp,
      mensagensWhatsapp,
      arquivosNaFila: caminhosArquivos.length,
    };
  });

  if (!resultado) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  if (resultado.arquivosNaFila > 0) {
    // Depois do commit; falha aqui não desfaz nada — a fila durável refaz a remoção.
    void processStorageCleanupJobs(10).catch((error) => {
      logger.warn({ err: error, patientId }, "Remoção imediata de arquivos do paciente anonimizado falhou; a fila vai refazer");
    });
  }

  res.json({
    mensagem: "Dados pessoais do paciente anonimizados com sucesso",
    nota: "Dados clínicos das cirurgias mantidos para fins científicos conforme LGPD Art. 16. Apagados: identificação, contato, endereço, convênio, indicação, anamnese/laudos e perfil clínico do cadastro; cópias nas execuções do apoio à decisão (e texto livre das escolhas), casos regenerativos, cadastro e prontuário do fisioterapeuta (que perde o acesso), pré-consulta, anexos, observações da agenda, fila e CRM de WhatsApp. Mensagens avulsas de WhatsApp (envio manual por telefone, sem vínculo ao paciente) e registros de auditoria não são alterados.",
    anonHash,
    execucoesApoioDecisao: resultado.execucoes,
    escolhasApoioDecisao: resultado.escolhas,
    casosRegen: resultado.casosRegen,
    notificacoesRegen: resultado.notificacoesRegen,
    procedimentosRegen: resultado.procedimentosRegen,
    fisioterapia: resultado.fisio,
    preConsultas: resultado.preConsultas,
    anexos: resultado.anexos,
    consultas: resultado.consultas,
    cirurgiasAgendadas: resultado.cirurgiasAgendadas,
    whatsappOutbox: resultado.whatsappOutbox,
    whatsappContatos: resultado.whatsappContatos,
    whatsappConversas: resultado.conversasWhatsapp,
    whatsappMensagens: resultado.mensagensWhatsapp,
  });
});

export default router;

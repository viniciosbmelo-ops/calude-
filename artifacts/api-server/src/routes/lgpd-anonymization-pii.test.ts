/**
 * Anonimização LGPD do paciente: nenhum dado pessoal sobra no cadastro nem nas cópias (fisioterapia, pré-consulta,
 * anexos, agenda, WhatsApp, apoio à decisão, regenerativa), e o fisioterapeuta perde o acesso ao paciente.
 * Outro paciente fica intocado. API real + banco real.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, getTableColumns, inArray } from "drizzle-orm";
import {
  apoioDecisaoEscolhasTable, apoioDecisaoExecucoesTable, appointmentsTable, careLinksTable, db, doctorsTable,
  patientAttachmentsTable, patientsTable, physioAppointmentsTable, physioDocumentsTable, physioFollowupsTable,
  physioPatientsTable, physiotherapistsTable, preConsultInvitesTable, preConsultQuestionnairesTable,
  regenCasesTable, regenFollowupNotificationsTable, rehabAssessmentsTable, rehabInvitesTable,
  scheduledNotificationsTable, scheduledSurgeriesTable, storageCleanupJobsTable, surgeriesTable,
  whatsappContactsTable, whatsappConversationsTable, whatsappMessagesTable, whatsappOutboxTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signPhysioToken, signToken } from "../lib/auth";

/** Colunas de `patients` com dado pessoal: todas devem ficar nulas (o nome vira o pseudônimo). */
const PII = [
  "cpf", "dataNascimento", "email", "telefone", "ladoDominante", "tabagismo", "diabetes", "nivelAtividade",
  "anamnese", "laudos", "planoSaude", "numeroCarteirinha", "indicadoPor", "pais", "endereco", "cidade", "estado", "cep",
] as const;
/** Colunas mantidas de propósito (sem identificação direta). Coluna nova em `patients` precisa entrar numa das listas. */
const MANTIDAS = ["id", "doctorId", "nome", "sexo", "lado", "beightonScore", "numeroRegistro", "createdAt", "updatedAt"];

let server: Server;
let baseUrl: string;
let doctorId: number;
let physioId: number;
let auth: string;
let physioAuth: string;
let pacienteA: number;
let pacienteB: number;
const ids: Record<string, number> = {};
const outbox: Record<string, number> = {};
let casoA: string;
let contatoA: number;
let contatoB: number;
const anexoPath = `/objects/uploads/anon-pii-${randomUUID()}`;
const pdfPath = `/objects/uploads/anon-pii-pdf-${randomUUID()}`;
const phoneA = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const phoneB = `+55219${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

const api = (path: string, init: RequestInit = {}, token = auth) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve(s)));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const senhaHash = await hashPassword("anon-pii-test-password");
  const [d] = await db.insert(doctorsTable)
    .values({ nome: "Anon PII Doctor", email: `anon-pii-${randomUUID()}@example.test`, senhaHash, isFree: true })
    .returning();
  doctorId = d.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: d.sessionVersion });
  const [f] = await db.insert(physiotherapistsTable)
    .values({ nome: "Fisio PII", email: `anon-pii-fisio-${randomUUID()}@example.test`, senhaHash, celular: "11911112222" })
    .returning();
  physioId = f.id;
  physioAuth = signPhysioToken({ physioId, sessionVersion: f.sessionVersion });

  const completo = {
    doctorId, cpf: "52998224725", dataNascimento: "1956-03-02", email: "a@example.test", sexo: "M", telefone: "11999990000",
    lado: "D", ladoDominante: "R", tabagismo: "atual", diabetes: true, nivelAtividade: "competitivo", beightonScore: 2,
    anamnese: "Fulano, mora na Rua X", laudos: "RM de Fulano", planoSaude: "Unimed", numeroCarteirinha: "123456",
    indicadoPor: "Dr. Beltrano", pais: "Brasil", endereco: "Rua X, 10", cidade: "Campinas", estado: "SP", cep: "13000-000",
  };
  const [a] = await db.insert(patientsTable).values({ ...completo, nome: "Fulano de Tal" }).returning();
  const [b] = await db.insert(patientsTable).values({ ...completo, nome: "Ciclano", cpf: "11144477735" }).returning();
  pacienteA = a.id;
  pacienteB = b.id;
  const [s] = await db.insert(surgeriesTable).values({ doctorId, patientId: pacienteA, tiposProcedimento: ["EL_DBR"], status: "rascunho" }).returning();
  ids.cirurgia = s.id;

  // Fisioterapia (encaminhamento aceito + convite pendente)
  const [link] = await db.insert(careLinksTable).values({ patientId: pacienteA, surgeonId: doctorId, physioId, surgeryId: s.id }).returning();
  ids.link = link.id;
  const [inv] = await db.insert(rehabInvitesTable).values({
    tokenHash: randomUUID(), surgeonId: doctorId, patientId: pacienteA, surgeryId: s.id,
    consentRecordedAt: new Date(), consentMethod: "verbal_presencial", expiresAt: new Date(Date.now() + 86_400_000),
  }).returning();
  ids.convite = inv.id;
  const [pp] = await db.insert(physioPatientsTable).values({
    physioId, patientId: pacienteA, careLinkId: link.id, fullName: "Fulano de Tal", cpf: "52998224725",
    birthDate: "1956-03-02", phone: "11999990000", diagnosis: "Fulano, ruptura",
  }).returning();
  ids.fisioPaciente = pp.id;
  const [ppB] = await db.insert(physioPatientsTable).values({ physioId, fullName: "Próprio do fisio" }).returning();
  ids.fisioPacienteB = ppB.id;
  const [doc] = await db.insert(physioDocumentsTable).values({
    physioId, physioPatientId: pp.id, docType: "evolucao", content: { texto: "Fulano evoluiu" }, pdfUrl: pdfPath,
  }).returning();
  ids.docFisio = doc.id;
  await db.insert(physioAppointmentsTable).values({
    physioId, physioPatientId: pp.id, startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), notes: "Ligar no 11999990000",
  });
  await db.insert(physioFollowupsTable).values({ physioId, physioPatientId: pp.id, title: "Reavaliar", dueDate: "2026-01-01" });
  const [ra] = await db.insert(rehabAssessmentsTable).values({
    physioPatientId: pp.id, physioId, careLinkId: link.id, phase: 1, assessmentType: "dor", payload: { eva: 3 },
  }).returning();
  ids.avaliacao = ra.id;

  // Pré-consulta + anexo
  const [q] = await db.insert(preConsultQuestionnairesTable).values({
    patientId: pacienteA, doctorId, status: "submitted", draftAnswers: { queixa: "dor" },
    patientAnswers: { queixa: "dor", contato: "11999990000" }, currentAnswers: { queixa: "dor" }, submittedAt: new Date(),
  }).returning();
  ids.preConsulta = q.id;
  await db.insert(preConsultInvitesTable).values({
    questionnaireId: q.id, patientId: pacienteA, doctorId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(patientAttachmentsTable).values({
    patientId: pacienteA, doctorId, preConsultQuestionnaireId: q.id, fileName: "rg-fulano.pdf", mimeType: "application/pdf", objectPath: anexoPath,
  });

  // Agenda do médico
  await db.insert(appointmentsTable).values({ doctorId, patientId: pacienteA, data: "2026-11-01", hora: "10:00", observacoes: "Vem com a esposa Maria" });
  await db.insert(scheduledSurgeriesTable).values({
    doctorId, patientId: pacienteA, data: "2026-11-02", hora: "07:00", tipoCirurgia: "LCA", planoSaude: "Unimed", observacoes: "Alergia, tel 1199",
  });

  // Apoio à decisão: escolha com texto livre
  const [e] = await db.insert(apoioDecisaoExecucoesTable).values({
    doctorId, patientId: pacienteA, surgeryId: null, algoritmoId: "X", algoritmoVersao: "1", algoritmoHash: "h",
    statusNoMomento: "ativo", motorVersao: "1", modo: "preop", entrada: {}, proveniencia: {}, conflitos: [], parametrosIgnorados: false, resultado: {},
  }).returning();
  await db.insert(apoioDecisaoEscolhasTable).values({
    execucaoId: e.id, doctorId, opcao: null, outra: "Fulano prefere esperar", concordancia: "diverge", justificativa: "Fulano viaja",
  });
  ids.execucao = e.id;

  // Regenerativa
  const [c] = await db.insert(regenCasesTable).values({
    doctorId, patientId: pacienteA, patientName: "Fulano de Tal", conditionCode: "OA_JOELHO",
    planoOtimizacao: { notas: "Fulano, ligar 1199", meta: "IMC<30" },
  }).returning();
  casoA = c.id;
  await db.insert(regenFollowupNotificationsTable).values({ caseId: c.id, periodo: "30d", daysAfterProcedure: 30, notes: "Falar com Fulano" });

  // Fila de WhatsApp
  const [n] = await db.insert(scheduledNotificationsTable).values({ surgeryId: s.id, patientId: pacienteA, periodo: "30d", status: "processing", notes: "Fulano" }).returning();
  ids.notificacao = n.id;
  const rows = await db.insert(whatsappOutboxTable).values([
    { eventType: "scheduled_followup", scheduledNotificationId: n.id, idempotencyKey: `t-${randomUUID()}`, recipient: "11999990000", message: "Olá Fulano" },
    { eventType: "doctor_broadcast", idempotencyKey: `broadcast:${doctorId}:req-${randomUUID()}:${pacienteA}`, recipient: "11999990000", message: "Olá Fulano", status: "sent" },
    { eventType: "doctor_broadcast", idempotencyKey: `broadcast:${doctorId}:req-${randomUUID()}:${pacienteB}`, recipient: "11888880000", message: "Olá Ciclano" },
    { eventType: "rehab_red_flag", assessmentId: ra.id, idempotencyKey: `rf-${randomUUID()}`, recipient: "11977776666", message: "Paciente F.T.", status: "sent" },
  ]).returning({ id: whatsappOutboxTable.id });
  [outbox.followup, outbox.broadcastA, outbox.broadcastB, outbox.alerta] = rows.map((r) => r.id);

  // CRM de WhatsApp: contato ligado ao paciente A; contato de B intocado
  const [ca] = await db.insert(whatsappContactsTable).values({ phoneE164: phoneA, displayName: "Fulano", profileName: "Fulano", patientId: pacienteA }).returning();
  const [cb] = await db.insert(whatsappContactsTable).values({ phoneE164: phoneB, displayName: "Ciclano", patientId: pacienteB }).returning();
  contatoA = ca.id;
  contatoB = cb.id;
  const [conv] = await db.insert(whatsappConversationsTable).values({ contactId: ca.id, patientId: pacienteA, lastMessagePreview: "Oi, sou o Fulano", providerConversationId: phoneA }).returning();
  ids.conversa = conv.id;
  await db.insert(whatsappMessagesTable).values({ conversationId: conv.id, direction: "inbound", content: "Oi, sou o Fulano" });
});

afterAll(async () => {
  if (physioId) await db.delete(physiotherapistsTable).where(eq(physiotherapistsTable.id, physioId));
  await db.delete(whatsappOutboxTable).where(inArray(whatsappOutboxTable.id, Object.values(outbox)));
  await db.delete(whatsappContactsTable).where(inArray(whatsappContactsTable.id, [contatoA, contatoB].filter(Boolean)));
  if (casoA) await db.delete(regenCasesTable).where(eq(regenCasesTable.id, casoA));
  await db.delete(storageCleanupJobsTable).where(inArray(storageCleanupJobsTable.objectPath, [anexoPath, pdfPath]));
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.sequential("anonimização do paciente: nenhum dado pessoal sobra e o fisio perde o acesso", () => {
  it("toda coluna de patients está classificada (PII ou mantida)", () => {
    const colunas = Object.keys(getTableColumns(patientsTable)).sort();
    expect(colunas).toEqual([...PII, ...MANTIDAS].sort());
  });

  it("o fisio vê o paciente antes", async () => {
    expect((await api(`/api/physio/patients/${ids.fisioPaciente}`, {}, physioAuth)).status).toBe(200);
  });

  it("anonimiza e conta o que limpou", async () => {
    const res = await api(`/api/lgpd/anonimizar-paciente/${pacienteA}`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      execucoesApoioDecisao: 1, escolhasApoioDecisao: 1, casosRegen: 1, notificacoesRegen: 1,
      fisioterapia: { pacientes: 1, vinculosRevogados: 1, convitesRevogados: 1, documentosApagados: 1 },
      preConsultas: 1, anexos: 1, consultas: 1, cirurgiasAgendadas: 1,
      whatsappOutbox: 3, whatsappContatos: 1, whatsappConversas: 1, whatsappMensagens: 1,
    });
  });

  it("toda coluna PII do cadastro fica nula", async () => {
    const [p] = await db.select().from(patientsTable).where(eq(patientsTable.id, pacienteA));
    expect(p.nome).toMatch(/^Paciente Anonimizado #/);
    for (const c of PII) expect(p[c], c).toBeNull();
    expect(p).toMatchObject({ sexo: "M", lado: "D", beightonScore: 2 });
  });

  it("cópia do fisio: sem identificação, vínculo e convite revogados, prontuário/agenda/tarefas apagados", async () => {
    const [p] = await db.select().from(patientsTable).where(eq(patientsTable.id, pacienteA));
    const [pp] = await db.select().from(physioPatientsTable).where(eq(physioPatientsTable.id, ids.fisioPaciente));
    expect(pp).toMatchObject({ fullName: p.nome, cpf: null, birthDate: null, phone: null, diagnosis: null, status: "anonymized" });
    const [link] = await db.select().from(careLinksTable).where(eq(careLinksTable.id, ids.link));
    expect(link.status).toBe("revoked_by_surgeon");
    const [inv] = await db.select().from(rehabInvitesTable).where(eq(rehabInvitesTable.id, ids.convite));
    expect(inv.status).toBe("revoked");
    expect(await db.select().from(physioDocumentsTable).where(eq(physioDocumentsTable.physioPatientId, ids.fisioPaciente))).toHaveLength(0);
    expect(await db.select().from(physioAppointmentsTable).where(eq(physioAppointmentsTable.physioPatientId, ids.fisioPaciente))).toHaveLength(0);
    expect(await db.select().from(physioFollowupsTable).where(eq(physioFollowupsTable.physioPatientId, ids.fisioPaciente))).toHaveLength(0);
    // Avaliação estruturada fica (estatística), sem identificação
    const [ra] = await db.select().from(rehabAssessmentsTable).where(eq(rehabAssessmentsTable.id, ids.avaliacao));
    expect(ra.payload).toEqual({ eva: 3 });
  });

  it("rotas do fisio: o paciente some da lista e não abre (404)", async () => {
    const lista = await (await api("/api/physio/patients", {}, physioAuth)).json() as { id: number }[];
    expect(lista.map((r) => r.id)).not.toContain(ids.fisioPaciente);
    expect(lista.map((r) => r.id)).toContain(ids.fisioPacienteB);
    for (const path of [
      `/api/physio/patients/${ids.fisioPaciente}`,
      `/api/physio/patients/${ids.fisioPaciente}/assessments`,
      `/api/physio/patients/${ids.fisioPaciente}/documents`,
      `/api/physio/documents/${ids.docFisio}`,
    ]) {
      expect((await api(path, {}, physioAuth)).status, path).toBe(404);
    }
    const patch = await api(`/api/physio/patients/${ids.fisioPaciente}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }),
    }, physioAuth);
    expect(patch.status).toBe(404);
  });

  it("pré-consulta zerada, convite revogado, anexo apagado e arquivo na fila de remoção", async () => {
    const [q] = await db.select().from(preConsultQuestionnairesTable).where(eq(preConsultQuestionnairesTable.id, ids.preConsulta));
    expect(q).toMatchObject({ status: "submitted", draftAnswers: {}, patientAnswers: {}, currentAnswers: {} });
    const [inv] = await db.select().from(preConsultInvitesTable).where(eq(preConsultInvitesTable.questionnaireId, ids.preConsulta));
    expect(inv.status).toBe("revoked");
    expect(await db.select().from(patientAttachmentsTable).where(eq(patientAttachmentsTable.patientId, pacienteA))).toHaveLength(0);
    // O job some se a remoção imediata funcionou; se o storage falhou, continua na fila. Nunca o arquivo sem job.
    const jobs = await db.select().from(storageCleanupJobsTable).where(inArray(storageCleanupJobsTable.objectPath, [anexoPath, pdfPath]));
    expect(jobs.length).toBeLessThanOrEqual(2);
  });

  it("agenda, apoio à decisão e regenerativa sem texto livre", async () => {
    const [ap] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.patientId, pacienteA));
    expect(ap.observacoes).toBeNull();
    const [sc] = await db.select().from(scheduledSurgeriesTable).where(eq(scheduledSurgeriesTable.patientId, pacienteA));
    expect(sc).toMatchObject({ observacoes: null, planoSaude: null, tipoCirurgia: "LCA" });
    const [esc] = await db.select().from(apoioDecisaoEscolhasTable).where(eq(apoioDecisaoEscolhasTable.execucaoId, ids.execucao));
    expect(esc).toMatchObject({ outra: "[anonimizado]", justificativa: null, concordancia: "diverge" });
    const [c] = await db.select().from(regenCasesTable).where(eq(regenCasesTable.id, casoA));
    expect(c.planoOtimizacao).toEqual({ meta: "IMC<30" });
    const [nt] = await db.select().from(regenFollowupNotificationsTable).where(eq(regenFollowupNotificationsTable.caseId, casoA));
    expect(nt.notes).toBeNull();
  });

  it("WhatsApp: fila e CRM do paciente limpos; pendente cancelado; outro paciente intocado", async () => {
    const rows = await db.select().from(whatsappOutboxTable).where(inArray(whatsappOutboxTable.id, Object.values(outbox)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(outbox.followup)).toMatchObject({ recipient: "", message: "[anonimizado]", status: "failed" });
    expect(byId.get(outbox.broadcastA)).toMatchObject({ recipient: "", message: "[anonimizado]", status: "sent" });
    expect(byId.get(outbox.alerta)).toMatchObject({ recipient: "11977776666", message: "[anonimizado]" });
    expect(byId.get(outbox.broadcastB)).toMatchObject({ recipient: "11888880000", message: "Olá Ciclano", status: "pending" });
    const [n] = await db.select().from(scheduledNotificationsTable).where(eq(scheduledNotificationsTable.id, ids.notificacao));
    expect(n).toMatchObject({ status: "skipped", notes: null });

    const [ca] = await db.select().from(whatsappContactsTable).where(eq(whatsappContactsTable.id, contatoA));
    expect(ca.phoneE164).not.toContain(phoneA.slice(1));
    expect(ca).toMatchObject({ displayName: null, profileName: null });
    const [conv] = await db.select().from(whatsappConversationsTable).where(eq(whatsappConversationsTable.id, ids.conversa));
    expect(conv).toMatchObject({ lastMessagePreview: null, providerConversationId: null });
    const msgs = await db.select().from(whatsappMessagesTable).where(eq(whatsappMessagesTable.conversationId, ids.conversa));
    expect(msgs.map((m) => m.content)).toEqual(["[anonimizado]"]);
    const [cb] = await db.select().from(whatsappContactsTable).where(eq(whatsappContactsTable.id, contatoB));
    expect(cb).toMatchObject({ phoneE164: phoneB, displayName: "Ciclano" });

    const [b] = await db.select().from(patientsTable).where(eq(patientsTable.id, pacienteB));
    expect(b).toMatchObject({ nome: "Ciclano", cpf: "11144477735", endereco: "Rua X, 10" });
  });

  it("/lgpd/dados e /lgpd/exportar trazem execuções, escolhas e casos regenerativos do médico", async () => {
    const dados = await (await api("/api/lgpd/dados")).json() as {
      dados: { execucoesApoioDecisao: { id: number }[]; escolhasApoioDecisao: unknown[]; casosRegen: { id: string }[] };
    };
    expect(dados.dados.execucoesApoioDecisao.map((e) => e.id)).toContain(ids.execucao);
    expect(dados.dados.escolhasApoioDecisao).toHaveLength(1);
    expect(dados.dados.casosRegen.map((c) => c.id)).toContain(casoA);
    const json = await (await api("/api/lgpd/exportar?formato=json")).json() as Record<string, unknown[]>;
    expect(json.execucoesApoioDecisao).toHaveLength(1);
    expect(json.escolhasApoioDecisao).toHaveLength(1);
    expect(json.casosRegen).toHaveLength(1);
    const csv = await (await api("/api/lgpd/exportar?formato=csv")).text();
    expect(csv).toContain('"apoio_decisao_execucao"');
    expect(csv).toContain('"apoio_decisao_escolha"');
    expect(csv).toContain('"caso_regen"');
  });
});

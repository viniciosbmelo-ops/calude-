/**
 * LGPD routes against the database:
 *   - patient anonymization is complete (every table with patient PII) and
 *     keeps the de-identified clinical record;
 *   - deletion request is recorded, the operator is e-mailed and the doctor
 *     sees an accurate status;
 *   - portability export is complete;
 *   - regen_cases.doctor_id → doctors is RESTRICT (records are retained).
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const sendMail = vi.fn(async (_mail: { to: string; subject: string; html: string }) => ({}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

const {
  appointmentsTable,
  db,
  doctorsTable,
  lgpdRequestsTable,
  patientAttachmentsTable,
  patientsTable,
  pool,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
  regenTermsAcceptanceTable,
  storageCleanupJobsTable,
  whatsappOutboxTable,
} = await import("@workspace/docregen-db");
const { default: app } = await import("../app");
const { signToken } = await import("../lib/auth");

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
let patientId: number;
let caseId: string;
let followupToken: string;
const PHONE = "(27) 99876-5432";
const PII = ["MARIA SIGILOSA", "529.982.247-25", "maria.sigilosa@example.test", "99876-5432", "998765432", "1961-04-12",
  "Rua das Flores", "29100-000", "CART-777", "Dor desde a queda na casa da irmã Ana", "Laudo RM Maria", "Chegar cedo, Maria",
  "Nota do procedimento com o nome Maria", "Resumo IA de Maria"];

const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}/regen-api${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
});

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "LGPD Doctor", email: `lgpd-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  await db.insert(regenTermsAcceptanceTable).values({ doctorId, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1" });

  const [patient] = await db.insert(patientsTable).values({
    doctorId, nome: "MARIA SIGILOSA", cpf: "529.982.247-25", email: "maria.sigilosa@example.test", telefone: PHONE,
    dataNascimento: "1961-04-12", sexo: "F", endereco: "Rua das Flores, 10", cidade: "Vitória", estado: "ES", cep: "29100-000",
    planoSaude: "Plano", numeroCarteirinha: "CART-777", anamnese: "Dor desde a queda na casa da irmã Ana", laudos: "Laudo RM Maria",
    numeroRegistro: `PAC-LGPD-${randomUUID().slice(0, 6)}`,
  }).returning();
  patientId = patient!.id;

  caseId = randomUUID();
  followupToken = randomUUID();
  await pool.query(
    `INSERT INTO regen_cases (id, doctor_id, patient_id, patient_name, patient_dob, patient_sex, patient_phone, condition_code,
                              weight_kg, height_cm, imc, anamnese_regen, goal_custom, status)
     VALUES ($1,$2,$3,'MARIA SIGILOSA','1961-04-12','F',$4,'OA_JOELHO_KL3',70,165,25.71,$5,'Dançar no casamento da neta Júlia','active')`,
    [caseId, doctorId, patientId, PHONE, JSON.stringify({ queixa: "Dor desde a queda na casa da irmã Ana", lado: "D", eva: 7 })],
  );
  await pool.query(
    `INSERT INTO regen_procedures (case_id, doctor_id, product_code, notes, adverse_event, lot_number)
     VALUES ($1,$2,'PRP','Nota do procedimento com o nome Maria',false,'LOTE-1')`, [caseId, doctorId]);
  await pool.query(`INSERT INTO regen_prom_responses (case_id, instrument, timepoint, answers, score) VALUES ($1,'VAS','Basal',$2,6)`,
    [caseId, JSON.stringify({ comentario: "Maria relata piora", vas: 6 })]);
  await pool.query(`INSERT INTO regen_lab_results (case_id, analyte, value_num, unit) VALUES ($1,'PCR',3.2,'mg/L')`, [caseId]);
  await pool.query(`INSERT INTO regen_performance_tests (case_id, measure, timepoint, value, unit) VALUES ($1,'TUG','Basal',12.3,'s')`, [caseId]);
  const { rows: [notification] } = await pool.query(
    `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scheduled_date, scales, status, token, notes)
     VALUES ($1,'1 mês',30,'2026-10-01',ARRAY['VAS Dor'],'sent',$2,'Ligar para a filha Ana') RETURNING id`, [caseId, followupToken]);
  await pool.query(`INSERT INTO regen_scale_responses (notification_id, nome_escala, respostas, score) VALUES ($1,'VAS Dor',$2,4)`,
    [notification.id, JSON.stringify({ vas: 4, obs: "Maria melhorou" })]);
  await pool.query(`INSERT INTO regen_ai_interactions (case_id, doctor_id, model, raw_output, accepted_output) VALUES ($1,$2,'m',$3,$3)`,
    [caseId, doctorId, JSON.stringify({ summary: "Resumo IA de Maria" })]);

  const [questionnaire] = await db.insert(preConsultQuestionnairesTable).values({
    patientId, doctorId, status: "submitted",
    patientAnswers: { queixaPrincipal: "Dor desde a queda na casa da irmã Ana", intensidadeDor: 7, inicioSintomasTipo: "trauma", pioraSintomas: ["escadas"] },
    currentAnswers: { queixaPrincipal: "Dor desde a queda na casa da irmã Ana", intensidadeDor: 7 },
  }).returning();
  await db.insert(preConsultInvitesTable).values({
    questionnaireId: questionnaire!.id, patientId, doctorId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(patientAttachmentsTable).values({
    patientId, doctorId, preConsultQuestionnaireId: questionnaire!.id, fileName: "rm-maria.pdf", mimeType: "application/pdf",
    objectPath: `/objects/uploads/lgpd-${randomUUID()}`, fileSize: 10,
  });
  await db.insert(appointmentsTable).values({ doctorId, patientId, data: "2026-10-05", hora: "10:00", observacoes: "Chegar cedo, Maria" });
  await db.insert(whatsappOutboxTable).values({
    eventType: "generic_doctor_message", doctorId, idempotencyKey: `generic:${doctorId}:${randomUUID()}`,
    recipient: "5527998765432", message: "Olá MARIA SIGILOSA, responda o link", status: "pending",
  });
});

afterAll(async () => {
  await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
  await db.delete(storageCleanupJobsTable).where(sql`${storageCleanupJobsTable.objectPath} LIKE '/objects/uploads/lgpd-%'`);
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => sendMail.mockClear());

describe("portability export (before anonymization)", () => {
  it("JSON carries every clinical table and attachment metadata, never link tokens", async () => {
    const response = await call("/lgpd/exportar");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown[]>;
    for (const key of ["pacientes", "casosRegenerativos", "procedimentos", "proms", "examesLaboratoriais", "testesFuncionais",
      "seguimentos", "respostasEscalas", "preConsultas", "anexos", "agendamentos"]) {
      expect(body[key], key).toHaveLength(1);
    }
    expect(JSON.stringify(body)).not.toContain(followupToken);
    expect(body["anexos"]![0]).toHaveProperty("downloadUrlExpiresInSeconds");
    expect(body["anexos"]![0]).not.toHaveProperty("objectPath");
  });

  it("CSV has one typed row per record", async () => {
    const csv = await (await call("/lgpd/exportar?formato=csv")).text();
    for (const tipo of ["paciente", "caso_regenerativo", "procedimento", "prom", "exame_laboratorial", "teste_funcional",
      "seguimento", "resposta_escala", "pre_consulta", "anexo", "agendamento"]) {
      expect(csv).toMatch(new RegExp(`\\r\\n${tipo},`));
    }
  });
});

describe("patient anonymization", () => {
  it("removes identifiers everywhere, keeps the de-identified clinical record, in one call", async () => {
    const response = await call(`/lgpd/anonimizar-paciente/${patientId}`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json() as { nota: string; mantidos: string[] };
    expect(body.nota).toMatch(/20 anos/);
    expect(body.nota).not.toMatch(/excluído|apagad/i);

    const dump = JSON.stringify({
      patient: (await pool.query(`SELECT * FROM patients WHERE id = $1`, [patientId])).rows,
      cases: (await pool.query(`SELECT * FROM regen_cases WHERE id = $1`, [caseId])).rows,
      procedures: (await pool.query(`SELECT * FROM regen_procedures WHERE case_id = $1`, [caseId])).rows,
      proms: (await pool.query(`SELECT * FROM regen_prom_responses WHERE case_id = $1`, [caseId])).rows,
      notifications: (await pool.query(`SELECT * FROM regen_followup_notifications WHERE case_id = $1`, [caseId])).rows,
      scales: (await pool.query(`SELECT r.* FROM regen_scale_responses r JOIN regen_followup_notifications n ON n.id = r.notification_id WHERE n.case_id = $1`, [caseId])).rows,
      ai: (await pool.query(`SELECT * FROM regen_ai_interactions WHERE case_id = $1`, [caseId])).rows,
      questionnaires: (await pool.query(`SELECT * FROM pre_consult_questionnaires WHERE patient_id = $1`, [patientId])).rows,
      appointments: (await pool.query(`SELECT * FROM appointments WHERE patient_id = $1`, [patientId])).rows,
      outbox: (await pool.query(`SELECT * FROM whatsapp_outbox WHERE doctor_id = $1`, [doctorId])).rows,
    });
    for (const value of PII) expect(dump, value).not.toContain(value);
    expect(dump).not.toContain("Ana");
    expect(dump).not.toContain("Júlia");
    expect(dump).not.toContain(followupToken);

    const { rows: [kept] } = await pool.query(
      `SELECT c.condition_code, c.patient_sex, to_char(c.patient_dob, 'YYYY-MM-DD') AS dob, c.imc::float8 AS imc,
              c.anamnese_regen, p.product_code, p.lot_number, pr.score::float8 AS prom
         FROM regen_cases c JOIN regen_procedures p ON p.case_id = c.id JOIN regen_prom_responses pr ON pr.case_id = c.id
        WHERE c.id = $1`, [caseId]);
    expect(kept).toMatchObject({ condition_code: "OA_JOELHO_KL3", patient_sex: "F", dob: "1961-01-01", imc: 25.71, product_code: "PRP", lot_number: "LOTE-1", prom: 6 });
    expect(kept.anamnese_regen).toEqual({ queixa: "", lado: "D", eva: 7 });

    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
    expect(patient!.nome).toMatch(/^PACIENTE ANONIMIZADO #/);
    expect(patient!.sexo).toBe("F");
    expect(patient!.numeroRegistro).toMatch(/^PAC-LGPD-/);

    const [questionnaire] = await db.select().from(preConsultQuestionnairesTable).where(eq(preConsultQuestionnairesTable.patientId, patientId));
    expect(questionnaire!.patientAnswers).toMatchObject({ queixaPrincipal: "", intensidadeDor: 7, inicioSintomasTipo: "trauma", pioraSintomas: ["escadas"] });
    const invites = await db.select().from(preConsultInvitesTable).where(eq(preConsultInvitesTable.patientId, patientId));
    expect(invites.every((invite) => invite.status === "revoked")).toBe(true);
    expect(await db.select().from(patientAttachmentsTable).where(eq(patientAttachmentsTable.patientId, patientId))).toHaveLength(0);
    const jobs = await db.select().from(storageCleanupJobsTable).where(sql`${storageCleanupJobsTable.objectPath} LIKE '/objects/uploads/lgpd-%'`);
    const [outbox] = await db.select().from(whatsappOutboxTable).where(eq(whatsappOutboxTable.doctorId, doctorId));
    expect(outbox).toMatchObject({ recipient: "anonimizado", status: "failed" });
    // Deleted from storage right away or still queued for deletion — never left behind unreferenced.
    expect(jobs.length).toBeLessThanOrEqual(1);

    // The public follow-up link no longer resolves.
    expect((await fetch(`${baseUrl}/regen-api/patient/regen/${followupToken}`)).status).toBe(404);
  });

  it("404 for another doctor's patient", async () => {
    const [other] = await db.insert(doctorsTable).values({ nome: "Other", email: `lgpd-other-${randomUUID()}@example.test`, senhaHash: "x", isFree: true }).returning();
    const otherAuth = signToken({ doctorId: other!.id, isAdmin: false, sessionVersion: 0 });
    const response = await fetch(`${baseUrl}/regen-api/lgpd/anonimizar-paciente/${patientId}`, {
      method: "POST", headers: { Authorization: `Bearer ${otherAuth}` },
    });
    expect(response.status).toBe(404);
    await db.delete(doctorsTable).where(eq(doctorsTable.id, other!.id));
  });
});

describe("account deletion request", () => {
  it("records the request, e-mails the operator and reports an accurate status", async () => {
    process.env["DOCREGEN_CONTACT_EMAIL"] = "dpo@example.test";
    process.env["DOCREGEN_GMAIL_USER"] = "sender@example.test";
    process.env["DOCREGEN_GMAIL_APP_PASSWORD"] = "unused";
    try {
      const response = await call("/lgpd/solicitar-exclusao", { method: "DELETE" });
      expect(response.status).toBe(201);
      const body = await response.json() as { solicitacao: { status: string }; nota: string };
      expect(body.solicitacao.status).toBe("notified");
      expect(body.nota).toMatch(/20 anos/);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0]![0].to).toBe("dpo@example.test");

      const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
      expect(doctor!.deletionRequestedAt).toBeTruthy();

      // Idempotent: the open request is returned, no second e-mail.
      const again = await call("/lgpd/solicitar-exclusao", { method: "DELETE" });
      expect(again.status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(1);

      const list = await (await call("/lgpd/solicitacoes")).json() as { solicitacoes: Array<{ status: string }> };
      expect(list.solicitacoes).toHaveLength(1);
      expect(list.solicitacoes[0]!.status).toBe("notified");
    } finally {
      delete process.env["DOCREGEN_CONTACT_EMAIL"];
      delete process.env["DOCREGEN_GMAIL_USER"];
      delete process.env["DOCREGEN_GMAIL_APP_PASSWORD"];
      await db.delete(lgpdRequestsTable).where(eq(lgpdRequestsTable.doctorId, doctorId));
    }
  });

  it("without a configured contact address the status says the notification failed", async () => {
    const response = await call("/lgpd/solicitar-exclusao", { method: "DELETE" });
    const body = await response.json() as { solicitacao: { status: string; descricaoStatus: string } };
    expect(body.solicitacao.status).toBe("notification_failed");
    expect(body.solicitacao.descricaoStatus).toMatch(/falhou/);
    await db.delete(lgpdRequestsTable).where(eq(lgpdRequestsTable.doctorId, doctorId));
  });
});

describe("retention", () => {
  it("a doctor who owns regenerative cases cannot be deleted (FK RESTRICT)", async () => {
    await expect(db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId))).rejects.toThrow();
  });
});

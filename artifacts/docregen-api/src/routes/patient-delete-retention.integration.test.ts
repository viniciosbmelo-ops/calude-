/**
 * DELETE /patients/:id and the 20-year medical-record retention (Lei 13.787/2018):
 *   - any clinical record (regen case and its procedures/PROMs/labs/performance
 *     tests/follow-ups/scale responses, appointment, attachment, answered
 *     pré-consulta, anamnesis/reports on the patient row) → 409, nothing deleted,
 *     message points to "Anonimizar dados identificáveis";
 *   - no clinical data (created by mistake) → 204, no orphan rows, pending
 *     upload files queued for deletion from object storage.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  doctorsTable,
  patientAttachmentsTable,
  patientsTable,
  pool,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
  regenTermsAcceptanceTable,
  storageCleanupJobsTable,
  uploadGrantsTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let otherDoctorId: number;
let auth: string;
const PATH_PREFIX = `/objects/uploads/delete-retention-${randomUUID()}`;

const call = (path: string, init?: RequestInit, token = auth) => fetch(`${baseUrl}/regen-api${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
});

async function newPatient(values: Partial<typeof patientsTable.$inferInsert> = {}, owner = doctorId) {
  const [patient] = await db.insert(patientsTable).values({ doctorId: owner, nome: `PACIENTE ${randomUUID()}`, ...values }).returning();
  return patient!.id;
}

async function newCase(patientId: number): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO regen_cases (id, doctor_id, patient_id, patient_name, condition_code, status)
     VALUES ($1, $2, $3, 'X', 'OA_JOELHO_KL3', 'active')`,
    [id, doctorId, patientId],
  );
  return id;
}

async function patientExists(id: number): Promise<boolean> {
  return (await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, id))).length === 1;
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Delete Retention Doctor", email: `delete-retention-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  await db.insert(regenTermsAcceptanceTable).values({ doctorId, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1" });
  const [other] = await db.insert(doctorsTable).values({
    nome: "Other Doctor", email: `delete-retention-other-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  otherDoctorId = other!.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
  await db.delete(storageCleanupJobsTable).where(like(storageCleanupJobsTable.objectPath, `${PATH_PREFIX}%`));
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await db.delete(doctorsTable).where(eq(doctorsTable.id, otherDoctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("patient with clinical records → 409, nothing deleted", () => {
  it("full regenerative record: every related table is counted, the message points to anonymization", async () => {
    const patientId = await newPatient({ dataNascimento: "1960-05-05" });
    const caseId = await newCase(patientId);
    await pool.query(`INSERT INTO regen_procedures (case_id, doctor_id, product_code) VALUES ($1, $2, 'PRP')`, [caseId, doctorId]);
    await pool.query(`INSERT INTO regen_prom_responses (case_id, instrument, timepoint, score) VALUES ($1, 'VAS', 'Basal', 5)`, [caseId]);
    await pool.query(`INSERT INTO regen_lab_results (case_id, analyte, value_num) VALUES ($1, 'PCR', 1)`, [caseId]);
    await pool.query(`INSERT INTO regen_performance_tests (case_id, measure, timepoint, value, unit) VALUES ($1, 'TUG', 'Basal', 10, 's')`, [caseId]);
    const { rows: [notification] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales) VALUES ($1, '1 mês', 30, ARRAY['VAS Dor']) RETURNING id`, [caseId]);
    await pool.query(`INSERT INTO regen_scale_responses (notification_id, nome_escala, score) VALUES ($1, 'VAS Dor', 3)`, [notification.id]);
    await pool.query(`INSERT INTO regen_ai_interactions (case_id, doctor_id) VALUES ($1, $2)`, [caseId, doctorId]);

    const response = await call(`/patients/${patientId}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string; code: string; clinicalRecords: Record<string, number> };
    expect(body.code).toBe("patient_has_clinical_records");
    expect(body.error).toContain("Anonimizar dados identificáveis");
    expect(body.error).toMatch(/20 anos/);
    expect(body.clinicalRecords).toMatchObject({
      regenCases: 1, procedures: 1, proms: 1, labResults: 1, performanceTests: 1,
      followups: 1, scaleResponses: 1, aiInteractions: 1,
      appointments: 0, attachments: 0, preConsultAnswers: 0, patientRecordFields: 0,
    });

    expect(await patientExists(patientId)).toBe(true);
    const { rows: [counts] } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM regen_cases WHERE id = $1) AS cases,
              (SELECT COUNT(*)::int FROM regen_procedures WHERE case_id = $1) AS procedures,
              (SELECT COUNT(*)::int FROM regen_scale_responses WHERE notification_id = $2) AS scales`,
      [caseId, notification.id]);
    expect(counts).toEqual({ cases: 1, procedures: 1, scales: 1 });
  });

  const singleRecordKinds: Array<[string, keyof Record<string, number>, (patientId: number) => Promise<void>]> = [
    ["regenerative case", "regenCases", async (patientId) => { await newCase(patientId); }],
    ["appointment history", "appointments", async (patientId) => {
      await db.insert(appointmentsTable).values({ doctorId, patientId, data: "2026-01-10", hora: "09:00", status: "realizado" });
    }],
    ["attachment", "attachments", async (patientId) => {
      await db.insert(patientAttachmentsTable).values({
        patientId, doctorId, fileName: "rm.pdf", mimeType: "application/pdf", objectPath: `${PATH_PREFIX}-att-${randomUUID()}`, fileSize: 10,
      });
    }],
    ["submitted pré-consulta", "preConsultAnswers", async (patientId) => {
      await db.insert(preConsultQuestionnairesTable).values({
        patientId, doctorId, status: "submitted", patientAnswers: { queixaPrincipal: "dor" }, currentAnswers: { queixaPrincipal: "dor" },
      });
    }],
    ["pré-consulta draft with answers", "preConsultAnswers", async (patientId) => {
      await db.insert(preConsultQuestionnairesTable).values({ patientId, doctorId, status: "draft", draftAnswers: { intensidadeDor: 6 } });
    }],
    ["anamnesis on the patient row", "patientRecordFields", async (patientId) => {
      await db.update(patientsTable).set({ anamnese: "Dor no joelho há 2 anos" }).where(eq(patientsTable.id, patientId));
    }],
    ["reports on the patient row", "patientRecordFields", async (patientId) => {
      await db.update(patientsTable).set({ laudos: JSON.stringify([{ id: "1", tipo: "laudo", titulo: "RM", conteudo: "x", data: "2026-01-01" }]) })
        .where(eq(patientsTable.id, patientId));
    }],
  ];

  for (const [label, key, seed] of singleRecordKinds) {
    it(`${label} alone blocks the hard delete`, async () => {
      const patientId = await newPatient();
      await seed(patientId);
      const response = await call(`/patients/${patientId}`, { method: "DELETE" });
      expect(response.status).toBe(409);
      const body = await response.json() as { clinicalRecords: Record<string, number> };
      expect(body.clinicalRecords[key]).toBeGreaterThan(0);
      expect(await patientExists(patientId)).toBe(true);
    });
  }

  it("answers in Spanish for a Spanish-speaking doctor", async () => {
    await db.update(doctorsTable).set({ idioma: "es" }).where(eq(doctorsTable.id, doctorId));
    try {
      const patientId = await newPatient();
      await newCase(patientId);
      const response = await call(`/patients/${patientId}`, { method: "DELETE" });
      expect(response.status).toBe(409);
      const body = await response.json() as { error: string };
      expect(body.error).toContain("Anonimizar datos identificables");
      expect(body.error).toMatch(/20 años/);
    } finally {
      await db.update(doctorsTable).set({ idioma: "pt-BR" }).where(eq(doctorsTable.id, doctorId));
    }
  });

  it("after anonymization the clinical record is still kept (delete stays blocked)", async () => {
    const patientId = await newPatient({ cpf: "529.982.247-25", anamnese: "texto livre" });
    await newCase(patientId);
    expect((await call(`/lgpd/anonimizar-paciente/${patientId}`, { method: "POST" })).status).toBe(200);
    expect((await call(`/patients/${patientId}`, { method: "DELETE" })).status).toBe(409);
    expect(await patientExists(patientId)).toBe(true);
  });
});

describe("patient without clinical data → 204", () => {
  it("deletes the patient, its unanswered pré-consulta and pending uploads; no orphan rows; files queued for storage deletion", async () => {
    const patientId = await newPatient({ telefone: "(27) 99999-0000", dataNascimento: "1980-01-01", sexo: "M" });
    const [questionnaire] = await db.insert(preConsultQuestionnairesTable).values({ patientId, doctorId, status: "draft" }).returning();
    await db.insert(preConsultInvitesTable).values({
      questionnaireId: questionnaire!.id, patientId, doctorId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000),
    });
    const pendingUpload = `${PATH_PREFIX}-grant-${randomUUID()}`;
    await db.insert(uploadGrantsTable).values({
      purpose: "patient_attachment", doctorId, patientId, objectPath: pendingUpload, fileName: "exam.pdf",
      mimeType: "application/pdf", tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600_000),
    });

    const response = await call(`/patients/${patientId}`, { method: "DELETE" });
    expect(response.status).toBe(204);

    expect(await patientExists(patientId)).toBe(false);
    const { rows: [orphans] } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM pre_consult_questionnaires WHERE patient_id = $1) AS questionnaires,
              (SELECT COUNT(*)::int FROM pre_consult_invites WHERE patient_id = $1) AS invites,
              (SELECT COUNT(*)::int FROM upload_grants WHERE patient_id = $1) AS grants,
              (SELECT COUNT(*)::int FROM appointments WHERE patient_id = $1) AS appointments,
              (SELECT COUNT(*)::int FROM patient_attachments WHERE patient_id = $1) AS attachments,
              (SELECT COUNT(*)::int FROM regen_cases WHERE patient_id = $1) AS cases`,
      [patientId]);
    expect(orphans).toEqual({ questionnaires: 0, invites: 0, grants: 0, appointments: 0, attachments: 0, cases: 0 });

    // The pending upload's object is queued in the durable storage cleanup
    // outbox (same transaction as the delete) and erased from storage by it.
    const jobs = await db.select().from(storageCleanupJobsTable).where(eq(storageCleanupJobsTable.objectPath, pendingUpload));
    expect(jobs).toHaveLength(1);
  });

  it("an empty pré-consulta draft or a pending invite is not a clinical record", async () => {
    const patientId = await newPatient();
    await db.insert(preConsultQuestionnairesTable).values({ patientId, doctorId, status: "draft", draftAnswers: {} });
    expect((await call(`/patients/${patientId}`, { method: "DELETE" })).status).toBe(204);
    expect(await patientExists(patientId)).toBe(false);
  });

  it("another doctor's patient → 404 and untouched", async () => {
    const patientId = await newPatient({}, otherDoctorId);
    expect((await call(`/patients/${patientId}`, { method: "DELETE" })).status).toBe(404);
    expect(await patientExists(patientId)).toBe(true);
  });
});

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientAttachmentsTable,
  patientsTable,
  pool,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
  storageCleanupJobsTable,
  uploadGrantsTable,
} from "@workspace/docregen-db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { deleteStoredObject } from "../lib/storageCleanup";
import { PreConsultAnswersSchema } from "./pre-consult";

let server: Server;
let baseUrl: string;
let doctorId: number;
let otherDoctorId: number;
let patientId: number;
let otherPatientId: number;
let doctorAuth: string;
let otherDoctorAuth: string;
let uploadedObjectPaths: string[] = [];
let cleanupJobPaths: string[] = [];

function doctorRequest(
  auth: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patientRequest(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/regen-api/pre-consult/${token}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: baseUrl,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createInvite(
  auth: string,
  targetPatientId: number,
): Promise<{ token: string; inviteId: number }> {
  const response = await doctorRequest(
    auth,
    `/regen-api/patients/${targetPatientId}/pre-consult/invite`,
    "POST",
  );
  expect(response.status).toBe(201);
  const body = await response.json() as { link: string; inviteId: number };
  const token = new URL(body.link).pathname.split("/").filter(Boolean).at(-1);
  expect(token).toBeTruthy();
  return { token: token!, inviteId: body.inviteId };
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  const passwordHash = await hashPassword("pre-consult-integration-password");
  const [doctor, otherDoctor] = await db
    .insert(doctorsTable)
    .values([
      {
        nome: "Pre-consult Integration Doctor",
        email: `pre-consult-${suffix}@example.test`,
        senhaHash: passwordHash,
        isFree: true,
      },
      {
        nome: "Pre-consult Other Doctor",
        email: `pre-consult-other-${suffix}@example.test`,
        senhaHash: passwordHash,
        isFree: true,
      },
    ])
    .returning();
  doctorId = doctor.id;
  otherDoctorId = otherDoctor.id;

  const [patient, otherPatient] = await db
    .insert(patientsTable)
    .values([
      {
        doctorId,
        nome: "PRE-CONSULT INTEGRATION PATIENT",
        cpf: "52998224725",
      },
      {
        doctorId: otherDoctorId,
        nome: "PRE-CONSULT OTHER PATIENT",
        cpf: "11144477735",
      },
    ])
    .returning();
  patientId = patient.id;
  otherPatientId = otherPatient.id;

  doctorAuth = signToken({
    doctorId,
    isAdmin: false,
    sessionVersion: doctor.sessionVersion,
  });
  otherDoctorAuth = signToken({
    doctorId: otherDoctorId,
    isAdmin: false,
    sessionVersion: otherDoctor.sessionVersion,
  });
});

beforeEach(async () => {
  await db
    .delete(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.doctorId, doctorId));
  await db
    .delete(preConsultQuestionnairesTable)
    .where(eq(preConsultQuestionnairesTable.doctorId, otherDoctorId));
});

afterEach(async () => {
  const queuedPaths = cleanupJobPaths;
  cleanupJobPaths = [];
  await Promise.all(queuedPaths.map((objectPath) =>
    db
      .delete(storageCleanupJobsTable)
      .where(eq(storageCleanupJobsTable.objectPath, objectPath))
  ));
  const paths = uploadedObjectPaths;
  uploadedObjectPaths = [];
  await Promise.all(paths.map((path) => deleteStoredObject(path)));
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  if (otherDoctorId) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, otherDoctorId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe.sequential("pre-consult API integration", () => {
  it("derives bootstrap doctorLocale from the invite doctor and safely defaults unknown values", async () => {
    const { token } = await createInvite(doctorAuth, patientId);

    await db.update(doctorsTable).set({ idioma: "es" }).where(eq(doctorsTable.id, doctorId));
    let response = await patientRequest(token, "?locale=pt-BR");
    expect(response.status).toBe(200);
    expect((await response.json() as { doctorLocale: string }).doctorLocale).toBe("es");

    await db.update(doctorsTable).set({ idioma: "pt-BR" }).where(eq(doctorsTable.id, doctorId));
    response = await patientRequest(token, "");
    expect((await response.json() as { doctorLocale: string }).doctorLocale).toBe("pt-BR");

    await db.update(doctorsTable).set({ idioma: "unsupported-locale" }).where(eq(doctorsTable.id, doctorId));
    response = await patientRequest(token, "");
    expect((await response.json() as { doctorLocale: string }).doctorLocale).toBe("pt-BR");
  });

  it("rejects invitation creation when the stored CPF has invalid check digits", async () => {
    await db
      .update(patientsTable)
      .set({ cpf: "11111111111" })
      .where(eq(patientsTable.id, patientId));

    try {
      const response = await doctorRequest(
        doctorAuth,
        `/regen-api/patients/${patientId}/pre-consult/invite`,
        "POST",
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("corrija o CPF"),
      });

      const questionnaires = await db
        .select()
        .from(preConsultQuestionnairesTable)
        .where(eq(preConsultQuestionnairesTable.patientId, patientId));
      expect(questionnaires).toHaveLength(0);
    } finally {
      await db
        .update(patientsTable)
        .set({ cpf: "52998224725" })
        .where(eq(patientsTable.id, patientId));
    }
  });

  it("rotates concurrent invitations while keeping one questionnaire and no raw token in the database", async () => {
    const [first, second] = await Promise.all([
      createInvite(doctorAuth, patientId),
      createInvite(doctorAuth, patientId),
    ]);

    const questionnaires = await db
      .select()
      .from(preConsultQuestionnairesTable)
      .where(eq(preConsultQuestionnairesTable.patientId, patientId));
    const invites = await db
      .select()
      .from(preConsultInvitesTable)
      .where(eq(preConsultInvitesTable.patientId, patientId));

    expect(questionnaires).toHaveLength(1);
    expect(invites.filter((invite) => invite.status === "active")).toHaveLength(1);
    expect(invites).toHaveLength(2);
    expect(invites.some((invite) => invite.tokenHash === first.token)).toBe(false);
    expect(invites.some((invite) => invite.tokenHash === second.token)).toBe(false);
    expect(invites.map((invite) => invite.tokenHash)).toContain(
      createHash("sha256").update(first.token).digest("hex"),
    );
    expect(invites.map((invite) => invite.tokenHash)).toContain(
      createHash("sha256").update(second.token).digest("hex"),
    );

    const publicStatuses = await Promise.all([
      patientRequest(first.token, "").then((response) => response.status),
      patientRequest(second.token, "").then((response) => response.status),
    ]);
    expect(publicStatuses.sort()).toEqual([200, 404]);
  });

  it("resumes a draft, submits idempotently and preserves the original after physician edits", async () => {
    const { token } = await createInvite(doctorAuth, patientId);

    const wrongCpf = await patientRequest(token, "/verify", "POST", { cpf: "00000000000" });
    expect(wrongCpf.status).toBe(400);

    const verify = await patientRequest(token, "/verify", "POST", { cpf: "52998224725" });
    expect(verify.status).toBe(200);
    const cookie = verify.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toContain("docregen_patient_session=");

    const originalAnswers = PreConsultAnswersSchema.parse({
      queixaPrincipal: "Dor no ombro direito",
      intensidadeDor: 7,
      pioraSintomas: ["escadas", "agachar"],
      tratamentosPrevios: ["fisioterapia", "prp"],
      examesPossui: ["radiografia"],
      objetivoTratamento: "retornar_esporte",
    });
    const save = await patientRequest(
      token,
      "/answers",
      "PATCH",
      { answers: originalAnswers },
      cookie,
    );
    expect(save.status).toBe(200);

    const restored = await patientRequest(token, "/form", "GET", undefined, cookie);
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json() as { answers: typeof originalAnswers };
    expect(restoredBody.answers.queixaPrincipal).toBe(originalAnswers.queixaPrincipal);
    expect(restoredBody.answers.tratamentosPrevios).toEqual(["fisioterapia", "prp"]);

    const pdfBytes = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n",
    );
    const uploadRequest = await patientRequest(
      token,
      "/uploads/request-url",
      "POST",
      {
        name: "pre-consult-integration.pdf",
        size: pdfBytes.byteLength,
        mimeType: "application/pdf",
      },
      cookie,
    );
    expect(uploadRequest.status).toBe(200);
    const uploadBody = await uploadRequest.json() as {
      uploadUrl: string;
      uploadToken: string;
    };
    expect(uploadBody.uploadUrl).toMatch(/^https?:\/\//);
    const [grant] = await db
      .select()
      .from(uploadGrantsTable)
      .where(eq(
        uploadGrantsTable.tokenHash,
        createHash("sha256").update(uploadBody.uploadToken).digest("hex"),
      ));
    expect(grant).toMatchObject({
      purpose: "pre_consult_attachment",
      patientId,
      doctorId,
      fileName: "pre-consult-integration.pdf",
    });
    uploadedObjectPaths.push(grant.objectPath);

    const directUpload = await fetch(uploadBody.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBytes,
    });
    expect(directUpload.status).toBeGreaterThanOrEqual(200);
    expect(directUpload.status).toBeLessThan(300);

    const finalizeUpload = await patientRequest(
      token,
      "/attachments",
      "POST",
      { uploadToken: uploadBody.uploadToken },
      cookie,
    );
    expect(finalizeUpload.status).toBe(201);
    await expect(finalizeUpload.json()).resolves.toMatchObject({
      fileName: "pre-consult-integration.pdf",
      fileSize: pdfBytes.byteLength,
      mimeType: "application/pdf",
    });
    const reusedGrant = await patientRequest(
      token,
      "/attachments",
      "POST",
      { uploadToken: uploadBody.uploadToken },
      cookie,
    );
    expect(reusedGrant.status).toBe(403);

    const submitResponses = await Promise.all([
      patientRequest(token, "/submit", "POST", { answers: originalAnswers }, cookie),
      patientRequest(token, "/submit", "POST", { answers: originalAnswers }, cookie),
    ]);
    expect(submitResponses.map((response) => response.status)).toEqual([200, 200]);
    const submittedInvite = await patientRequest(token, "");
    expect(submittedInvite.status).toBe(200);
    await expect(submittedInvite.json()).resolves.toMatchObject({
      valid: true,
      submitted: true,
    });

    const [submitted] = await db
      .select()
      .from(preConsultQuestionnairesTable)
      .where(eq(preConsultQuestionnairesTable.patientId, patientId));
    expect(submitted.status).toBe("submitted");
    expect(submitted.patientAnswers).toEqual(originalAnswers);

    const physicianAnswers = {
      ...originalAnswers,
      queixaPrincipal: "Dor femoropatelar, revisada pelo médico",
      pioraSintomas: ["escadas", "noite"],
    };
    const physicianEdit = await doctorRequest(
      doctorAuth,
      `/regen-api/patients/${patientId}/pre-consult`,
      "PATCH",
      { answers: physicianAnswers },
    );
    expect(physicianEdit.status).toBe(200);

    const [edited] = await db
      .select()
      .from(preConsultQuestionnairesTable)
      .where(eq(preConsultQuestionnairesTable.patientId, patientId));
    expect(edited.patientAnswers).toEqual(originalAnswers);
    expect(edited.currentAnswers).toEqual(physicianAnswers);
    expect(edited.doctorEditedAt).toBeInstanceOf(Date);

    const repeatedSubmit = await patientRequest(
      token,
      "/submit",
      "POST",
      { answers: originalAnswers },
      cookie,
    );
    expect(repeatedSubmit.status).toBe(200);
    await expect(repeatedSubmit.json()).resolves.toMatchObject({
      submitted: true,
    });
  });

  it("enforces physician ownership, token-bound sessions, revocation and privacy-safe persistence", async () => {
    const own = await createInvite(doctorAuth, patientId);
    const other = await createInvite(otherDoctorAuth, otherPatientId);

    const forbiddenRead = await doctorRequest(
      otherDoctorAuth,
      `/regen-api/patients/${patientId}/pre-consult`,
    );
    expect(forbiddenRead.status).toBe(404);

    const verified = await patientRequest(own.token, "/verify", "POST", {
      cpf: "52998224725",
    });
    const ownCookie = verified.headers.get("set-cookie")?.split(";")[0];
    expect(ownCookie).toBeTruthy();

    const wrongTokenSession = await patientRequest(
      other.token,
      "/form",
      "GET",
      undefined,
      ownCookie,
    );
    expect(wrongTokenSession.status).toBe(401);

    const revoke = await doctorRequest(
      otherDoctorAuth,
      `/regen-api/patients/${otherPatientId}/pre-consult/invite/${other.inviteId}/revoke`,
      "POST",
    );
    expect(revoke.status).toBe(200);
    expect((await patientRequest(other.token, "")).status).toBe(404);

    await fetch(`${baseUrl}/regen-api/stats/visit`, {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: `/pre-consulta/${own.token}` }),
    });
    const visit = await pool.query<{ path: string }>(
      "SELECT path FROM page_visits ORDER BY id DESC LIMIT 1",
    );
    expect(visit.rows[0]?.path).toBe("/pre-consulta/:token");

    await new Promise((resolve) => setTimeout(resolve, 30));
    const rawAudit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE endpoint LIKE $1",
      [`%${own.token}%`],
    );
    expect(rawAudit.rows[0]?.count).toBe("0");
    const templatedAudit = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM audit_logs
        WHERE endpoint LIKE '%/pre-consult/:token/%'`,
    );
    expect(Number(templatedAudit.rows[0]?.count ?? "0")).toBeGreaterThan(0);
  });

  it("commits storage cleanup work atomically with patient deletion", async () => {
    const [disposablePatient] = await db
      .insert(patientsTable)
      .values({
        doctorId,
        nome: "PRE-CONSULT DELETION OUTBOX PATIENT",
        cpf: "93541134780",
      })
      .returning();
    const objectPath = `invalid-deletion-outbox-${randomUUID()}`;
    cleanupJobPaths.push(objectPath);
    await db.insert(patientAttachmentsTable).values({
      patientId: disposablePatient.id,
      doctorId,
      fileName: "clinical-document.pdf",
      fileSize: 10,
      mimeType: "application/pdf",
      objectPath,
      category: "pre_consulta",
    });

    const response = await doctorRequest(
      doctorAuth,
      `/regen-api/patients/${disposablePatient.id}`,
      "DELETE",
    );
    expect(response.status).toBe(204);

    const deletedPatients = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(eq(patientsTable.id, disposablePatient.id));
    const deletedAttachments = await db
      .select({ id: patientAttachmentsTable.id })
      .from(patientAttachmentsTable)
      .where(eq(patientAttachmentsTable.patientId, disposablePatient.id));
    const [cleanupJob] = await db
      .select()
      .from(storageCleanupJobsTable)
      .where(eq(storageCleanupJobsTable.objectPath, objectPath));

    expect(deletedPatients).toHaveLength(0);
    expect(deletedAttachments).toHaveLength(0);
    expect(cleanupJob?.objectPath).toBe(objectPath);
  });
});
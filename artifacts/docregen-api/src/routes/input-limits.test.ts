/**
 * Input limits and validation:
 *   - 1 MB default JSON body limit (413), not 50 MB;
 *   - WhatsApp sends only to the doctor's own patients, length cap,
 *     DB-backed per-doctor hourly limit, Idempotency-Key;
 *   - invalid calendar dates are 400 (baseDate, case dates, procedure date,
 *     appointments, patient birth date) instead of rolling over or 500;
 *   - labs POST validated and all-or-nothing;
 *   - patient VAS answers: numbers 0–10 only (no clamping, no booleans).
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  pool,
  rateLimitBucketsTable,
  regenTermsAcceptanceTable,
  whatsappOutboxTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";
import { buildPatientSessionToken } from "../lib/patient-session";
import { initRegenData } from "./regen";

let server: Server;
let baseUrl: string;
let doctorId: number;
let otherDoctorId: number;
let auth: string;
let patientId: number;
let caseId: string;
const PATIENT_PHONE = "(27) 98888-7777";

const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}/regen-api${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
});
const send = (phone: string, text: string, key = randomUUID()) => call("/notifications/send-text", {
  method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ phone, text }),
});

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor, other] = await db.insert(doctorsTable).values([
    { nome: "Limits Doctor", email: `limits-${randomUUID()}@example.test`, senhaHash: "x", isFree: true },
    { nome: "Other Doctor", email: `limits-other-${randomUUID()}@example.test`, senhaHash: "x", isFree: true },
  ]).returning();
  doctorId = doctor!.id;
  otherDoctorId = other!.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  await db.insert(regenTermsAcceptanceTable).values({ doctorId, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1" });
  const [patient] = await db.insert(patientsTable).values({ doctorId, nome: "PACIENTE LIMITES", telefone: PATIENT_PHONE }).returning();
  patientId = patient!.id;
  await db.insert(patientsTable).values({ doctorId: otherDoctorId, nome: "PACIENTE DE OUTRO", telefone: "(21) 97777-6666" });
  const created = await call("/regen/cases", { method: "POST", body: JSON.stringify({ patientName: "X", conditionCode: "OA_JOELHO_KL3" }) });
  caseId = (await created.json() as { id: string }).id;
});

afterAll(async () => {
  for (const id of [doctorId, otherDoctorId]) {
    await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [id]);
    await db.delete(rateLimitBucketsTable).where(eq(rateLimitBucketsTable.key, `whatsapp:${id}`));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, id));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("body size", () => {
  it("rejects JSON bodies over 1 MB with 413 (not 500)", async () => {
    const response = await call("/patients", { method: "POST", body: JSON.stringify({ nome: "x".repeat(1_100_000) }) });
    expect(response.status).toBe(413);
  });
});

describe("WhatsApp send through the platform number", () => {
  beforeEach(async () => {
    await db.delete(rateLimitBucketsTable).where(eq(rateLimitBucketsTable.key, `whatsapp:${doctorId}`));
  });

  it("accepts the doctor's own patient (any phone formatting) and stores the doctor", async () => {
    const response = await send("5527988887777", "Olá! Link do seguimento.");
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: number };
    const [row] = await db.select().from(whatsappOutboxTable).where(eq(whatsappOutboxTable.id, id));
    expect(row?.doctorId).toBe(doctorId);
  });

  it("refuses arbitrary numbers and other doctors' patients", async () => {
    expect((await send("5511912345678", "spam")).status).toBe(403);
    expect((await send("(21) 97777-6666", "spam")).status).toBe(403);
  });

  it("caps the message length and requires an Idempotency-Key", async () => {
    expect((await send(PATIENT_PHONE, "x".repeat(1001))).status).toBe(400);
    const noKey = await call("/notifications/send-text", { method: "POST", body: JSON.stringify({ phone: PATIENT_PHONE, text: "oi" }) });
    expect(noKey.status).toBe(400);
  });

  it("applies a DB-backed hourly limit per doctor", async () => {
    process.env["DOCREGEN_WHATSAPP_HOURLY_LIMIT"] = "2";
    try {
      expect((await send(PATIENT_PHONE, "1")).status).toBe(202);
      expect((await send(PATIENT_PHONE, "2")).status).toBe(202);
      const limited = await send(PATIENT_PHONE, "3");
      expect(limited.status).toBe(429);
      expect((await limited.json() as { code: string }).code).toBe("WHATSAPP_RATE_LIMIT");
    } finally {
      delete process.env["DOCREGEN_WHATSAPP_HOURLY_LIMIT"];
    }
  });
});

describe("calendar date validation", () => {
  it("notifications/init: invalid baseDate is 400 (no roll-over)", async () => {
    for (const baseDate of ["2026-13-45", "2026-02-30", "amanhã", 20260101]) {
      const response = await call(`/regen/cases/${caseId}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate }) });
      expect(response.status, String(baseDate)).toBe(400);
    }
    const ok = await call(`/regen/cases/${caseId}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate: "2026-02-28" }) });
    expect(ok.status).toBe(200);
    const rows = await ok.json() as Array<{ periodo: string; scheduled_date: string }>;
    expect(rows.find((row) => row.periodo === "1 mês")?.scheduled_date).toBe("2026-03-30");
  });

  it("case, procedure, appointment and patient dates must be real days", async () => {
    expect((await call("/regen/cases", { method: "POST", body: JSON.stringify({ patientName: "X", conditionCode: "OA_JOELHO_KL3", patientDob: "1980-02-30" }) })).status).toBe(400);
    expect((await call(`/regen/cases/${caseId}`, { method: "PATCH", body: JSON.stringify({ dataCaso: "2026-13-01" }) })).status).toBe(400);
    expect((await call(`/regen/cases/${caseId}/procedures`, { method: "POST", body: JSON.stringify({ productCode: "PRP", performedAt: "2026-02-30" }) })).status).toBe(400);
    expect((await call("/appointments", { method: "POST", body: JSON.stringify({ patientId, data: "2026-02-30", hora: "10:00" }) })).status).toBe(400);
    expect((await call("/appointments", { method: "POST", body: JSON.stringify({ patientId, data: "2026-03-01", hora: "25:00" }) })).status).toBe(400);
    expect((await call("/patients", { method: "POST", body: JSON.stringify({ nome: "Data Ruim", dataNascimento: "1990-02-31" }) })).status).toBe(400);
  });

  it("follow-up status must be a known value", async () => {
    const [notification] = (await pool.query(`SELECT id FROM regen_followup_notifications WHERE case_id = $1 LIMIT 1`, [caseId])).rows;
    expect((await call(`/regen/cases/${caseId}/notifications/${notification.id}`, { method: "PATCH", body: JSON.stringify({ status: "hacked" }) })).status).toBe(400);
    expect((await call(`/regen/cases/${caseId}/notifications/${notification.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) })).status).toBe(200);
  });
});

describe("labs", () => {
  it("validates the body", async () => {
    expect((await call(`/regen/cases/${caseId}/labs`, { method: "POST", body: JSON.stringify({ results: [] }) })).status).toBe(400);
    expect((await call(`/regen/cases/${caseId}/labs`, { method: "POST", body: JSON.stringify({ results: [{ analyte: "PCR", value: "abc" }] }) })).status).toBe(400);
    expect((await call(`/regen/cases/${caseId}/labs`, { method: "POST", body: JSON.stringify({ results: "PCR" }) })).status).toBe(400);
  });

  it("inserts all rows or none", async () => {
    const response = await call(`/regen/cases/${caseId}/labs`, {
      method: "POST",
      // The second value overflows numeric(12,4): the whole batch is rolled back.
      body: JSON.stringify({ results: [{ analyte: "PCR", value: 3.2 }, { analyte: "VHS", value: 1e12 }] }),
    });
    expect(response.status).toBe(500);
    const { rows } = await pool.query(`SELECT 1 FROM regen_lab_results WHERE case_id = $1`, [caseId]);
    expect(rows).toHaveLength(0);
  });
});

describe("patient VAS answers", () => {
  let token: string;
  beforeAll(async () => {
    token = randomUUID();
    await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, status, token)
       VALUES ($1, 'Teste VAS', 999, ARRAY['VAS Dor'], 'sent', $2)`, [caseId, token]);
  });
  const answer = (vas: unknown) => fetch(`${baseUrl}/regen-api/patient/regen/${token}/scale/${encodeURIComponent("VAS Dor")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: `docregen_patient_session=${buildPatientSessionToken("regen", token)}`,
    },
    body: JSON.stringify({ respostas: { vas } }),
  });

  it("rejects out-of-range and boolean answers instead of clamping", async () => {
    expect((await answer(11)).status).toBe(400);
    expect((await answer(-1)).status).toBe(400);
    expect((await answer(true)).status).toBe(400);
    expect((await answer("7")).status).toBe(400);
    const { rows } = await pool.query(
      `SELECT 1 FROM regen_scale_responses r JOIN regen_followup_notifications n ON n.id = r.notification_id WHERE n.token = $1`, [token]);
    expect(rows).toHaveLength(0);
  });

  it("accepts a decimal within 0–10", async () => {
    expect((await answer(5.5)).status).toBe(200);
    const { rows } = await pool.query(
      `SELECT r.score::float8 AS score FROM regen_scale_responses r JOIN regen_followup_notifications n ON n.id = r.notification_id WHERE n.token = $1`, [token]);
    expect(rows[0]?.score).toBe(5.5);
  });
});

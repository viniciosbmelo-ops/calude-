import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  pool,
  regenCasesTable,
  regenTermsAcceptanceTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

const INSERT_GATE_KEY = 86421;

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;

async function apiRequest(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForInsertGate(patientId: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_locks
         WHERE locktype = 'advisory'
           AND classid = $1
           AND objid = $2
           AND granted = false
       ) AS waiting`,
      [INSERT_GATE_KEY, patientId],
    );
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the regenerative case insert gate");
}

beforeAll(async () => {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_hold_regen_case_insert()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.patient_name LIKE 'Regen Concurrency Gate:%' THEN
        PERFORM pg_advisory_xact_lock(${INSERT_GATE_KEY}, NEW.patient_id);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS test_hold_regen_case_insert_trigger ON regen_cases;
    CREATE TRIGGER test_hold_regen_case_insert_trigger
      BEFORE INSERT ON regen_cases
      FOR EACH ROW
      EXECUTE FUNCTION test_hold_regen_case_insert();
  `);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  const [doctor] = await db
    .insert(doctorsTable)
    .values({
      nome: "Regen Patient Link Concurrency Doctor",
      email: `regen-patient-link-${suffix}@example.test`,
      senhaHash: await hashPassword("regen-patient-link-password"),
      isFree: true,
    })
    .returning();
  doctorId = doctor.id;
  auth = signToken({
    doctorId,
    isAdmin: false,
    sessionVersion: doctor.sessionVersion,
  });

  await db.insert(regenTermsAcceptanceTable).values({
    doctorId,
    termsVersion: "terms_regen_v1",
    dpaVersion: "dpa_regen_v1",
  });
});

afterAll(async () => {
  await pool.query(`
    DROP TRIGGER IF EXISTS test_hold_regen_case_insert_trigger ON regen_cases;
    DROP FUNCTION IF EXISTS test_hold_regen_case_insert();
  `);
  if (doctorId) {
    await db.delete(regenCasesTable).where(eq(regenCasesTable.doctorId, doctorId));
    await db
      .delete(regenTermsAcceptanceTable)
      .where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe.sequential("regenerative case patient soft-link concurrency", () => {
  it("never leaves an orphan when linked-case creation races patient deletion", async () => {
    const [patient] = await db
      .insert(patientsTable)
      .values({
        doctorId,
        nome: "Regen Concurrency Patient",
      })
      .returning();

    const gateClient = await pool.connect();
    let gateCommitted = false;
    try {
      await gateClient.query("BEGIN");
      await gateClient.query("SELECT pg_advisory_xact_lock($1, $2)", [
        INSERT_GATE_KEY,
        patient.id,
      ]);

      const createPromise = apiRequest("/api/regen/cases", "POST", {
        patientId: patient.id,
        patientName: `Regen Concurrency Gate:${randomUUID()}`,
        conditionCode: "OA_OMBRO",
      });
      await waitForInsertGate(patient.id);

      const deletePromise = apiRequest(`/api/patients/${patient.id}`, "DELETE");
      await new Promise((resolve) => setTimeout(resolve, 50));

      await gateClient.query("COMMIT");
      gateCommitted = true;

      const [createResponse, deleteResponse] = await Promise.all([
        createPromise,
        deletePromise,
      ]);
      expect(createResponse.status).toBe(201);
      expect(deleteResponse.status).toBe(204);

      const remainingPatients = await db
        .select({ id: patientsTable.id })
        .from(patientsTable)
        .where(eq(patientsTable.id, patient.id));
      const remainingCases = await db
        .select({ id: regenCasesTable.id })
        .from(regenCasesTable)
        .where(eq(regenCasesTable.patientId, patient.id));
      expect(remainingPatients).toHaveLength(0);
      expect(remainingCases).toHaveLength(0);
    } finally {
      if (!gateCommitted) {
        await gateClient.query("ROLLBACK").catch(() => undefined);
      }
      gateClient.release();
      await db.delete(regenCasesTable).where(eq(regenCasesTable.patientId, patient.id));
      await db.delete(patientsTable).where(eq(patientsTable.id, patient.id));
    }
  });
});
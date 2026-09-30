/**
 * A regenerative case created from a patient carries the patient's birth date
 * (and sex/phone) in its snapshot even when the client omits them — so the age
 * and the research age band are never empty for linked cases.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, patientsTable, pool, regenTermsAcceptanceTable } from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";
import { patientSnapshot } from "./regen";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
let patientId: number;

const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}/regen-api${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
});

async function caseRow(id: string) {
  const { rows: [row] } = await pool.query(
    `SELECT patient_name, to_char(patient_dob, 'YYYY-MM-DD') AS patient_dob, patient_sex, patient_phone
       FROM regen_cases WHERE id = $1`, [id]);
  return row as { patient_name: string; patient_dob: string | null; patient_sex: string | null; patient_phone: string | null };
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Snapshot Doctor", email: `snapshot-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  await db.insert(regenTermsAcceptanceTable).values({ doctorId, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1" });
  const [patient] = await db.insert(patientsTable).values({
    doctorId, nome: "JOANA SNAPSHOT", dataNascimento: "1968-03-15", sexo: "F", telefone: "(27) 98888-7777",
  }).returning();
  patientId = patient!.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("patientSnapshot", () => {
  const patient = { nome: "ANA", data_nascimento: "1970-02-03", sexo: "F", telefone: "27999" };

  it("fills every missing field from the patient row and keeps what the client sent", () => {
    expect(patientSnapshot({}, patient)).toEqual({ patientName: "ANA", patientDob: "1970-02-03", patientSex: "F", patientPhone: "27999" });
    expect(patientSnapshot({ patientName: "Ana S.", patientDob: "1971-01-01", patientSex: "M", patientPhone: "1" }, patient))
      .toEqual({ patientName: "Ana S.", patientDob: "1971-01-01", patientSex: "M", patientPhone: "1" });
  });

  it("ignores an invalid stored birth date and works without a patient", () => {
    expect(patientSnapshot({}, { ...patient, data_nascimento: "15/03/1968" }).patientDob).toBeNull();
    expect(patientSnapshot({ patientName: "X" }, undefined)).toEqual({ patientName: "X", patientDob: null, patientSex: null, patientPhone: null });
  });
});

describe("POST /regen/cases from a patient", () => {
  it("the web client's payload (name, no birth date) still stores the patient's DOB, sex and phone", async () => {
    const response = await call("/regen/cases", {
      method: "POST",
      body: JSON.stringify({ patientId, patientName: "JOANA SNAPSHOT", conditionCode: "OA_JOELHO_KL3", weightKg: 70, heightCm: 165, status: "active" }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };
    expect(await caseRow(created.id)).toEqual({
      patient_name: "JOANA SNAPSHOT", patient_dob: "1968-03-15", patient_sex: "F", patient_phone: "(27) 98888-7777",
    });
  });

  it("patientId alone is enough; without patientId a name is required", async () => {
    const response = await call("/regen/cases", { method: "POST", body: JSON.stringify({ patientId, conditionCode: "OA_OMBRO" }) });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };
    expect((await caseRow(created.id)).patient_dob).toBe("1968-03-15");
    expect((await caseRow(created.id)).patient_name).toBe("JOANA SNAPSHOT");

    const anonymous = await call("/regen/cases", { method: "POST", body: JSON.stringify({ conditionCode: "OA_OMBRO" }) });
    expect(anonymous.status).toBe(400);
  });

  it("a legacy linked case without DOB is completed on the next save", async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO regen_cases (id, doctor_id, patient_id, patient_name, condition_code, status) VALUES ($1,$2,$3,'JOANA SNAPSHOT','OA_JOELHO_KL3','draft')`,
      [id, doctorId, patientId]);
    const response = await call(`/regen/cases/${id}`, { method: "PATCH", body: JSON.stringify({ hospitalLocal: "Hospital X" }) });
    expect(response.status).toBe(200);
    expect(await caseRow(id)).toMatchObject({ patient_dob: "1968-03-15", patient_sex: "F", patient_phone: "(27) 98888-7777" });
  });

  it("research export shows the age band for cases created from the patient", async () => {
    const response = await call("/regen/research");
    expect(response.status).toBe(200);
    const body = await response.json() as { rows: Array<{ age_band: string | null; sex: string | null }> };
    expect(body.rows.length).toBeGreaterThanOrEqual(3);
    const today = new Date();
    const age = today.getUTCFullYear() - 1968 - (today.getUTCMonth() + 1 < 3 || (today.getUTCMonth() + 1 === 3 && today.getUTCDate() < 15) ? 1 : 0);
    const low = Math.floor(age / 5) * 5;
    for (const row of body.rows) {
      expect(row.age_band).toBe(`${low}-${low + 4}`);
      expect(row.sex).toBe("F");
    }

    const csv = await (await call("/regen/research?format=csv")).text();
    const [header, ...lines] = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
    const column = header!.split(",").indexOf("age_band");
    expect(column).toBeGreaterThanOrEqual(0);
    for (const line of lines) expect(line.split(",")[column]).toBe(`${low}-${low + 4}`);
  });
});

describe("patient field names match the generated client (camelCase)", () => {
  it("numeroCarteirinha and pais sent by the web form are stored and returned (no longer dropped)", async () => {
    const created = await call("/patients", {
      method: "POST",
      body: JSON.stringify({ nome: "Campos Cliente", dataNascimento: "1980-07-01", numeroCarteirinha: "CART-1", pais: "Brasil" }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { id: number; dataNascimento: string; numeroCarteirinha: string; pais: string };
    expect(body).toMatchObject({ dataNascimento: "1980-07-01", numeroCarteirinha: "CART-1", pais: "Brasil" });
    expect(body).not.toHaveProperty("data_nascimento");

    const updated = await call(`/patients/${body.id}`, { method: "PATCH", body: JSON.stringify({ numeroCarteirinha: "CART-2", pais: "Uruguai" }) });
    expect(await updated.json()).toMatchObject({ numeroCarteirinha: "CART-2", pais: "Uruguai" });
    // No clinical data: the mistaken registration can still be deleted.
    expect((await call(`/patients/${body.id}`, { method: "DELETE" })).status).toBe(204);
  });
});

/**
 * LGPD Art. 11 (minimização): GET /patients para a secretária não traz registros cirúrgicos nem
 * campos clínicos do cadastro; para o médico a resposta continua completa.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, patientsTable, secretariesTable, surgeriesTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signSecretaryToken, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let surgeryId: number;
let auth: string;
let secretaryAuth: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };

async function call(path: string, method: string, token: string, body?: unknown): Promise<JsonResponse> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const CLINICAL_PATIENT_KEYS = [
  "ladoDominante", "tabagismo", "diabetes", "nivelAtividade", "lado", "beightonScore", "anamnese", "laudos",
] as const;
const CLINICAL_MARKER = "MARCADOR-CLINICO-SIGILOSO";

beforeAll(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve(s)));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const senhaHash = await hashPassword("secretary-minimization-test-password");
  const [d] = await db.insert(doctorsTable)
    .values({ nome: "Min Doctor", email: `min-doctor-${randomUUID()}@example.test`, senhaHash, isFree: true })
    .returning();
  doctorId = d.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: d.sessionVersion });
  const [sec] = await db.insert(secretariesTable)
    .values({ doctorId, nome: "Min Secretary", email: `min-secretary-${randomUUID()}@example.test`, senhaHash })
    .returning();
  secretaryAuth = signSecretaryToken({ doctorId, secretaryId: sec.id, sessionVersion: sec.sessionVersion });

  const [p] = await db.insert(patientsTable).values({
    doctorId,
    nome: "PACIENTE MINIMIZACAO",
    telefone: "11999990000",
    email: "min@example.test",
    lado: "D",
    ladoDominante: "R",
    tabagismo: "atual",
    diabetes: true,
    nivelAtividade: "competitivo",
    beightonScore: 6,
    anamnese: `${CLINICAL_MARKER} anamnese`,
    laudos: `${CLINICAL_MARKER} laudo`,
  }).returning();
  patientId = p.id;
  const [s] = await db.insert(surgeriesTable).values({
    doctorId,
    patientId,
    regiao: "shoulder",
    tiposProcedimento: ["SH_CUFF"],
    diagnostico: `${CLINICAL_MARKER} diagnostico`,
    observacoes: `${CLINICAL_MARKER} observacoes`,
    dadosClinicos: { nota: CLINICAL_MARKER },
  }).returning();
  surgeryId = s.id;
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("LGPD Art. 11: GET /patients minimizado para a secretária", () => {
  it("secretária: sem `surgeries` e sem campos clínicos; mantém os dados cadastrais", async () => {
    const res = await call("/api/patients", "GET", secretaryAuth);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(CLINICAL_MARKER);
    expect(raw).not.toContain("SH_CUFF");
    const patient = (JSON.parse(raw) as Array<Record<string, unknown>>).find((p) => p.id === patientId);
    expect(patient).toBeDefined();
    expect(patient).not.toHaveProperty("surgeries");
    for (const key of CLINICAL_PATIENT_KEYS) expect(patient, key).not.toHaveProperty(key);
    expect(patient).toMatchObject({
      id: patientId, doctorId, nome: "PACIENTE MINIMIZACAO", telefone: "11999990000", email: "min@example.test",
    });
    expect(typeof patient!.createdAt).toBe("string");
  });

  it("médico: resposta inalterada (cirurgias completas e perfil clínico)", async () => {
    const res = await call("/api/patients", "GET", auth);
    expect(res.status).toBe(200);
    const patient = (await res.json()).find((p: { id: number }) => p.id === patientId);
    expect(patient).toMatchObject({
      lado: "D", ladoDominante: "R", tabagismo: "atual", diabetes: true, nivelAtividade: "competitivo", beightonScore: 6,
      anamnese: `${CLINICAL_MARKER} anamnese`, laudos: `${CLINICAL_MARKER} laudo`,
    });
    expect(patient.surgeries).toHaveLength(1);
    expect(patient.surgeries[0]).toMatchObject({
      id: surgeryId,
      tiposProcedimento: ["SH_CUFF"],
      diagnostico: `${CLINICAL_MARKER} diagnostico`,
      observacoes: `${CLINICAL_MARKER} observacoes`,
      dadosClinicos: { nota: CLINICAL_MARKER },
    });
    expect(typeof patient.surgeries[0].createdAt).toBe("string");
  });

  it("POST da secretária: lado/beighton/anamnese ignorados e não devolvidos", async () => {
    const res = await call("/api/patients", "POST", secretaryAuth, { nome: "Paciente Recepcao Min", lado: "E", beightonScore: 4 });
    expect(res.status).toBe(201);
    const created = await res.json();
    for (const key of CLINICAL_PATIENT_KEYS) expect(created, key).not.toHaveProperty(key);
    const [row] = await db.select().from(patientsTable).where(eq(patientsTable.id, created.id));
    expect(row).toMatchObject({ lado: null, beightonScore: null });
  });
});

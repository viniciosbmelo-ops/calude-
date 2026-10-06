/**
 * Perfil clínico no cadastro do paciente (lado dominante, tabagismo, diabetes, nível de atividade):
 * ida e volta pela API real (criar, ler, editar, limpar), validação pelos enums e exportação LGPD.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, patientsTable, secretariesTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signSecretaryToken, signToken } from "../lib/auth";
import { patientClinicalCsvExtra } from "../lib/patient-clinical-export";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
let secretaryAuth: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };

async function call(path: string, method: string, body?: unknown, token: string = auth): Promise<JsonResponse> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve(s)));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const senhaHash = await hashPassword("clinical-profile-test-password");
  const [d] = await db.insert(doctorsTable)
    .values({ nome: "CP Doctor", email: `cp-doctor-${randomUUID()}@example.test`, senhaHash, isFree: true })
    .returning();
  doctorId = d.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: d.sessionVersion });
  const [sec] = await db.insert(secretariesTable)
    .values({ doctorId, nome: "CP Secretary", email: `cp-secretary-${randomUUID()}@example.test`, senhaHash })
    .returning();
  secretaryAuth = signSecretaryToken({ doctorId, secretaryId: sec.id, sessionVersion: sec.sessionVersion });
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const PERFIL = { ladoDominante: "L", tabagismo: "ex_tabagista", diabetes: true, nivelAtividade: "trabalhador_bracal" };

describe.sequential("cadastro do paciente: perfil clínico", () => {
  let id: number;

  it("cria com os quatro campos e devolve os mesmos valores no POST, no GET e na lista", async () => {
    const res = await call("/api/patients", "POST", { nome: "Paciente Perfil", ...PERFIL });
    expect(res.status).toBe(201);
    const created = await res.json();
    id = created.id;
    expect(created).toMatchObject(PERFIL);
    const got = await (await call(`/api/patients/${id}`, "GET")).json();
    expect(got).toMatchObject(PERFIL);
    const list = await (await call("/api/patients", "GET")).json();
    expect(list.find((p: { id: number }) => p.id === id)).toMatchObject(PERFIL);
    const [row] = await db.select().from(patientsTable).where(eq(patientsTable.id, id));
    expect(row).toMatchObject(PERFIL);
  });

  it("sem os campos: ficam null (não informado)", async () => {
    const created = await (await call("/api/patients", "POST", { nome: "Paciente Sem Perfil" })).json();
    expect(created).toMatchObject({ ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null });
  });

  it("edita, preserva o que não foi enviado e limpa com null", async () => {
    const upd = await call(`/api/patients/${id}`, "PATCH", { tabagismo: "atual", diabetes: false });
    expect(upd.status).toBe(200);
    expect(await upd.json()).toMatchObject({ ladoDominante: "L", tabagismo: "atual", diabetes: false, nivelAtividade: "trabalhador_bracal" });
    const clr = await (await call(`/api/patients/${id}`, "PATCH", { ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null })).json();
    expect(clr).toMatchObject({ ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null });
  });

  it("recusa valores fora dos enums (os mesmos do núcleo clínico)", async () => {
    for (const bad of [
      { ladoDominante: "D" }, { tabagismo: "ex" }, { diabetes: "sim" }, { nivelAtividade: "Sedentário" }, { nivelAtividade: "atleta_elite" },
    ]) {
      expect((await call("/api/patients", "POST", { nome: "Inválido", ...bad })).status, JSON.stringify(bad)).toBe(400);
      expect((await call(`/api/patients/${id}`, "PATCH", bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("LGPD: acesso e portabilidade incluem o perfil; anonimização o apaga", async () => {
    await call(`/api/patients/${id}`, "PATCH", PERFIL);
    const dados = await (await call("/api/lgpd/dados", "GET")).json();
    expect(dados.dados.pacientes.find((p: { id: number }) => p.id === id)).toMatchObject(PERFIL);
    const json = await (await call("/api/lgpd/exportar?formato=json", "GET")).json();
    expect(json.pacientes.find((p: { id: number }) => p.id === id)).toMatchObject(PERFIL);
    const csv = await (await call("/api/lgpd/exportar?formato=csv", "GET")).text();
    expect(csv).toContain("ladoDominante=L|tabagismo=ex_tabagista|diabetes=sim|nivelAtividade=trabalhador_bracal");
    expect((await call(`/api/lgpd/anonimizar-paciente/${id}`, "POST")).status).toBe(200);
    const [row] = await db.select().from(patientsTable).where(eq(patientsTable.id, id));
    expect(row.nome).toMatch(/^Paciente Anonimizado/);
    expect(row).toMatchObject({ ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null });
  });

  it("exclusão do paciente remove a linha com o perfil clínico", async () => {
    const created = await (await call("/api/patients", "POST", { nome: "Paciente Excluir", ...PERFIL })).json();
    expect((await call(`/api/patients/${created.id}`, "DELETE")).status).toBeLessThan(300);
    const rows = await db.select().from(patientsTable).where(eq(patientsTable.id, created.id));
    expect(rows).toHaveLength(0);
  });

  it("CSV: campos ausentes ficam vazios", () => {
    expect(patientClinicalCsvExtra({ ladoDominante: null, tabagismo: null, diabetes: false, nivelAtividade: null }))
      .toBe("ladoDominante=|tabagismo=|diabetes=nao|nivelAtividade=");
  });
});

const SENSITIVE_KEYS = ["ladoDominante", "tabagismo", "diabetes", "nivelAtividade"] as const;

describe.sequential("LGPD Art. 11: secretária não vê nem grava o perfil clínico", () => {
  it("lista da secretária omite os quatro campos; a do médico os mantém", async () => {
    const created = await (await call("/api/patients", "POST", { nome: "Paciente Sensivel", ...PERFIL })).json();
    const secList = await call("/api/patients", "GET", undefined, secretaryAuth);
    expect(secList.status).toBe(200);
    const secPatient = (await secList.json()).find((p: { id: number }) => p.id === created.id);
    expect(secPatient).toBeDefined();
    expect(secPatient.nome).toBe("PACIENTE SENSIVEL");
    for (const key of SENSITIVE_KEYS) expect(secPatient, key).not.toHaveProperty(key);
    const docPatient = (await (await call("/api/patients", "GET")).json()).find((p: { id: number }) => p.id === created.id);
    expect(docPatient).toMatchObject(PERFIL);
  });

  it("POST da secretária: campos ignorados em silêncio (201, nada gravado, nada devolvido)", async () => {
    const res = await call("/api/patients", "POST", { nome: "Paciente Recepcao", ...PERFIL }, secretaryAuth);
    expect(res.status).toBe(201);
    const created = await res.json();
    for (const key of SENSITIVE_KEYS) expect(created, key).not.toHaveProperty(key);
    const [row] = await db.select().from(patientsTable).where(eq(patientsTable.id, created.id));
    expect(row).toMatchObject({ doctorId, ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null });
    // O médico vê o cadastro e pode completar o perfil depois.
    const got = await (await call(`/api/patients/${created.id}`, "GET")).json();
    expect(got).toMatchObject({ ladoDominante: null, tabagismo: null, diabetes: null, nivelAtividade: null });
  });

  it("secretária continua sem acesso ao detalhe/edição do paciente", async () => {
    const created = await (await call("/api/patients", "POST", { nome: "Paciente Detalhe" })).json();
    expect((await call(`/api/patients/${created.id}`, "GET", undefined, secretaryAuth)).status).toBeGreaterThanOrEqual(401);
    expect((await call(`/api/patients/${created.id}`, "PATCH", PERFIL, secretaryAuth)).status).toBeGreaterThanOrEqual(401);
  });
});

/**
 * A secretary session only ever receives the front-desk projection of a
 * patient (identification + contact + registro), never CPF, anamnesis,
 * reports, health-plan card or address, on any route it can reach.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, patientsTable, secretariesTable } from "@workspace/docregen-db";
import app from "../app";
import { signSecretaryToken, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let doctorAuth: string;
let secretaryAuth: string;

const SECRET_MARKERS = ["529.982.247-25", "ANAMNESE-SIGILOSA", "LAUDO-SIGILOSO", "CARTEIRINHA-998877", "Rua Sigilosa", "29000-000"];

function call(auth: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const suffix = randomUUID();
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Projection Doctor", email: `projection-${suffix}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  const [secretary] = await db.insert(secretariesTable).values({
    doctorId, nome: "Projection Secretary", email: `projection-sec-${suffix}@example.test`, senhaHash: "x",
  }).returning();
  const [patient] = await db.insert(patientsTable).values({
    doctorId,
    nome: "PACIENTE PROJECAO",
    cpf: "529.982.247-25",
    telefone: "27999990000",
    email: "paciente@example.test",
    dataNascimento: "1970-05-06",
    anamnese: "ANAMNESE-SIGILOSA",
    laudos: "LAUDO-SIGILOSO",
    planoSaude: "Plano X",
    numeroCarteirinha: "CARTEIRINHA-998877",
    endereco: "Rua Sigilosa, 1",
    cep: "29000-000",
    numeroRegistro: `PAC-TEST-${suffix.slice(0, 8)}`,
  }).returning();
  patientId = patient!.id;
  doctorAuth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  secretaryAuth = signSecretaryToken({ secretaryId: secretary!.id, doctorId, sessionVersion: 0 });
});

afterAll(async () => {
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("secretary patient projection", () => {
  it("GET /patients returns only front-desk fields to a secretary", async () => {
    const response = await call(secretaryAuth, "/regen-api/patients");
    expect(response.status).toBe(200);
    const body = await response.json() as Array<Record<string, unknown>>;
    const row = body.find((p) => p["id"] === patientId)!;
    expect(Object.keys(row).sort()).toEqual(
      ["createdAt", "dataNascimento", "email", "id", "nome", "numeroRegistro", "telefone"],
    );
    const text = JSON.stringify(body);
    for (const marker of SECRET_MARKERS) expect(text).not.toContain(marker);
  });

  it("the doctor still receives the full record", async () => {
    const body = await (await call(doctorAuth, "/regen-api/patients")).json() as Array<Record<string, unknown>>;
    const row = body.find((p) => p["id"] === patientId)!;
    expect(row["cpf"]).toBe("529.982.247-25");
    expect(row["anamnese"]).toBe("ANAMNESE-SIGILOSA");
  });

  it("POST /patients by a secretary answers with the projection", async () => {
    const response = await call(secretaryAuth, "/regen-api/patients", {
      method: "POST",
      body: JSON.stringify({ nome: "Novo Pela Recepcao", cpf: "529.982.247-25", telefone: "27988887777", cep: "29000-000" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("cpf");
    expect(body).not.toHaveProperty("cep");
    expect(body["numeroRegistro"]).toMatch(/^PAC-/);
    // Stored in full for the doctor.
    const [stored] = await db.select().from(patientsTable).where(eq(patientsTable.id, body["id"] as number));
    expect(stored?.cpf).toBe("529.982.247-25");
  });

  it("patient detail and clinical routes stay doctor-only", async () => {
    for (const path of [
      `/regen-api/patients/${patientId}`,
      `/regen-api/patients/${patientId}/attachments`,
      `/regen-api/patients/${patientId}/pre-consult`,
      "/regen-api/regen/cases",
      "/regen-api/regen/research",
      "/regen-api/regen/followup-overview",
      "/regen-api/pre-consults/summary",
      "/regen-api/lgpd/dados",
    ]) {
      const response = await call(secretaryAuth, path);
      expect([401, 403], `${path} → ${response.status}`).toContain(response.status);
    }
  });

  it("agenda, regen summary and alerts carry no CPF or clinical text", async () => {
    await call(secretaryAuth, "/regen-api/appointments", {
      method: "POST",
      body: JSON.stringify({ patientId, data: "2099-01-02", hora: "09:00" }),
    });
    for (const path of ["/regen-api/appointments", "/regen-api/secretary/regen-cases", "/regen-api/secretary/followup-alerts"]) {
      const response = await call(secretaryAuth, path);
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const marker of SECRET_MARKERS) expect(text, path).not.toContain(marker);
    }
  });
});

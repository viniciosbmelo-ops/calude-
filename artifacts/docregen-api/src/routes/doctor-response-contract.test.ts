/**
 * Contract tests: responses of the DocRegen API must satisfy the schemas
 * generated from DocRegen's own OpenAPI spec (lib/docregen-api-spec), which is
 * what the DocRegen frontend client is generated from.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CreatePatientResponse,
  GetCurrentDoctorResponse,
  GetDoctorResponse,
  GetPatientResponse,
  HealthCheckResponse,
  ListPatientsResponse,
} from "@workspace/docregen-api-zod";
import { db, doctorsTable, patientsTable } from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let authorization: string;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Dra. Contrato",
    email: `docregen-contract-${randomUUID()}@example.test`,
    senhaHash: "unused",
    // Registration always stores these; the spec marks them as required.
    crm: "123456",
    crmEstado: "SP",
    cpf: "52998224725",
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  authorization = `Bearer ${signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion })}`;
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(patientsTable).where(eq(patientsTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: authorization } });
}

describe("DocRegen API response contracts", () => {
  it("health check matches the spec", async () => {
    const response = await fetch(`${baseUrl}/regen-api/healthz`);
    expect(response.status).toBe(200);
    expect(HealthCheckResponse.safeParse(await response.json()).success).toBe(true);
  });

  it("current doctor and doctor profile match the spec without credentials", async () => {
    const me = await get("/regen-api/auth/me");
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(GetCurrentDoctorResponse.safeParse(meBody).success).toBe(true);
    expect(JSON.stringify(meBody)).not.toContain("senhaHash");

    const profile = await get(`/regen-api/doctors/${doctorId}`);
    expect(profile.status).toBe(200);
    expect(GetDoctorResponse.safeParse(await profile.json()).success).toBe(true);
  });

  it("patient create, list and detail responses match the spec", async () => {
    const created = await fetch(`${baseUrl}/regen-api/patients`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Paciente Contrato" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: number };
    expect(CreatePatientResponse.safeParse(createdBody).success).toBe(true);

    const list = await get("/regen-api/patients");
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(ListPatientsResponse.safeParse(listBody).success).toBe(true);

    const detail = await get(`/regen-api/patients/${createdBody.id}`);
    expect(detail.status).toBe(200);
    expect(GetPatientResponse.safeParse(await detail.json()).success).toBe(true);
  });
});

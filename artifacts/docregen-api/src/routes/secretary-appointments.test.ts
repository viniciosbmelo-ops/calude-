import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  secretariesTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signSecretaryToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let secretaryToken: string;

function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretaryToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
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
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Appointment Test Doctor",
    email: `appointment-doctor-${suffix}@example.test`,
    senhaHash: "unused",
    isFree: true,
  }).returning();
  doctorId = doctor.id;

  const [secretary] = await db.insert(secretariesTable).values({
    doctorId,
    nome: "Appointment Test Secretary",
    email: `appointment-secretary-${suffix}@example.test`,
    senhaHash: "unused",
  }).returning();

  const [patient] = await db.insert(patientsTable).values({
    doctorId,
    nome: "Appointment Test Patient",
  }).returning();
  patientId = patient.id;

  secretaryToken = signSecretaryToken({
    doctorId,
    secretaryId: secretary.id,
    sessionVersion: secretary.sessionVersion,
  });
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("secretary appointments", () => {
  it("returns a newly created appointment when the agenda reloads", async () => {
    const createResponse = await request("/regen-api/appointments", {
      method: "POST",
      body: JSON.stringify({
        patientId,
        data: "2099-12-20",
        hora: "09:30",
        tipo: "consulta",
        observacoes: "Agenda regression test",
        status: "agendado",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: number };

    const listResponse = await request("/regen-api/appointments");
    expect(listResponse.status).toBe(200);
    const appointments = await listResponse.json() as Array<{
      id: number;
      patientNome: string | null;
      data: string;
      hora: string;
    }>;

    expect(appointments).toContainEqual(expect.objectContaining({
      id: created.id,
      patientNome: "Appointment Test Patient",
      data: "2099-12-20",
      hora: "09:30",
    }));
  });
});
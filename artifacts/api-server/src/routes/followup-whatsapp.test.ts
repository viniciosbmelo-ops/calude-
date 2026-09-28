import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  doctorsTable,
  followupTable,
  patientsTable,
  surgeriesTable,
} from "@workspace/db";
import { hashPassword, signToken } from "../lib/auth";

const mockSendWhatsAppText = vi.hoisted(() => vi.fn());

vi.mock("../lib/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/whatsapp")>();
  return {
    ...actual,
    sendWhatsAppText: mockSendWhatsAppText,
  };
});

import app from "../app";

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let surgeryId: number;
let auth: string;

async function request(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: "{}",
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
    nome: "Doctora Española",
    email: `followup-whatsapp-${suffix}@example.test`,
    senhaHash: await hashPassword("followup-whatsapp-password"),
    idioma: "es",
    isFree: true,
  }).returning();
  doctorId = doctor.id;

  const [patient] = await db.insert(patientsTable).values({
    doctorId,
    nome: "Paciente Española",
    telefone: "5511999999999",
    cpf: "12345678909",
  }).returning();
  patientId = patient.id;

  const [surgery] = await db.insert(surgeriesTable).values({
    doctorId,
    patientId,
    tiposProcedimento: ["LCA"],
    status: "rascunho",
  }).returning();
  surgeryId = surgery.id;

  auth = signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion });
});

beforeEach(async () => {
  mockSendWhatsAppText.mockReset();
  await db.delete(followupTable).where(eq(followupTable.surgeryId, surgeryId));
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function createFollowupWithoutPeriodOrScales(): Promise<number> {
  // Empty legacy values represent a missing period while satisfying the NOT NULL column.
  const [followup] = await db.insert(followupTable).values({
    surgeryId,
    tempo: "",
    escalasEnviadas: [],
  }).returning();
  return followup.id;
}

function expectSpanishDefaults(text: string): void {
  expect(text).toContain("Posoperatorio");
  expect(text).toContain("evaluaciones clínicas");
  expect(text).not.toContain("pós-operatório");
  expect(text).not.toContain("avaliação clínica");
}

describe.sequential("follow-up WhatsApp Spanish defaults", () => {
  it("returns a stable Spanish error for malformed authenticated follow-up requests", async () => {
    const [followup] = await db.insert(followupTable).values({
      surgeryId,
      tempo: "6 semanas",
    }).returning();

    const [createResponse, updateResponse] = await Promise.all([
      fetch(`${baseUrl}/api/followup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ surgeryId: "invalid" }),
      }),
      fetch(`${baseUrl}/api/followup/${followup.id}/update`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vasDor: "invalid" }),
      }),
    ]);
    // Só campos desconhecidos (ex.: escore que não existe mais) também é um corpo inválido
    const emptyUpdate = await fetch(`${baseUrl}/api/followup/${followup.id}/update`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ikdc: 80 }),
    });

    for (const response of [createResponse, updateResponse, emptyUpdate]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Datos no válidos" });
    }
  });

  it("prepares Spanish fallbacks when the follow-up has no period or scales", async () => {
    const followupId = await createFollowupWithoutPeriodOrScales();

    const response = await request(`/api/followup/${followupId}/prepare-whatsapp`);

    expect(response.status).toBe(200);
    const body = await response.json() as { message: string };
    expectSpanishDefaults(body.message);
  });

  it("sends Spanish fallbacks through the mocked transport when period and scales are absent", async () => {
    mockSendWhatsAppText.mockResolvedValue({ ok: true, messageId: "mock-message-id" });
    const followupId = await createFollowupWithoutPeriodOrScales();

    const response = await request(`/api/followup/${followupId}/send-whatsapp`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, messageId: "mock-message-id" });
    expect(mockSendWhatsAppText).toHaveBeenCalledTimes(1);
    expectSpanishDefaults(mockSendWhatsAppText.mock.calls[0]![1] as string);
  });
});
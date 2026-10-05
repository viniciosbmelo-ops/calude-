import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  doctorsTable,
  followupTable,
  patientsTable,
  scheduledNotificationsTable,
  surgeriesTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

// Datas de calendário da clínica: às 22:30 em São Paulo o dia UTC já virou.
// 2026-10-31 22:30 em São Paulo = 2026-11-01 01:30 UTC (domingo, novembro, em UTC).
const EVENING_SP = new Date("2026-11-01T01:30:00Z");

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let surgeryId: number;
let sessionVersion: number;

async function apiRequest(path: string, method: string, body?: unknown): Promise<Response> {
  const auth = signToken({ doctorId, isAdmin: false, sessionVersion });
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Clinic Dates Doctor",
    email: `clinic-dates-${randomUUID()}@example.test`,
    senhaHash: await hashPassword("clinic-dates-password"),
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  sessionVersion = doctor.sessionVersion;
  const [patient] = await db.insert(patientsTable).values({
    doctorId, nome: "Paciente Datas da Clínica", telefone: "5511977776666",
  }).returning();
  patientId = patient.id;
  const [surgery] = await db.insert(surgeriesTable).values({
    doctorId, patientId, tiposProcedimento: ["SH_CUFF"], status: "rascunho",
  }).returning();
  surgeryId = surgery.id;
  // Uma consulta em cada data relevante
  await db.insert(appointmentsTable).values(
    ["2026-10-01", "2026-10-25", "2026-10-31", "2026-11-01"].map((data) => ({ doctorId, patientId, data, hora: "10:00" })),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.sequential("datas de calendário às 22:30 em São Paulo", () => {
  it("relatório de consultas: dia, semana e mês seguem o dia da clínica, não o UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_SP);
    const total = async (periodo: string) => {
      const res = await apiRequest(`/api/reports/consultas?periodo=${periodo}`, "GET");
      expect(res.status).toBe(200);
      return ((await res.json()) as { total: number }).total;
    };
    expect(await total("dia")).toBe(1); // 2026-10-31
    expect(await total("semana")).toBe(2); // domingo 25 a sábado 31
    expect(await total("mes")).toBe(3); // outubro inteiro, sem 01/11
  });

  it("follow-up criado ao preparar o WhatsApp: dataAvaliacao é o dia da clínica", async () => {
    const [notif] = await db.insert(scheduledNotificationsTable).values({
      surgeryId, patientId, periodo: "6 semanas", scales: ["VAS Dor"], scheduledDate: "2026-10-31",
    }).returning();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_SP);
    const res = await apiRequest(`/api/surgeries/${surgeryId}/schedule/${notif.id}/prepare-whatsapp`, "POST");
    expect(res.status).toBe(200);
    const { followupId } = (await res.json()) as { followupId: number };
    const [row] = await db.select().from(followupTable).where(eq(followupTable.id, followupId));
    expect(row!.dataAvaliacao).toBe("2026-10-31");
  });
});

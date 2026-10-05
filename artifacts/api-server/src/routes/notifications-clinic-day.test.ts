import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  scheduledNotificationsTable,
  surgeriesTable,
  whatsappOutboxTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

// "Hoje" para envio de questionários é o dia de calendário de São Paulo, não o dia UTC:
// às 22:30 em São Paulo (01:30 UTC do dia seguinte) o questionário de amanhã não pode sair.

const EVENING_SP = new Date("2026-10-06T01:30:00Z"); // 2026-10-05 22:30 em São Paulo
const AFTER_MIDNIGHT_SP = new Date("2026-10-06T03:30:00Z"); // 2026-10-06 00:30 em São Paulo

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let surgeryId: number;
let sessionVersion: number;
const notificationIds: number[] = [];

async function apiRequest(path: string, method: string, body?: unknown): Promise<Response> {
  const auth = signToken({ doctorId, isAdmin: false, sessionVersion });
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function insertNotification(periodo: string, scheduledDate: string) {
  const [notification] = await db.insert(scheduledNotificationsTable).values({
    surgeryId, patientId, periodo, scales: ["VAS Dor"], scheduledDate,
  }).returning();
  notificationIds.push(notification.id);
  return notification;
}

async function statusOf(id: number) {
  const [row] = await db.select().from(scheduledNotificationsTable).where(eq(scheduledNotificationsTable.id, id));
  return row!.status;
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Clinic Day Doctor",
    email: `clinic-day-${randomUUID()}@example.test`,
    senhaHash: await hashPassword("clinic-day-password"),
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  sessionVersion = doctor.sessionVersion;
  const [patient] = await db.insert(patientsTable).values({
    doctorId, nome: "Paciente Dia da Clínica", telefone: "5511988887777", cpf: "52998224725",
  }).returning();
  patientId = patient.id;
  const [surgery] = await db.insert(surgeriesTable).values({
    doctorId, patientId, tiposProcedimento: ["SH_CUFF"], status: "rascunho",
  }).returning();
  surgeryId = surgery.id;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (notificationIds.length) {
    await db.delete(whatsappOutboxTable).where(inArray(whatsappOutboxTable.scheduledNotificationId, notificationIds));
  }
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.sequential("follow-up sending uses the clinic's calendar day (America/Sao_Paulo)", () => {
  it("at 22:30 in São Paulo, tomorrow's questionnaire is upcoming and is not dispatched", async () => {
    const today = await insertNotification("6 semanas", "2026-10-05");
    const tomorrow = await insertNotification("3 meses", "2026-10-06");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_SP);

    const pendingRes = await apiRequest("/api/notifications/pending", "GET");
    expect(pendingRes.status).toBe(200);
    const body = await pendingRes.json() as Record<string, { notif: { id: number } }[]>;
    expect(body.pending!.map((r) => r.notif.id)).toContain(today.id);
    expect(body.pending!.map((r) => r.notif.id)).not.toContain(tomorrow.id);
    expect(body.upcoming!.map((r) => r.notif.id)).toContain(tomorrow.id);

    const dispatchRes = await apiRequest("/api/notifications/dispatch-pending", "POST", { surgeryId });
    expect(dispatchRes.status).toBe(200);
    const dispatched = await dispatchRes.json() as { details: { notifId: number }[] };
    const ids = dispatched.details.map((d) => d.notifId);
    expect(ids).toContain(today.id);
    expect(ids).not.toContain(tomorrow.id);
    expect(await statusOf(tomorrow.id)).toBe("pending");
  });

  it("at 00:30 in São Paulo, today's questionnaire is dispatched", async () => {
    const tomorrowId = notificationIds[1]!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTER_MIDNIGHT_SP);

    const pendingRes = await apiRequest("/api/notifications/pending", "GET");
    const body = await pendingRes.json() as Record<string, { notif: { id: number } }[]>;
    expect(body.pending!.map((r) => r.notif.id)).toContain(tomorrowId);

    const dispatchRes = await apiRequest("/api/notifications/dispatch-pending", "POST", { surgeryId });
    expect(dispatchRes.status).toBe(200);
    const dispatched = await dispatchRes.json() as { details: { notifId: number }[] };
    expect(dispatched.details.map((d) => d.notifId)).toContain(tomorrowId);
    expect(await statusOf(tomorrowId)).not.toBe("pending");
  });
});

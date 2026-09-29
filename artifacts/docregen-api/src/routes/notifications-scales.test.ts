import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  followupTable,
  patientsTable,
  scheduledNotificationsTable,
  surgeriesTable,
  whatsappOutboxTable,
} from "@workspace/docregen-db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

// Linhas antigas de scheduled_notifications podem listar escalas do joelho já retiradas.
// Elas não devem chegar ao paciente nem à tela, mas o registro gravado não é alterado.

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let surgeryId: number;
let auth: string;
const notificationIds: number[] = [];

async function apiRequest(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function insertNotification(scales: string[]) {
  const [notification] = await db.insert(scheduledNotificationsTable).values({
    surgeryId,
    patientId,
    periodo: "3 meses",
    scales,
    scheduledDate: new Date().toISOString().slice(0, 10),
  }).returning();
  notificationIds.push(notification.id);
  return notification;
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Notification Scales Doctor",
    email: `notification-scales-${randomUUID()}@example.test`,
    senhaHash: await hashPassword("notification-scales-password"),
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  const [patient] = await db.insert(patientsTable).values({
    doctorId, nome: "Paciente Escalas", telefone: "5511999999999", cpf: "12345678909",
  }).returning();
  patientId = patient.id;
  const [surgery] = await db.insert(surgeriesTable).values({
    doctorId, patientId, tiposProcedimento: ["SH_CUFF"], status: "rascunho",
  }).returning();
  surgeryId = surgery.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion });
});

afterAll(async () => {
  if (notificationIds.length) {
    await db.delete(whatsappOutboxTable).where(inArray(whatsappOutboxTable.scheduledNotificationId, notificationIds));
  }
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.sequential("scheduled notifications ignore retired knee scales", () => {
  it("dispatch copies only supported scales into the follow-up and the WhatsApp text", async () => {
    const notification = await insertNotification(["IKDC", "VAS Dor", "Lysholm"]);

    const response = await apiRequest(`/api/notifications/${notification.id}/dispatch`, "POST", {});
    expect(response.status).toBe(202);

    const [followup] = await db.select().from(followupTable).where(eq(followupTable.surgeryId, surgeryId));
    expect(followup!.escalasEnviadas).toEqual(["VAS Dor"]);
    const [outbox] = await db.select().from(whatsappOutboxTable)
      .where(eq(whatsappOutboxTable.scheduledNotificationId, notification.id));
    expect(outbox!.message).toContain("Escalas a preencher:* VAS Dor");
    expect(outbox!.message).not.toMatch(/IKDC|Lysholm/);
    const [stored] = await db.select().from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id));
    expect(stored!.scales).toEqual(["IKDC", "VAS Dor", "Lysholm"]);
  });

  it("pending list shows only supported scales without rewriting the stored row", async () => {
    const notification = await insertNotification(["IKDC", "VAS Dor"]);

    const response = await apiRequest("/api/notifications/pending", "GET");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, { notif: { id: number; scales: string[] } }[]>;
    const listed = Object.values(body).flat().find((row) => row.notif.id === notification.id);
    expect(listed?.notif.scales).toEqual(["VAS Dor"]);
    const [stored] = await db.select().from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id));
    expect(stored!.scales).toEqual(["IKDC", "VAS Dor"]);
  });
});

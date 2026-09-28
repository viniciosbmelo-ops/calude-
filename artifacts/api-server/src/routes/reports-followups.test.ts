import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, doctorsTable, followupTable, patientsTable, scheduledNotificationsTable, surgeriesTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { hasRecordedAssessment } from "./reports";
import { classifyFollowupNotification } from "../lib/followup-assessment";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
const completedIds: number[] = [];
let draftId: number;
let answeredFollowupId: number;
let sentFollowupId: number;
let answeredNotifId: number;
let sentNotifId: number;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [doctor] = await db
    .insert(doctorsTable)
    .values({
      nome: "Reports Followups Doctor",
      email: `reports-followups-${randomUUID()}@example.test`,
      senhaHash: await hashPassword("reports-followups-password"),
      isFree: true,
    })
    .returning();
  doctorId = doctor.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion });

  const [patient] = await db
    .insert(patientsTable)
    .values({ doctorId, nome: "Reports Patient", telefone: "5511977777777" })
    .returning();

  const surgeries = await db
    .insert(surgeriesTable)
    .values([
      { doctorId, patientId: patient.id, status: "completo", tiposProcedimento: ["SH_CUFF", "SH_INSTABILITY"] },
      { doctorId, patientId: patient.id, status: "completo", tiposProcedimento: ["SH_CUFF"] },
      { doctorId, patientId: patient.id, status: "rascunho", tiposProcedimento: ["SH_CUFF"] },
    ])
    .returning();
  completedIds.push(surgeries[0].id, surgeries[1].id);
  draftId = surgeries[2].id;

  const followups = await db
    .insert(followupTable)
    .values([
      // Respondido: tem desfecho registrado.
      { surgeryId: surgeries[1].id, tempo: "6 semanas", token: randomUUID(), vasDor: 3 },
      // Enviado, sem resposta.
      { surgeryId: surgeries[1].id, tempo: "3 meses", token: randomUUID() },
      // Follow-up de um rascunho: não pode aparecer.
      { surgeryId: draftId, tempo: "6 semanas", token: randomUUID(), vasDor: 5 },
    ])
    .returning();
  answeredFollowupId = followups[0].id;
  sentFollowupId = followups[1].id;

  const notifs = await db
    .insert(scheduledNotificationsTable)
    .values([
      {
        surgeryId: surgeries[1].id, patientId: patient.id, periodo: "6 semanas",
        scheduledDate: "2020-01-01", status: "sent", sentAt: new Date(), followupId: answeredFollowupId,
      },
      {
        surgeryId: surgeries[1].id, patientId: patient.id, periodo: "3 meses",
        scheduledDate: "2020-03-01", status: "sent", sentAt: new Date(), followupId: sentFollowupId,
      },
    ])
    .returning();
  answeredNotifId = notifs[0].id;
  sentNotifId = notifs[1].id;
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(doctorsTable).where(and(eq(doctorsTable.isAdmin, false), eq(doctorsTable.id, doctorId)));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("GET /reports/followups", () => {
  it("excludes draft surgeries and their follow-ups", async () => {
    const response = await fetch(`${baseUrl}/api/reports/followups`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<{
      id: number | null; surgeryId: number; surgeryStatus: string; respondida: boolean;
    }>;

    expect(rows.map((row) => row.surgeryId)).not.toContain(draftId);
    expect(rows.every((row) => row.surgeryStatus !== "rascunho")).toBe(true);
    expect(new Set(rows.map((row) => row.surgeryId))).toEqual(new Set(completedIds));
    // 1 cirurgia sem follow-up + 2 registros de follow-up da outra cirurgia.
    expect(rows).toHaveLength(3);

    const byId = new Map(rows.filter((row) => row.id != null).map((row) => [row.id, row]));
    expect(byId.get(answeredFollowupId)?.respondida).toBe(true);
    expect(byId.get(sentFollowupId)?.respondida).toBe(false);
    expect(rows.find((row) => row.id == null)?.respondida).toBe(false);
  });
});

describe("hasRecordedAssessment", () => {
  it("only counts follow-up records that have an outcome", () => {
    expect(hasRecordedAssessment({ id: null, vasDor: 2 })).toBe(false);
    expect(hasRecordedAssessment({ id: 1 })).toBe(false);
    expect(hasRecordedAssessment({ id: 1, complicacoes: [] })).toBe(false);
    expect(hasRecordedAssessment({ id: 1, vasDor: 0 })).toBe(true);
    expect(hasRecordedAssessment({ id: 1, falha: false })).toBe(true);
    expect(hasRecordedAssessment({ id: 1, retornoEsporte: false })).toBe(true);
  });
});

describe("GET /notifications/followup-overview", () => {
  it("counts a questionnaire as answered only when an outcome was recorded", async () => {
    const response = await fetch(`${baseUrl}/api/notifications/followup-overview`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      respondidos: Array<{ notifId: number }>;
      aguardando: Array<{ notifId: number }>;
      counts: { respondidos: number; aguardando: number };
    };
    expect(body.respondidos.map((row) => row.notifId)).toEqual([answeredNotifId]);
    expect(body.aguardando.map((row) => row.notifId)).toEqual([sentNotifId]);
    expect(body.counts.respondidos).toBe(1);
    expect(body.counts.aguardando).toBe(1);
  });
});

describe("classifyFollowupNotification", () => {
  const today = "2026-01-10";
  it("treats a sent questionnaire without outcome as awaiting, not answered", () => {
    expect(classifyFollowupNotification({ status: "sent", scheduledDate: "2026-01-01", followupId: 7 }, false, today)).toBe("aguardando");
    expect(classifyFollowupNotification({ status: "sent", scheduledDate: "2026-01-01", followupId: 7 }, true, today)).toBe("respondidos");
    expect(classifyFollowupNotification({ status: "sent", scheduledDate: "2026-01-01", followupId: null }, false, today)).toBe("aguardando");
    expect(classifyFollowupNotification({ status: "pending", scheduledDate: "2026-01-01", followupId: null }, false, today)).toBe("vencidos");
    expect(classifyFollowupNotification({ status: "pending", scheduledDate: "2026-02-01", followupId: null }, false, today)).toBe("agendados");
  });
});

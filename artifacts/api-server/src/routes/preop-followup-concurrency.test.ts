import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  doctorsTable,
  followupTable,
  patientsTable,
  scaleResponsesTable,
  scheduledNotificationsTable,
  surgeriesTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { PREOPERATIVE_PERIOD } from "../lib/followup-schedule";

let server: Server;
let baseUrl: string;
let doctorId: number;
let patientId: number;
let surgeryId: number;
let auth: string;

async function apiRequest(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function letFractureTransitionWin(request: () => Promise<Response>): Promise<Response> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [87001, surgeryId]);
    await client.query(
      "UPDATE surgeries SET tipos_procedimento = $1 WHERE id = $2",
      [["LCA", "Fraturas"], surgeryId],
    );

    const responsePromise = request();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.query("COMMIT");
    committed = true;
    return await responsePromise;
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
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
  const [doctor] = await db
    .insert(doctorsTable)
    .values({
      nome: "Preop Concurrency Doctor",
      email: `preop-concurrency-${suffix}@example.test`,
      senhaHash: await hashPassword("preop-concurrency-password"),
      isFree: true,
    })
    .returning();
  doctorId = doctor.id;

  const [patient] = await db
    .insert(patientsTable)
    .values({
      doctorId,
      nome: "Preop Concurrency Patient",
      telefone: "5511999999999",
      cpf: "12345678909",
    })
    .returning();
  patientId = patient.id;

  const [surgery] = await db
    .insert(surgeriesTable)
    .values({
      doctorId,
      patientId,
      tiposProcedimento: ["LCA"],
      status: "rascunho",
    })
    .returning();
  surgeryId = surgery.id;

  auth = signToken({
    doctorId,
    isAdmin: false,
    sessionVersion: doctor.sessionVersion,
  });
});

beforeEach(async () => {
  await db.delete(scheduledNotificationsTable).where(eq(scheduledNotificationsTable.surgeryId, surgeryId));
  await db.delete(followupTable).where(eq(followupTable.surgeryId, surgeryId));
  await db
    .update(surgeriesTable)
    .set({ tiposProcedimento: ["LCA"], status: "rascunho" })
    .where(eq(surgeriesTable.id, surgeryId));
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe.sequential("preoperative follow-up fracture concurrency", () => {
  it("returns 409 and creates no follow-up when Fraturas wins against manual creation", async () => {
    const response = await letFractureTransitionWin(() =>
      apiRequest("/api/followup", "POST", {
        surgeryId,
        tempo: PREOPERATIVE_PERIOD,
      }),
    );

    expect(response.status).toBe(409);
    const followups = await db
      .select({ id: followupTable.id })
      .from(followupTable)
      .where(eq(followupTable.surgeryId, surgeryId));
    expect(followups).toHaveLength(0);
  });

  it("returns 409, skips delivery, and creates no token when Fraturas wins against preparation", async () => {
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
      })
      .returning();

    const response = await letFractureTransitionWin(() =>
      apiRequest(
        `/api/surgeries/${surgeryId}/schedule/${notification.id}/prepare-whatsapp`,
        "POST",
      ),
    );

    expect(response.status).toBe(409);
    const followups = await db
      .select({ id: followupTable.id, token: followupTable.token })
      .from(followupTable)
      .where(eq(followupTable.surgeryId, surgeryId));
    expect(followups).toHaveLength(0);

    const [storedNotification] = await db
      .select({ status: scheduledNotificationsTable.status })
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id))
      .limit(1);
    expect(storedNotification === undefined || storedNotification.status === "skipped").toBe(true);
  });

  it("preserves the prepared follow-up and disables delivery when creation wins first", async () => {
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
      })
      .returning();

    const prepared = await apiRequest(
      `/api/surgeries/${surgeryId}/schedule/${notification.id}/prepare-whatsapp`,
      "POST",
    );
    expect(prepared.status).toBe(200);
    const preparedBody = await prepared.json() as { followupId: number; token: string };

    const transitioned = await apiRequest(`/api/surgeries/${surgeryId}`, "PATCH", {
      tiposProcedimento: ["LCA", "Fraturas"],
    });
    expect(transitioned.status).toBe(200);

    const [storedFollowup] = await db
      .select({ id: followupTable.id, token: followupTable.token })
      .from(followupTable)
      .where(eq(followupTable.id, preparedBody.followupId))
      .limit(1);
    expect(storedFollowup).toEqual({
      id: preparedBody.followupId,
      token: preparedBody.token,
    });

    const [storedNotification] = await db
      .select({
        status: scheduledNotificationsTable.status,
        followupId: scheduledNotificationsTable.followupId,
      })
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id))
      .limit(1);
    expect(storedNotification).toEqual({
      status: "skipped",
      followupId: preparedBody.followupId,
    });
  });

  it("cannot overwrite skipped with sent when Fraturas wins against a status update", async () => {
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
      })
      .returning();

    const response = await letFractureTransitionWin(() =>
      apiRequest(
        `/api/surgeries/${surgeryId}/schedule/${notification.id}/status`,
        "PATCH",
        { status: "sent" },
      ),
    );

    expect(response.status).toBe(409);
    const [stored] = await db
      .select({ status: scheduledNotificationsTable.status })
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id))
      .limit(1);
    expect(stored.status).toBe("skipped");
  });

  it("accepts no public scale response when Fraturas wins before submission", async () => {
    const token = randomUUID();
    const scale = "Teste Concorrência";
    const [followup] = await db
      .insert(followupTable)
      .values({
        surgeryId,
        tempo: PREOPERATIVE_PERIOD,
        token,
        escalasEnviadas: [scale],
      })
      .returning();

    const verification = await fetch(`${baseUrl}/api/patient/${token}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf: "12345678909" }),
    });
    expect(verification.status).toBe(200);
    const cookie = verification.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const response = await letFractureTransitionWin(() =>
      fetch(`${baseUrl}/api/patient/${token}/scale/${encodeURIComponent(scale)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie!,
          Origin: baseUrl,
          Referer: `${baseUrl}/patient/${token}`,
        },
        body: JSON.stringify({ respostas: { resposta: 1 }, score: 50 }),
      }),
    );

    expect(response.status).toBe(404);
    const responses = await db
      .select({ id: scaleResponsesTable.id })
      .from(scaleResponsesTable)
      .where(eq(scaleResponsesTable.followupId, followup.id));
    expect(responses).toHaveLength(0);
  });

  it("blocks individual notification dispatch when Fraturas wins first", async () => {
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
        scheduledDate: new Date().toISOString().slice(0, 10),
      })
      .returning();

    const response = await letFractureTransitionWin(() =>
      apiRequest(`/api/notifications/${notification.id}/dispatch`, "POST", {}),
    );

    expect(response.status).toBe(409);
    const [stored] = await db
      .select({ status: scheduledNotificationsTable.status, followupId: scheduledNotificationsTable.followupId })
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id))
      .limit(1);
    expect(stored).toEqual({ status: "skipped", followupId: null });
    const followups = await db
      .select({ id: followupTable.id })
      .from(followupTable)
      .where(eq(followupTable.surgeryId, surgeryId));
    expect(followups).toHaveLength(0);
  });

  it("skips batch notification dispatch when Fraturas wins first", async () => {
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
        scheduledDate: new Date().toISOString().slice(0, 10),
      })
      .returning();

    const response = await letFractureTransitionWin(() =>
      apiRequest("/api/notifications/dispatch-pending", "POST", { surgeryId }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    const [stored] = await db
      .select({ status: scheduledNotificationsTable.status, followupId: scheduledNotificationsTable.followupId })
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id))
      .limit(1);
    expect(stored).toEqual({ status: "skipped", followupId: null });
  });

  it("cannot reset or list a skipped pre-op notification when Fraturas wins first", async () => {
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
        status: "skipped",
        scheduledDate: new Date().toISOString().slice(0, 10),
      })
      .returning();

    const resetResponse = await letFractureTransitionWin(() =>
      apiRequest(`/api/notifications/${notification.id}/reset`, "POST", {}),
    );
    expect(resetResponse.status).toBe(409);

    const [stored] = await db
      .select({ status: scheduledNotificationsTable.status })
      .from(scheduledNotificationsTable)
      .where(eq(scheduledNotificationsTable.id, notification.id))
      .limit(1);
    expect(stored.status).toBe("skipped");

    const pendingResponse = await apiRequest("/api/notifications/pending", "GET");
    expect(pendingResponse.status).toBe(200);
    const pendingBody = await pendingResponse.json() as Record<string, Array<{ notif: { id: number } }>>;
    const visibleIds = Object.values(pendingBody).flat().map((row) => row.notif.id);
    expect(visibleIds).not.toContain(notification.id);
  });

  it("keeps preserved pre-op history hidden from secretary, reports, and LGPD reads", async () => {
    const token = randomUUID();
    const [followup] = await db
      .insert(followupTable)
      .values({
        surgeryId,
        tempo: PREOPERATIVE_PERIOD,
        token,
        escalasEnviadas: ["IKDC"],
      })
      .returning();
    const [notification] = await db
      .insert(scheduledNotificationsTable)
      .values({
        surgeryId,
        patientId,
        periodo: PREOPERATIVE_PERIOD,
        scales: ["IKDC"],
        status: "pending",
        followupId: followup.id,
        scheduledDate: new Date().toISOString().slice(0, 10),
      })
      .returning();

    const transition = await apiRequest(`/api/surgeries/${surgeryId}`, "PATCH", {
      tiposProcedimento: ["Lesão Ligamentar", "Fraturas"],
    });
    expect(transition.status).toBe(200);

    const secretaryResponse = await apiRequest("/api/secretary/followup-alerts", "GET");
    expect(secretaryResponse.status).toBe(200);
    const secretaryAlerts = await secretaryResponse.json() as Array<{ id: number }>;
    expect(secretaryAlerts.map((alert) => alert.id)).not.toContain(notification.id);

    const reportResponse = await apiRequest("/api/reports/followups", "GET");
    expect(reportResponse.status).toBe(200);
    const reportRows = await reportResponse.json() as Array<{ id: number | null }>;
    expect(reportRows.map((row) => row.id)).not.toContain(followup.id);

    const lgpdResponse = await apiRequest("/api/lgpd/dados", "GET");
    expect(lgpdResponse.status).toBe(200);
    const lgpdBody = await lgpdResponse.json() as {
      dados: { followups: Array<{ id: number }> };
    };
    expect(lgpdBody.dados.followups.map((row) => row.id)).not.toContain(followup.id);
  });
});
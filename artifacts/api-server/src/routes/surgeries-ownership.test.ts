import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  doctorsTable,
  followupTable,
  patientsTable,
  scheduledNotificationsTable,
  surgeriesTable,
  procedimentoMeniscalTable,
  cpmReconstructionTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { cleanSubtable } from "./surgeries";

let server: Server;
let baseUrl: string;
let doctorAId: number;
let doctorBId: number;
let patientAId: number;
let patientBId: number;
let surgeryAId: number;
let surgeryBId: number;
let followupAId: number;
let followupBId: number;
let notificationAId: number;
let authA: string;

async function apiRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authA}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  const senhaHash = await hashPassword("ownership-test-password");
  const [doctorA, doctorB] = await db
    .insert(doctorsTable)
    .values([
      {
        nome: "Ownership Doctor A",
        email: `ownership-a-${suffix}@example.test`,
        senhaHash,
        isFree: true,
      },
      {
        nome: "Ownership Doctor B",
        email: `ownership-b-${suffix}@example.test`,
        senhaHash,
        isFree: true,
      },
    ])
    .returning();
  doctorAId = doctorA.id;
  doctorBId = doctorB.id;

  const [patientA, patientB] = await db
    .insert(patientsTable)
    .values([
      {
        doctorId: doctorAId,
        nome: "Patient A",
        telefone: "5511999999999",
      },
      {
        doctorId: doctorBId,
        nome: "Patient B",
        telefone: "5511888888888",
      },
    ])
    .returning();
  patientAId = patientA.id;
  patientBId = patientB.id;

  const [surgeryA, surgeryB] = await db
    .insert(surgeriesTable)
    .values([
      { doctorId: doctorAId, patientId: patientAId },
      { doctorId: doctorBId, patientId: patientBId },
    ])
    .returning();
  surgeryAId = surgeryA.id;
  surgeryBId = surgeryB.id;

  const [followupA, followupB] = await db
    .insert(followupTable)
    .values([
      { surgeryId: surgeryAId, tempo: "6 semanas", token: randomUUID() },
      { surgeryId: surgeryBId, tempo: "6 semanas", token: randomUUID() },
    ])
    .returning();
  followupAId = followupA.id;
  followupBId = followupB.id;

  const [notificationA] = await db
    .insert(scheduledNotificationsTable)
    .values({
      surgeryId: surgeryAId,
      patientId: patientAId,
      periodo: "6 semanas",
    })
    .returning();
  notificationAId = notificationA.id;

  authA = signToken({
    doctorId: doctorAId,
    isAdmin: false,
    sessionVersion: doctorA.sessionVersion,
  });
});


afterAll(async () => {
  if (doctorAId && doctorBId) {
    await db
      .delete(doctorsTable)
      .where(and(
        eq(doctorsTable.isAdmin, false),
        eq(doctorsTable.id, doctorAId),
      ));
    await db
      .delete(doctorsTable)
      .where(and(
        eq(doctorsTable.isAdmin, false),
        eq(doctorsTable.id, doctorBId),
      ));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe.sequential("surgery and follow-up ownership", () => {
  it("accepts a null patellar exam in a surgery patch", async () => {
    const response = await apiRequest(`/api/surgeries/${surgeryAId}`, "PATCH", {
      examePatelar: null,
    });

    expect(response.status).toBe(200);
  });

  it("removes metadata and undefined values before subtable writes", () => {
    expect(cleanSubtable({
      id: 123,
      surgeryId: 456,
      createdAt: "2026-08-28T12:00:00.000Z",
      updatedAt: "2026-08-28T12:00:00.000Z",
      contexto: undefined,
      ladoMedial: false,
      observacoesExame: "",
      classificacao: null,
    })).toEqual({
      ladoMedial: false,
      observacoesExame: "",
      classificacao: null,
    });
  });

  it("rejects another doctor's patient in draft and final creation", async () => {
    const draft = await apiRequest("/api/surgeries/draft", "POST", {
      patientId: patientBId,
    });
    const final = await apiRequest("/api/surgeries", "POST", {
      patientId: patientBId,
    });

    expect(draft.status).toBe(404);
    expect(final.status).toBe(404);

    const crossLinked = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(and(
        eq(surgeriesTable.doctorId, doctorAId),
        eq(surgeriesTable.patientId, patientBId),
      ));
    expect(crossLinked).toHaveLength(0);
  });

  it("updates an owned follow-up but not one from another surgery", async () => {
    const own = await apiRequest(
      `/api/surgeries/${surgeryAId}/followups/${followupAId}`,
      "PATCH",
      { observacoes: "owned update" },
    );
    const foreign = await apiRequest(
      `/api/surgeries/${surgeryAId}/followups/${followupBId}`,
      "PATCH",
      { observacoes: "cross-tenant update" },
    );

    expect(own.status).toBe(200);
    expect(foreign.status).toBe(404);

    const [unchanged] = await db
      .select({ observacoes: followupTable.observacoes })
      .from(followupTable)
      .where(eq(followupTable.id, followupBId))
      .limit(1);
    expect(unchanged.observacoes).toBeNull();
  });

  it("rejects a WhatsApp follow-up ID from another surgery before sending", async () => {
    const response = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/${notificationAId}/whatsapp`,
      "POST",
      {
        followupId: followupBId,
        customMessage: "ownership test",
      },
    );

    expect(response.status).toBe(404);
  });

  it("localizes malformed IDs and scheduling/WhatsApp errors for Spanish doctors", async () => {
    await db
      .update(doctorsTable)
      .set({ idioma: "es" })
      .where(eq(doctorsTable.id, doctorAId));

    const malformedId = await apiRequest("/api/surgeries/no-es-un-id", "GET");
    const missingSurgery = await apiRequest("/api/surgeries/999999999/schedule", "GET");
    const missingAppointment = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/999999999/prepare-whatsapp`,
      "POST",
    );
    const invalidFollowup = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/${notificationAId}/whatsapp`,
      "POST",
      { followupId: 0 },
    );
    const invalidStatus = await apiRequest(
      `/api/surgeries/${surgeryAId}/schedule/${notificationAId}/status`,
      "PATCH",
      { status: "invalid" },
    );

    expect(await malformedId.json()).toEqual({ error: "ID no válido" });
    expect(await missingSurgery.json()).toEqual({ error: "Cirugía no encontrada" });
    expect(await missingAppointment.json()).toEqual({ error: "Programación no encontrada" });
    expect(await invalidFollowup.json()).toEqual({ error: "followupId no válido" });
    expect(await invalidStatus.json()).toEqual({ error: "Estado no válido" });
  });

  it("returns a stable Spanish error for malformed authenticated surgery requests", async () => {
    await db
      .update(doctorsTable)
      .set({ idioma: "es" })
      .where(eq(doctorsTable.id, doctorAId));

    const responses = await Promise.all([
      apiRequest("/api/surgeries/draft", "POST", { patientId: "invalid" }),
      apiRequest(`/api/surgeries/${surgeryAId}/finalize`, "POST", { patientId: "invalid" }),
      apiRequest("/api/surgeries", "POST", { patientId: "invalid" }),
      apiRequest(`/api/surgeries/${surgeryAId}`, "PATCH", { tiposProcedimento: "invalid" }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Datos no válidos" });
    }
  });

  it("saves a draft when a subtable contains only metadata or unknown fields", async () => {
    const [meniscal] = await db
      .insert(procedimentoMeniscalTable)
      .values({
        surgeryId: surgeryAId,
        contexto: "preservar ao recarregar rascunho",
      })
      .returning();

    const response = await apiRequest("/api/surgeries/draft", "POST", {
      id: surgeryAId,
      patientId: patientAId,
      procedimentoMeniscal: {
        id: meniscal.id,
        surgeryId: surgeryAId,
        createdAt: meniscal.createdAt.toISOString(),
        unsupportedFutureField: true,
      },
    });

    expect(response.status).toBe(200);

    const [unchanged] = await db
      .select({ contexto: procedimentoMeniscalTable.contexto })
      .from(procedimentoMeniscalTable)
      .where(eq(procedimentoMeniscalTable.surgeryId, surgeryAId))
      .limit(1);
    expect(unchanged.contexto).toBe("preservar ao recarregar rascunho");
  });

  it("rejects malformed side-specific meniscal details", async () => {
    const response = await apiRequest("/api/surgeries/draft", "POST", {
      id: surgeryAId,
      patientId: patientAId,
      procedimentoMeniscal: {
        ladoMedial: true,
        detalhesMedial: {
          sutura: "sim",
          campoDesconhecido: true,
        },
      },
    });

    expect(response.status).toBe(400);
  });

});
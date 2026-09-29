import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
  regenCasesTable,
  regenFollowupNotificationsTable,
  regenScaleResponsesTable,
  secretariesTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signSecretaryToken, signToken } from "../lib/auth";

/**
 * DocRegen additions on the shared API:
 *   - GET /pre-consults/summary (doctor-scoped aggregate for the dashboard);
 *   - GET /secretary/regen-cases (read-only, scoped to the secretary's doctor);
 *   - GET /secretary/followup-alerts?type=regen (default stays surgical).
 */

let server: Server;
let baseUrl: string;
let doctorA: number;
let doctorB: number;
let doctorAuthA: string;
let secretaryAuthA: string;
let secretaryAuthB: string;
let patientRegenA: number;
let caseA: string;
let caseB: string;
const notifA: Record<"overdue" | "sent" | "answered" | "completed" | "future", string> = {
  overdue: "", sent: "", answered: "", completed: "", future: "",
};
let notifB: string;

function call(auth: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
  });
}

async function addPreConsult(
  doctorId: number,
  patientId: number,
  state: { questionnaire: "draft" | "submitted"; submittedAt?: Date; invite?: "active" | "revoked" | "expired"; expiresAt?: Date },
): Promise<void> {
  const [questionnaire] = await db.insert(preConsultQuestionnairesTable).values({
    patientId,
    doctorId,
    status: state.questionnaire,
    submittedAt: state.submittedAt ?? null,
  }).returning();
  if (!state.invite) return;
  const expiresAt = state.expiresAt
    ?? (state.invite === "expired" ? new Date(Date.now() - 60_000) : new Date(Date.now() + 86_400_000));
  await db.insert(preConsultInvitesTable).values({
    questionnaireId: questionnaire.id,
    patientId,
    doctorId,
    tokenHash: `test-${randomUUID()}`,
    status: state.invite === "revoked" ? "revoked" : "active",
    expiresAt,
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const suffix = randomUUID();
  const [a, b] = await db.insert(doctorsTable).values([
    { nome: "DocRegen Secretary Doctor A", email: `docregen-sec-a-${suffix}@example.test`, senhaHash: "unused", isFree: true },
    { nome: "DocRegen Secretary Doctor B", email: `docregen-sec-b-${suffix}@example.test`, senhaHash: "unused", isFree: true },
  ]).returning();
  doctorA = a.id;
  doctorB = b.id;
  doctorAuthA = signToken({ doctorId: doctorA, isAdmin: false, sessionVersion: a.sessionVersion });

  const [secA, secB] = await db.insert(secretariesTable).values([
    { doctorId: doctorA, nome: "Secretary A", email: `docregen-sec-a-${suffix}@secretary.test`, senhaHash: "unused" },
    { doctorId: doctorB, nome: "Secretary B", email: `docregen-sec-b-${suffix}@secretary.test`, senhaHash: "unused" },
  ]).returning();
  secretaryAuthA = signSecretaryToken({ doctorId: doctorA, secretaryId: secA.id, sessionVersion: secA.sessionVersion });
  secretaryAuthB = signSecretaryToken({ doctorId: doctorB, secretaryId: secB.id, sessionVersion: secB.sessionVersion });

  // ── Pre-consultation fixtures (doctor A: 1 answered, 8 awaiting, 2 ignored; doctor B: 1 awaiting)
  const patientsA = await db.insert(patientsTable).values(
    Array.from({ length: 12 }, (_, i) => ({ doctorId: doctorA, nome: `DOCREGEN SEC PATIENT A${i}`, telefone: "11988887777" })),
  ).returning();
  const [patientB] = await db.insert(patientsTable).values({ doctorId: doctorB, nome: "DOCREGEN SEC PATIENT B" }).returning();

  await addPreConsult(doctorA, patientsA[0]!.id, {
    questionnaire: "submitted", submittedAt: new Date("2026-01-02T10:00:00Z"), invite: "active",
  });
  for (let i = 1; i <= 8; i += 1) {
    await addPreConsult(doctorA, patientsA[i]!.id, {
      questionnaire: "draft", invite: "active", expiresAt: new Date(Date.now() + i * 86_400_000),
    });
  }
  await addPreConsult(doctorA, patientsA[9]!.id, { questionnaire: "draft", invite: "expired" });
  await addPreConsult(doctorA, patientsA[10]!.id, { questionnaire: "draft", invite: "revoked" });
  await addPreConsult(doctorB, patientB.id, { questionnaire: "draft", invite: "active" });

  // ── Regenerative fixtures
  patientRegenA = patientsA[11]!.id;
  const [regenA] = await db.insert(regenCasesTable).values({
    doctorId: doctorA,
    patientId: patientRegenA,
    patientName: "DOCREGEN SEC PATIENT A11",
    conditionCode: "knee_oa",
    status: "active",
    anamneseRegen: { queixa: "clinical secret" },
  }).returning();
  caseA = regenA.id;
  const [regenB] = await db.insert(regenCasesTable).values({
    doctorId: doctorB,
    patientId: patientB.id,
    patientName: "DOCREGEN SEC PATIENT B",
    conditionCode: "hip_oa",
  }).returning();
  caseB = regenB.id;

  const notifsA = await db.insert(regenFollowupNotificationsTable).values([
    { caseId: caseA, periodo: "1 mês", daysAfterProcedure: 30, scheduledDate: "2020-01-01", scales: ["VAS Dor"] },
    { caseId: caseA, periodo: "3 meses", daysAfterProcedure: 90, scheduledDate: "2020-03-01", scales: ["VAS Dor"], status: "sent" },
    { caseId: caseA, periodo: "6 meses ★", daysAfterProcedure: 180, scheduledDate: "2020-06-01", scales: ["VAS Dor"] },
    { caseId: caseA, periodo: "12 meses", daysAfterProcedure: 365, scheduledDate: "2020-12-01", scales: ["VAS Dor"], status: "completed" },
    { caseId: caseA, periodo: "24 meses", daysAfterProcedure: 730, scheduledDate: "2099-01-01", scales: ["VAS Dor"] },
  ]).returning();
  notifA.overdue = notifsA[0]!.id;
  notifA.sent = notifsA[1]!.id;
  notifA.answered = notifsA[2]!.id;
  notifA.completed = notifsA[3]!.id;
  notifA.future = notifsA[4]!.id;
  await db.insert(regenScaleResponsesTable).values({
    notificationId: notifA.answered, nomeEscala: "VAS Dor", respostas: { vas: 3 }, score: "3",
  });

  const [nB] = await db.insert(regenFollowupNotificationsTable).values({
    caseId: caseB, periodo: "1 mês", daysAfterProcedure: 30, scheduledDate: "2020-01-01", scales: ["VAS Dor"],
  }).returning();
  notifB = nB.id;
});

afterAll(async () => {
  const cases = [caseA, caseB].filter(Boolean);
  if (cases.length) await db.delete(regenCasesTable).where(inArray(regenCasesTable.id, cases));
  const doctors = [doctorA, doctorB].filter(Boolean);
  if (doctors.length) await db.delete(doctorsTable).where(inArray(doctorsTable.id, doctors));
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe("GET /pre-consults/summary", () => {
  type Summary = {
    counts: { awaiting: number; answered: number };
    awaiting: Array<{ patientId: number; patientNome: string; date: string | null }>;
    answered: Array<{ patientId: number; patientNome: string; date: string | null }>;
  };

  it("returns exact per-doctor counts with a short recent list", async () => {
    const response = await call(doctorAuthA, "/api/pre-consults/summary");
    expect(response.status).toBe(200);
    const body = await response.json() as Summary;
    expect(body.counts).toEqual({ awaiting: 8, answered: 1 });
    expect(body.awaiting).toHaveLength(5);
    // Soonest expiry first.
    expect(body.awaiting.map((row) => row.patientNome)).toEqual([
      "DOCREGEN SEC PATIENT A1",
      "DOCREGEN SEC PATIENT A2",
      "DOCREGEN SEC PATIENT A3",
      "DOCREGEN SEC PATIENT A4",
      "DOCREGEN SEC PATIENT A5",
    ]);
    expect(body.answered).toEqual([
      { patientId: expect.any(Number), patientNome: "DOCREGEN SEC PATIENT A0", date: "2026-01-02T10:00:00.000Z" },
    ]);
    const names = JSON.stringify(body);
    expect(names).not.toContain("PATIENT B");
    expect(names).not.toContain("PATIENT A9");
    expect(names).not.toContain("PATIENT A10");
  });

  it("is doctor-only", async () => {
    expect((await fetch(`${baseUrl}/api/pre-consults/summary`)).status).toBe(401);
    expect((await call(secretaryAuthA, "/api/pre-consults/summary")).status).toBe(401);
  });
});

describe("GET /secretary/regen-cases", () => {
  type CaseSummary = {
    id: string; patientId: number | null; patientNome: string | null; conditionCode: string;
    status: string | null; procedureCount: number; nextFollowupDate: string | null;
    nextSessionDate: string | null; nextSessionTime: string | null;
  };

  it("lists only the cases of the secretary's own doctor, without clinical content", async () => {
    const response = await call(secretaryAuthA, "/api/secretary/regen-cases");
    expect(response.status).toBe(200);
    const body = await response.json() as CaseSummary[];
    expect(body.map((row) => row.id)).toEqual([caseA]);
    expect(body[0]).toMatchObject({
      patientId: patientRegenA,
      patientNome: "DOCREGEN SEC PATIENT A11",
      conditionCode: "knee_oa",
      status: "active",
      procedureCount: 0,
      nextFollowupDate: "2020-01-01",
      nextSessionDate: null,
    });
    expect(JSON.stringify(body)).not.toContain("clinical secret");
    expect(body[0]).not.toHaveProperty("anamneseRegen");

    const other = await call(secretaryAuthB, "/api/secretary/regen-cases");
    expect(other.status).toBe(200);
    expect((await other.json() as CaseSummary[]).map((row) => row.id)).toEqual([caseB]);
  });

  it("lets the secretary schedule a regenerative session for her doctor's patient only", async () => {
    const created = await call(secretaryAuthA, "/api/appointments", {
      method: "POST",
      body: JSON.stringify({ patientId: patientRegenA, data: "2099-05-10", hora: "08:30", tipo: "procedimento regenerativo" }),
    });
    expect(created.status).toBe(201);

    const body = await (await call(secretaryAuthA, "/api/secretary/regen-cases")).json() as CaseSummary[];
    expect(body[0]).toMatchObject({ nextSessionDate: "2099-05-10", nextSessionTime: "08:30" });

    const crossDoctor = await call(secretaryAuthB, "/api/appointments", {
      method: "POST",
      body: JSON.stringify({ patientId: patientRegenA, data: "2099-05-11", hora: "08:30", tipo: "procedimento regenerativo" }),
    });
    expect(crossDoctor.status).toBe(404);
  });

  it("keeps clinical regenerative endpoints closed to secretaries", async () => {
    expect((await call(secretaryAuthA, "/api/regen/cases")).status).toBe(401);
    expect((await call(secretaryAuthA, `/api/regen/cases/${caseA}`)).status).toBe(401);
    expect((await call(secretaryAuthA, `/api/regen/cases/${caseA}/proms`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/secretary/regen-cases`)).status).toBe(401);
  });
});

describe("GET /secretary/followup-alerts", () => {
  type RegenAlert = { id: string; caseId: string; patientId: number | null; periodo: string; kind: string; status: string };

  it("returns pending regenerative follow-ups for type=regen, scoped to the doctor", async () => {
    const response = await call(secretaryAuthA, "/api/secretary/followup-alerts?type=regen");
    expect(response.status).toBe(200);
    const body = await response.json() as RegenAlert[];
    expect(body.map((row) => row.id)).toEqual([notifA.overdue, notifA.sent, notifA.future]);
    expect(body.map((row) => row.kind)).toEqual(["overdue", "awaiting", "scheduled"]);
    expect(body.every((row) => row.caseId === caseA && row.patientId === patientRegenA)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(notifB);
    expect(body[0]).not.toHaveProperty("scales");
    expect(body[0]).not.toHaveProperty("token");

    const other = await (await call(secretaryAuthB, "/api/secretary/followup-alerts?type=regen")).json() as RegenAlert[];
    expect(other.map((row) => row.id)).toEqual([notifB]);
  });

  it("keeps the surgical default when no type is given", async () => {
    for (const path of ["/api/secretary/followup-alerts", "/api/secretary/followup-alerts?type=surgical"]) {
      const response = await call(secretaryAuthA, path);
      expect(response.status).toBe(200);
      const body = await response.json() as Array<{ id: unknown }>;
      expect(Array.isArray(body)).toBe(true);
      expect(JSON.stringify(body)).not.toContain(notifA.overdue);
    }
  });

  it("rejects unknown alert types", async () => {
    expect((await call(secretaryAuthA, "/api/secretary/followup-alerts?type=other")).status).toBe(400);
    expect((await call(secretaryAuthA, "/api/secretary/followup-alerts?type=regen&type=regen")).status).toBe(400);
  });
});

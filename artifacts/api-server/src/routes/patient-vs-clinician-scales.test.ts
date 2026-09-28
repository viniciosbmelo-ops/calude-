/**
 * Link do paciente x dados do médico no mesmo follow-up:
 *  - o Constant do médico (scale_responses) não conta como escala concluída pelo paciente;
 *  - o VAS do paciente não sobrescreve followup.vasDor já registrado pelo médico
 *    (mas preenche quando vazio);
 *  - o cartão do follow-up recebe as respostas do paciente (escalasPaciente);
 *  - o KPI de follow-up do painel usa a definição de "respondido" compartilhada.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, doctorsTable, followupTable, patientsTable, scaleResponsesTable, surgeriesTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { completedPatientScales } from "./patient";
import { summarizeFollowupCompliance } from "./reports";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

function randomCpf(): string {
  return Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");
}

async function createFollowup(opts: { vasDor?: number | null; clinicianConstant?: boolean }) {
  const cpf = randomCpf();
  const [patient] = await db.insert(patientsTable).values({ doctorId, nome: "Paciente link", cpf }).returning();
  const [surgery] = await db.insert(surgeriesTable).values({
    doctorId,
    patientId: patient.id,
    regiao: "shoulder",
    tiposProcedimento: ["SH_CUFF"],
    status: "completo",
  }).returning();
  const token = randomUUID();
  const [followup] = await db.insert(followupTable).values({
    surgeryId: surgery.id,
    tempo: "6 meses",
    token,
    vasDor: opts.vasDor ?? null,
    escalasEnviadas: ["VAS Dor", "SANE"],
  }).returning();
  if (opts.clinicianConstant) {
    await db.insert(scaleResponsesTable).values({
      followupId: followup.id,
      nomeEscala: "CONSTANT",
      respostas: JSON.stringify({ pain: 10 }),
      score: 48,
    });
  }
  return { cpf, token, surgeryId: surgery.id, followupId: followup.id };
}

async function verify(token: string, cpf: string) {
  const res = await fetch(`${baseUrl}/api/patient/${token}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cpf }),
  });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { body: await json(res), cookie };
}

async function submit(token: string, cookie: string, escala: string, respostas: Record<string, number>) {
  const res = await fetch(`${baseUrl}/api/patient/${token}/scale/${encodeURIComponent(escala)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
    body: JSON.stringify({ respostas }),
  });
  expect(res.status).toBe(200);
  return json(res);
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Patient vs Clinician",
    email: `patient-vs-clinician-${randomUUID()}@example.test`,
    senhaHash: await hashPassword("patient-vs-clinician-password"),
    isFree: true,
  }).returning();
  doctorId = doctor.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion });
});

afterAll(async () => {
  if (doctorId) {
    await db.delete(surgeriesTable).where(eq(surgeriesTable.doctorId, doctorId));
    await db.delete(patientsTable).where(eq(patientsTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(and(eq(doctorsTable.isAdmin, false), eq(doctorsTable.id, doctorId)));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("completedPatientScales", () => {
  it("keeps only answered scales that were sent to the patient", () => {
    expect(completedPatientScales(["VAS Dor", "SANE"], ["CONSTANT", "VAS Dor"])).toEqual(["VAS Dor"]);
    expect(completedPatientScales(["VAS Dor", "SANE"], ["CONSTANT", "ROWE"])).toEqual([]);
    expect(completedPatientScales([], ["CONSTANT"])).toEqual([]);
  });
});

describe.sequential("patient link with clinician data on the same follow-up", () => {
  it("does not count the clinician's Constant as a completed patient scale", async () => {
    const f = await createFollowup({ clinicianConstant: true });

    const { body, cookie } = await verify(f.token, f.cpf);
    expect(body.escalasEnviadas).toEqual(["VAS Dor", "SANE"]);
    expect(body.completedScales).toEqual([]);

    await expect(submit(f.token, cookie, "VAS Dor", { vas: 3 })).resolves.toEqual({ ok: true, allCompleted: false });
    const again = await verify(f.token, f.cpf);
    expect(again.body.completedScales).toEqual(["VAS Dor"]);

    await expect(submit(f.token, again.cookie, "SANE", { sane: 70 })).resolves.toEqual({ ok: true, allCompleted: true });
    const done = await verify(f.token, f.cpf);
    expect(done.body.completedScales).toEqual(["VAS Dor", "SANE"]);
  });

  it("keeps the clinician's vasDor when the patient answers VAS, and exposes both on the card", async () => {
    const f = await createFollowup({ vasDor: 2 });
    const { cookie } = await verify(f.token, f.cpf);
    await submit(f.token, cookie, "VAS Dor", { vas: 3 });
    await submit(f.token, cookie, "SANE", { sane: 80 });

    const [row] = await db.select().from(followupTable).where(eq(followupTable.id, f.followupId));
    expect(row.vasDor).toBe(2);
    const responses = await db.select().from(scaleResponsesTable).where(eq(scaleResponsesTable.followupId, f.followupId));
    expect(responses.find((r) => r.nomeEscala === "VAS Dor")?.score).toBe(3);

    const detail = await fetch(`${baseUrl}/api/surgeries/${f.surgeryId}`, { headers: { Authorization: `Bearer ${auth}` } });
    expect(detail.status).toBe(200);
    const surgery = await json(detail);
    const card = surgery.followups.find((x: { id: number }) => x.id === f.followupId);
    expect(card.vasDor).toBe(2);
    expect(card.escalasClinicas).toEqual([]);
    expect(card.escalasPaciente).toEqual([
      expect.objectContaining({ escala: "VAS Dor", score: 3 }),
      expect.objectContaining({ escala: "SANE", score: 80 }),
    ]);

    const list = await fetch(`${baseUrl}/api/followup/${f.surgeryId}`, { headers: { Authorization: `Bearer ${auth}` } });
    expect(list.status).toBe(200);
    const [listed] = await json(list);
    expect(listed.escalasPaciente.map((s: { escala: string }) => s.escala)).toEqual(["VAS Dor", "SANE"]);
  });

  it("fills an empty vasDor from the patient's VAS (reports keep working)", async () => {
    const f = await createFollowup({ vasDor: null });
    const { cookie } = await verify(f.token, f.cpf);
    await submit(f.token, cookie, "VAS Dor", { vas: 4 });
    const [row] = await db.select().from(followupTable).where(eq(followupTable.id, f.followupId));
    expect(row.vasDor).toBe(4);
  });
});

describe("dashboard follow-up KPI", () => {
  it("summarizes answered follow-ups with the shared definition", () => {
    const summary = summarizeFollowupCompliance(4, [
      { id: 1, surgeryId: 10 },                          // link sent, no answer
      { id: 2, surgeryId: 11, hasScaleResponses: true }, // SANE only
      { id: 3, surgeryId: 11, vasDor: 2 },
      { id: 4, surgeryId: 12, falha: false },
    ]);
    expect(summary).toEqual({ followupCompliance: 50, surgeriesWithAnsweredFollowup: 2, answeredFollowups: 3 });
    expect(summarizeFollowupCompliance(0, []).followupCompliance).toBe(0);
  });

  it("GET /reports/dashboard: percentage and count describe the same answered surgeries", async () => {
    const res = await fetch(`${baseUrl}/api/reports/dashboard`, { headers: { Authorization: `Bearer ${auth}` } });
    expect(res.status).toBe(200);
    const body = await json(res);
    // 3 surgeries above, all answered (VAS/SANE via link).
    expect(body.totalSurgeries).toBe(3);
    expect(body.surgeriesWithAnsweredFollowup).toBe(3);
    expect(body.answeredFollowups).toBe(3);
    expect(body.followupCompliance).toBeCloseTo((body.surgeriesWithAnsweredFollowup / body.totalSurgeries) * 100);

    // A new surgery whose link was sent but not answered does not raise the percentage.
    await createFollowup({});
    const after = await json(await fetch(`${baseUrl}/api/reports/dashboard`, { headers: { Authorization: `Bearer ${auth}` } }));
    expect(after.totalSurgeries).toBe(4);
    expect(after.surgeriesWithAnsweredFollowup).toBe(3);
    expect(after.followupCompliance).toBe(75);
  });
});

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  pool,
  regenCasesTable,
  regenTermsAcceptanceTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";
import { initRegenData } from "./regen";

/**
 * Region-specific SANE (ombro, joelho, quadril, cotovelo, tornozelo/pé,
 * punho/mão, coluna): one SANE per case by the condition's region, manual
 * entry under either spelling, patient link scoring and research columns.
 */

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
const createdCases: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();

function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/regen-api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createCase(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await call("/regen/cases", {
    method: "POST",
    body: JSON.stringify({ patientName: "Paciente Fictício Região", ...body }),
  });
  const json = await j(res);
  expect(res.status, JSON.stringify(json)).toBe(201);
  createdCases.push(json.id);
  return json;
}

const initNotifications = async (caseId: string) =>
  j(await call(`/regen/cases/${caseId}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }) }));

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Doctor Region SANE",
    email: `docregen-region-sane-${randomUUID()}@example.test`,
    senhaHash: "unused",
    isFree: true,
    aprovado: true,
  }).returning();
  doctorId = doctor.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: doctor.sessionVersion });
  await db.insert(regenTermsAcceptanceTable).values({
    doctorId, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1",
  });
});

afterAll(async () => {
  if (createdCases.length) await db.delete(regenCasesTable).where(inArray(regenCasesTable.id, createdCases));
  if (doctorId) {
    await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
    await db.delete(patientsTable).where(eq(patientsTable.doctorId, doctorId));
    await db.delete(regenTermsAcceptanceTable).where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("follow-up links ask VAS + the case region's SANE", () => {
  it("schedules one region SANE per case; region-less conditions ask VAS only", async () => {
    const expected: Array<[string, string[]]> = [
      ["OA_OMBRO", ["VAS Dor", "SANE Ombro"]],
      ["OA_QUADRIL", ["VAS Dor", "SANE Quadril"]],
      ["EPICONDILITE", ["VAS Dor", "SANE Cotovelo"]],
      ["FASCITE_PLANTAR", ["VAS Dor", "SANE Tornozelo e Pé"]],
      ["SINDROME_TUNEL_CARPO", ["VAS Dor", "SANE Punho e Mão"]],
      ["HERNIA_DISCAL_LOMBAR", ["VAS Dor", "SANE Coluna"]],
      ["OA_JOELHO_KL1", ["VAS Dor", "SANE Joelho"]],
      ["TENDINOPATIA", ["VAS Dor"]],
    ];
    for (const [conditionCode, scales] of expected) {
      const created = await createCase({ conditionCode, plannedProducts: ["PRP"] });
      const rows = await initNotifications(created.id);
      expect(rows.length, conditionCode).toBeGreaterThan(0);
      for (const row of rows) expect(row.scales, conditionCode).toEqual(scales);
    }
  });
});

describe("clinician manual entry of region SANEs", () => {
  it("stores both spellings under the manual code and requires an integer 0–100", async () => {
    const created = await createCase({ conditionCode: "OA_OMBRO" });
    const path = `/regen/cases/${created.id}/proms`;
    const post = (instrument: string, score: unknown) =>
      call(path, { method: "POST", body: JSON.stringify({ instrument, timepoint: "1 mês", score }) });
    const cases: Array<[string, string]> = [
      ["SANE Ombro", "SANE_OMBRO"], ["SANE_OMBRO", "SANE_OMBRO"],
      ["SANE Quadril", "SANE_QUADRIL"], ["SANE Cotovelo", "SANE_COTOVELO"],
      ["SANE Tornozelo e Pé", "SANE_TORNOZELO_PE"], ["SANE Punho e Mão", "SANE_PUNHO_MAO"],
      ["SANE Coluna", "SANE_COLUNA"], ["SANE_COLUNA", "SANE_COLUNA"],
    ];
    for (const [instrument, stored] of cases) {
      const res = await post(instrument, 65);
      expect(res.status, instrument).toBe(201);
      expect((await j(res)).instrument, instrument).toBe(stored);
    }
    for (const score of [101, -1, 62.5, null, undefined]) {
      expect((await post("SANE_OMBRO", score)).status, String(score)).toBe(400);
      expect((await post("SANE Coluna", score)).status, String(score)).toBe(400);
    }
    for (const instrument of ["SANE Hombro", "SANE_OMBRO_D", "sane ombro", "SANE Tornozelo", "ASES", "DASH"]) {
      expect((await post(instrument, 50)).status, instrument).toBe(400);
    }
  });
});

describe("patient link scores the region SANE server-side", () => {
  it("accepts an integer 0–100 for the spine SANE and rejects other region names", async () => {
    const [patient] = await db.insert(patientsTable).values({
      doctorId, nome: "Paciente Fictício Coluna", cpf: "529.982.247-25",
    }).returning();
    const created = await createCase({ conditionCode: "OA_COLUNA_LOMBAR", patientId: patient.id });
    const token = randomUUID();
    await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '3 meses', 90, $2, $3)`,
      [created.id, ["VAS Dor", "SANE Coluna"], token],
    );
    const publicView = await j(await fetch(`${baseUrl}/regen-api/patient/regen/${token}`));
    expect(publicView).toMatchObject({ scales: ["VAS Dor", "SANE Coluna"] });
    const verify = await fetch(`${baseUrl}/regen-api/patient/regen/${token}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf: "52998224725" }),
    });
    expect(verify.status).toBe(200);
    const cookie = (verify.headers.getSetCookie?.() ?? [verify.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
    const submit = (escala: string, respostas: Record<string, unknown>) =>
      fetch(`${baseUrl}/regen-api/patient/regen/${token}/scale/${encodeURIComponent(escala)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
        body: JSON.stringify({ respostas }),
      });
    // Not in this link's scale list (another region) → rejected.
    expect((await submit("SANE Ombro", { sane: 50 })).status).toBe(400);
    expect((await submit("SANE Coluna", { sane: 101 })).status).toBe(400);
    expect((await submit("SANE Coluna", { sane: 40.5 })).status).toBe(400);
    expect((await submit("SANE Coluna", { outro: 40 })).status).toBe(400);
    expect((await submit("SANE Coluna", { sane: 45 })).status).toBe(200);
    const { rows } = await pool.query(
      `SELECT r.nome_escala, r.score FROM regen_scale_responses r JOIN regen_followup_notifications n ON n.id = r.notification_id
        WHERE n.token = $1`,
      [token],
    );
    expect(rows.map((r) => [r.nome_escala, Number(r.score)])).toEqual([["SANE Coluna", 45]]);
  });
});

describe("research export has baseline/last/change per region SANE", () => {
  it("merges manual and patient-link answers of the case's region", async () => {
    const created = await createCase({ conditionCode: "TENDINOPATIA_OMBRO" });
    const at = (d: string) => `${d}T15:00:00.000Z`;
    await call(`/regen/cases/${created.id}/proms`, { method: "POST", body: JSON.stringify({ instrument: "SANE_OMBRO", timepoint: "Pré-operatório / Basal", score: 35, answeredAt: at("2026-01-10") }) });
    const { rows: [notif] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '3 meses', 90, $2, $3) RETURNING id`,
      [created.id, ["VAS Dor", "SANE Ombro"], randomUUID()],
    );
    await pool.query(
      `INSERT INTO regen_scale_responses (notification_id, nome_escala, respostas, score, completado_em)
       VALUES ($1, 'SANE Ombro', '{"sane":80}', 80, $2)`,
      [notif.id, at("2026-04-10")],
    );

    // Pseudonymized export: the case is the TENDINOPATIA_OMBRO row with these answers.
    const { rows } = await j(await call(`/regen/research?condition=TENDINOPATIA_OMBRO`));
    const row = rows.find((r: Record<string, unknown>) => r.sane_ombro_last === 80);
    expect(row).toMatchObject({
      sane_ombro_baseline: 35, sane_ombro_last: 80, sane_ombro_change: 45,
      sane_joelho_baseline: null, sane_coluna_change: null,
    });

    const csv = await (await call(`/regen/research?condition=TENDINOPATIA_OMBRO&format=csv`)).text();
    const [header, ...lines] = csv.replace(/^\uFEFF/, "").split("\r\n");
    const cols = header!.split(",");
    for (const key of ["sane_ombro", "sane_joelho", "sane_quadril", "sane_cotovelo", "sane_tornozelo_pe", "sane_punho_mao", "sane_coluna"]) {
      expect(cols).toEqual(expect.arrayContaining([`${key}_baseline`, `${key}_last`, `${key}_change`]));
    }
    expect(csv).not.toContain(created.id);
    const line = lines.map((l) => l.split(",")).find((l) => l[cols.indexOf("sane_ombro_last")] === "80")!;
    expect(line[cols.indexOf("sane_ombro_change")]).toBe("45");
  });
});

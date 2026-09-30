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
 * Knee outcome measures without licensed questionnaires: SANE-joelho (manual
 * entry and patient follow-up link) and the clinician-measured OARSI
 * performance tests + knee ROM; research export columns.
 */

let server: Server;
let baseUrl: string;
let doctorId: number;
let otherDoctorId: number;
let auth: string;
let otherAuth: string;
const createdCases: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();

function call(path: string, init?: RequestInit, token = auth): Promise<Response> {
  return fetch(`${baseUrl}/regen-api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
}

async function createCase(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await call("/regen/cases", {
    method: "POST",
    body: JSON.stringify({ patientName: "Paciente Fictício Joelho", ...body }),
  });
  const json = await j(res);
  expect(res.status, JSON.stringify(json)).toBe(201);
  createdCases.push(json.id);
  return json;
}

function postTest(caseId: string, body: Record<string, unknown>, token = auth) {
  return call(`/regen/cases/${caseId}/performance-tests`, {
    method: "POST",
    body: JSON.stringify({ timepoint: "Pré-operatório / Basal", ...body }),
  }, token);
}

async function newDoctor(label: string) {
  const [doctor] = await db.insert(doctorsTable).values({
    nome: `Doctor ${label}`,
    email: `docregen-knee-${label}-${randomUUID()}@example.test`,
    senhaHash: "unused",
    isFree: true,
    aprovado: true,
  }).returning();
  await db.insert(regenTermsAcceptanceTable).values({
    doctorId: doctor.id, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1",
  });
  return { id: doctor.id, token: signToken({ doctorId: doctor.id, isAdmin: false, sessionVersion: doctor.sessionVersion }) };
}

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ id: doctorId, token: auth } = await newDoctor("main"));
  ({ id: otherDoctorId, token: otherAuth } = await newDoctor("other"));
});

afterAll(async () => {
  if (createdCases.length) await db.delete(regenCasesTable).where(inArray(regenCasesTable.id, createdCases));
  for (const id of [doctorId, otherDoctorId]) {
    await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [id]);
    await db.delete(patientsTable).where(eq(patientsTable.doctorId, id));
    await db.delete(regenTermsAcceptanceTable).where(eq(regenTermsAcceptanceTable.doctorId, id));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, id));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SANE-joelho entered by the clinician", () => {
  it("stores an integer 0–100 under SANE_JOELHO (both spellings)", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL3" });
    const a = await call(`/regen/cases/${created.id}/proms`, {
      method: "POST", body: JSON.stringify({ instrument: "SANE_JOELHO", timepoint: "Pré-operatório / Basal", score: 40 }),
    });
    expect(a.status).toBe(201);
    expect(await j(a)).toMatchObject({ instrument: "SANE_JOELHO", score: "40.00" });
    const b = await call(`/regen/cases/${created.id}/proms`, {
      method: "POST", body: JSON.stringify({ instrument: "SANE Joelho", timepoint: "3 meses", score: 75 }),
    });
    expect((await j(b)).instrument).toBe("SANE_JOELHO");
  });

  it("rejects non-integer, out-of-range or missing SANE scores", async () => {
    const created = await createCase({ conditionCode: "CONDROPATIA_PATELAR" });
    for (const score of [101, -1, 70.5, null]) {
      const res = await call(`/regen/cases/${created.id}/proms`, {
        method: "POST", body: JSON.stringify({ instrument: "SANE_JOELHO", timepoint: "1 mês", score }),
      });
      expect(res.status, String(score)).toBe(400);
    }
  });
});

describe("OARSI performance tests and knee ROM", () => {
  it("stores raw value + unit, derives 40 m speed and keeps stair steps", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL3" });
    const bodies = [
      { measure: "CHAIR_STAND_30S", value: 8 },
      { measure: "WALK_40M", value: 32 },
      { measure: "TUG", value: 12.4 },
      { measure: "STAIR_CLIMB", value: 18.5, steps: 11 },
      { measure: "KNEE_FLEXION", value: 105, side: "D" },
      { measure: "KNEE_EXTENSION_DEFICIT", value: 10, side: "D" },
    ];
    for (const body of bodies) {
      const res = await postTest(created.id, body);
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    }
    const rows = await j(await call(`/regen/cases/${created.id}/performance-tests`));
    expect(rows.map((r: any) => [r.measure, Number(r.value), r.unit, r.side])).toEqual([
      ["CHAIR_STAND_30S", 8, "rep", null],
      ["WALK_40M", 32, "s", null],
      ["TUG", 12.4, "s", null],
      ["STAIR_CLIMB", 18.5, "s", null],
      ["KNEE_FLEXION", 105, "deg", "D"],
      ["KNEE_EXTENSION_DEFICIT", 10, "deg", "D"],
    ]);
    expect(rows[1].details).toEqual({ speed_mps: 1.25 });
    expect(rows[3].details).toEqual({ steps: 11 });
  });

  it("rejects implausible values, missing side and unknown measures", async () => {
    const created = await createCase({ conditionCode: "LESAO_MENISCAL_DEGENERATIVA" });
    const invalid = [
      { measure: "TUG", value: 0.5 },
      { measure: "TUG", value: 121 },
      { measure: "CHAIR_STAND_30S", value: 61 },
      { measure: "CHAIR_STAND_30S", value: 7.5 },
      { measure: "WALK_40M", value: 4 },
      { measure: "KNEE_FLEXION", value: 161, side: "E" },
      { measure: "KNEE_FLEXION", value: 110 },
      { measure: "KNEE_EXTENSION_DEFICIT", value: -21, side: "E" },
      { measure: "STAIR_CLIMB", value: 15, steps: 0 },
      { measure: "KOOS", value: 50 },
      { measure: "TUG" },
    ];
    for (const body of invalid) {
      const res = await postTest(created.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await j(await call(`/regen/cases/${created.id}/performance-tests`))).toEqual([]);
  });

  it("is scoped to the owning doctor and can be deleted", async () => {
    const created = await createCase({ conditionCode: "TENDINOPATIA_PATELAR" });
    const saved = await j(await postTest(created.id, { measure: "CHAIR_STAND_30S", value: 11 }));
    expect((await call(`/regen/cases/${created.id}/performance-tests`, undefined, otherAuth)).status).toBe(404);
    expect((await postTest(created.id, { measure: "TUG", value: 9 }, otherAuth)).status).toBe(404);
    expect((await call(`/regen/cases/${created.id}/performance-tests/${saved.id}`, { method: "DELETE" }, otherAuth)).status).toBe(404);
    expect((await call(`/regen/cases/${created.id}/performance-tests/${saved.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await j(await call(`/regen/cases/${created.id}/performance-tests`))).toEqual([]);
  });
});

describe("patient follow-up for knee cases asks VAS + SANE-joelho", () => {
  it("schedules SANE Joelho only for knee conditions", async () => {
    const knee = await createCase({ conditionCode: "OA_JOELHO_KL2", plannedProducts: ["PRP"] });
    const hip = await createCase({ conditionCode: "OA_QUADRIL", plannedProducts: ["PRP"] });
    const other = await createCase({ conditionCode: "SINOVITE", plannedProducts: ["PRP"] });
    const kneeRows = await j(await call(`/regen/cases/${knee.id}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }) }));
    const hipRows = await j(await call(`/regen/cases/${hip.id}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }) }));
    expect(kneeRows.length).toBeGreaterThan(0);
    for (const row of kneeRows) expect(row.scales).toEqual(["VAS Dor", "SANE Joelho"]);
    const otherRows = await j(await call(`/regen/cases/${other.id}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }) }));
    // Hip cases get their own region SANE; region-less conditions ask VAS only.
    for (const row of hipRows) expect(row.scales).toEqual(["VAS Dor", "SANE Quadril"]);
    expect(otherRows.length).toBeGreaterThan(0);
    for (const row of otherRows) expect(row.scales).toEqual(["VAS Dor"]);
  });

  it("scores the patient's SANE-joelho answer server-side (integer 0–100)", async () => {
    const [patient] = await db.insert(patientsTable).values({
      doctorId, nome: "Paciente Fictício Alfa", cpf: "111.222.333-96",
    }).returning();
    const created = await createCase({ conditionCode: "OA_JOELHO_KL3", patientId: patient.id });
    const token = randomUUID();
    await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '3 meses', 90, $2, $3)`,
      [created.id, ["VAS Dor", "SANE Joelho"], token],
    );
    const verify = await fetch(`${baseUrl}/regen-api/patient/regen/${token}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf: "11122233396" }),
    });
    expect(verify.status).toBe(200);
    expect(await j(verify)).toMatchObject({ scales: ["VAS Dor", "SANE Joelho"] });
    const cookie = (verify.headers.getSetCookie?.() ?? [verify.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
    const submit = (escala: string, respostas: Record<string, unknown>) =>
      fetch(`${baseUrl}/regen-api/patient/regen/${token}/scale/${encodeURIComponent(escala)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
        body: JSON.stringify({ respostas, score: 0 }),
      });
    expect((await submit("SANE Joelho", { sane: 101 })).status).toBe(400);
    expect((await submit("SANE Joelho", { sane: 62.5 })).status).toBe(400);
    const ok = await submit("SANE Joelho", { sane: 70 });
    expect(ok.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT r.score FROM regen_scale_responses r JOIN regen_followup_notifications n ON n.id = r.notification_id
        WHERE n.token = $1 AND r.nome_escala = 'SANE Joelho'`,
      [token],
    );
    expect(rows.map((r) => Number(r.score))).toEqual([70]);
  });
});

describe("research export includes the knee measures", () => {
  it("returns baseline, last and change per measure (JSON and CSV)", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL4" });
    const at = (d: string) => `${d}T15:00:00.000Z`;
    await call(`/regen/cases/${created.id}/proms`, { method: "POST", body: JSON.stringify({ instrument: "SANE_JOELHO", timepoint: "Pré-operatório / Basal", score: 40, answeredAt: at("2026-01-10") }) });
    await call(`/regen/cases/${created.id}/proms`, { method: "POST", body: JSON.stringify({ instrument: "SANE_JOELHO", timepoint: "3 meses", score: 70, answeredAt: at("2026-04-10") }) });
    await postTest(created.id, { measure: "TUG", value: 12.4, measuredAt: at("2026-01-10") });
    await postTest(created.id, { measure: "TUG", value: 9.1, timepoint: "3 meses", measuredAt: at("2026-04-10") });
    await postTest(created.id, { measure: "KNEE_FLEXION", value: 100, side: "E", measuredAt: at("2026-01-10") });
    await postTest(created.id, { measure: "KNEE_FLEXION", value: 118, side: "E", timepoint: "3 meses", measuredAt: at("2026-04-10") });

    const rows = await j(await call(`/regen/research?condition=OA_JOELHO_KL4`));
    const row = rows.find((r: any) => r.id === created.id);
    expect(row).toMatchObject({
      sane_joelho_baseline: 40, sane_joelho_last: 70, sane_joelho_change: 30,
      tug_baseline: 12.4, tug_last: 9.1, tug_change: -3.3,
      knee_flexion_e_baseline: 100, knee_flexion_e_last: 118, knee_flexion_e_change: 18,
      knee_flexion_d_baseline: null, chair_stand_30s_change: null,
    });

    const csv = await (await call(`/regen/research?condition=OA_JOELHO_KL4&format=csv`)).text();
    const [header, ...lines] = csv.split("\r\n");
    const cols = header!.split(",");
    expect(cols).toEqual(expect.arrayContaining([
      "sane_joelho_baseline", "walk_40m_change", "stair_climb_last", "knee_extension_deficit_d_change",
    ]));
    const line = lines.find((l) => l.startsWith(created.id))!.split(",");
    expect(line[cols.indexOf("tug_change")]).toBe("-3.3");
  });
});

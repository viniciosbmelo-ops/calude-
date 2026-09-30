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
 * Only the scales DocRegen offers can be written from a client: manual PROMs
 * VAS and the region SANEs under either spelling ("SANE_JOELHO" / "SANE
 * Joelho", "SANE_OMBRO" / "SANE Ombro", quadril, cotovelo, tornozelo/pé,
 * punho/mão, coluna), and the follow-up link scales "VAS Dor" + region SANE.
 * Licensed or retired names are rejected with 400, while rows stored under
 * old names keep being returned for display.
 */

const REGION_SANES: Array<[string, string]> = [
  ["SANE_OMBRO", "SANE Ombro"],
  ["SANE_JOELHO", "SANE Joelho"],
  ["SANE_QUADRIL", "SANE Quadril"],
  ["SANE_COTOVELO", "SANE Cotovelo"],
  ["SANE_TORNOZELO_PE", "SANE Tornozelo e Pé"],
  ["SANE_PUNHO_MAO", "SANE Punho e Mão"],
  ["SANE_COLUNA", "SANE Coluna"],
];

const REJECTED = ["KOOS", "WOMAC", "IKDC", "ASES", "DASH"];

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
    body: JSON.stringify({ patientName: "Paciente Fictício Escalas", ...body }),
  });
  const json = await j(res);
  expect(res.status, JSON.stringify(json)).toBe(201);
  createdCases.push(json.id);
  return json;
}

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Doctor Scale Allowlist",
    email: `docregen-scale-allowlist-${randomUUID()}@example.test`,
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

describe("DocRegen PROM instrument allowlist", () => {
  it("rejects licensed/retired instruments, accepts VAS and SANE-joelho, still lists historical rows", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL3" });
    const promsPath = `/regen/cases/${created.id}/proms`;

    for (const instrument of [...REJECTED, "vas", "VAS Dor", "SANE", "KOOS-JR", "", "SANE Hombro", "SANE_OMBRO_D", "sane_coluna", "SANE Lombar"]) {
      const res = await call(promsPath, {
        method: "POST",
        body: JSON.stringify({ instrument, timepoint: "1 mês", score: 5 }),
      });
      expect(res.status, instrument).toBe(400);
    }

    const vas = await call(promsPath, {
      method: "POST", body: JSON.stringify({ instrument: "VAS", timepoint: "1 mês", score: 4 }),
    });
    expect(vas.status).toBe(201);
    for (const instrument of ["SANE_JOELHO", "SANE Joelho"]) {
      const sane = await call(promsPath, {
        method: "POST", body: JSON.stringify({ instrument, timepoint: "3 meses", score: 60 }),
      });
      expect(sane.status, instrument).toBe(201);
      expect((await j(sane)).instrument).toBe("SANE_JOELHO");
    }

    // Every region SANE, under both spellings, is accepted (integer 0–100) and
    // stored under its manual code; non-integer or out-of-range scores are not.
    for (const [code, scale] of REGION_SANES) {
      for (const instrument of [code, scale]) {
        const ok = await call(promsPath, {
          method: "POST", body: JSON.stringify({ instrument, timepoint: "6 meses", score: 0 }),
        });
        expect(ok.status, instrument).toBe(201);
        expect((await j(ok)).instrument).toBe(code);
        for (const score of [100.5, 101, 55.5]) {
          const bad = await call(promsPath, {
            method: "POST", body: JSON.stringify({ instrument, timepoint: "6 meses", score }),
          });
          expect(bad.status, `${instrument} ${score}`).toBe(400);
        }
      }
    }
    await pool.query(
      `DELETE FROM regen_prom_responses WHERE case_id = $1 AND timepoint = '6 meses'`,
      [created.id],
    );

    // A row recorded before the allowlist existed keeps being displayed.
    await pool.query(
      `INSERT INTO regen_prom_responses (case_id, instrument, timepoint, answers, score)
       VALUES ($1, 'WOMAC', '6 meses', '{}', 30)`,
      [created.id],
    );
    const list = await j(await call(promsPath));
    expect(list.map((p: { instrument: string }) => p.instrument).sort()).toEqual(["SANE_JOELHO", "SANE_JOELHO", "VAS", "WOMAC"]);
  });
});

describe("DocRegen follow-up link scale allowlist", () => {
  it("asks only for offered scales, rejects retired ones and keeps historical answers visible", async () => {
    const [patient] = await db.insert(patientsTable).values({
      doctorId, nome: "Paciente Regen Legado", cpf: "555.444.333-22",
    }).returning();
    const created = await createCase({ conditionCode: "OA_JOELHO_KL2", patientId: patient.id });
    const token = randomUUID();
    const { rows: [notif] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '3 meses', 90, $2, $3) RETURNING id`,
      [created.id, ["VAS Dor", "KOOS", "SANE Joelho", "IKDC"], token],
    );
    const { rows: [older] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '1 mês', 30, $2, $3) RETURNING id`,
      [created.id, ["KOOS"], randomUUID()],
    );
    await pool.query(
      `INSERT INTO regen_scale_responses (notification_id, nome_escala, respostas, score) VALUES ($1, 'KOOS', '{}', 70)`,
      [older.id],
    );

    const publicView = await fetch(`${baseUrl}/regen-api/patient/regen/${token}`);
    expect(publicView.status).toBe(200);
    await expect(publicView.json()).resolves.toMatchObject({ scales: ["VAS Dor", "SANE Joelho"], noScales: false });

    const verify = await fetch(`${baseUrl}/regen-api/patient/regen/${token}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf: "55544433322" }),
    });
    expect(verify.status).toBe(200);
    await expect(verify.json()).resolves.toMatchObject({ scales: ["VAS Dor", "SANE Joelho"] });
    const cookie = (verify.headers.getSetCookie?.() ?? [verify.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");

    const post = (escala: string, body: unknown) =>
      fetch(`${baseUrl}/regen-api/patient/regen/${token}/scale/${encodeURIComponent(escala)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
        body: JSON.stringify(body),
      });
    for (const escala of [...REJECTED, "SANE"]) {
      const res = await post(escala, { respostas: { q1: 1 }, score: 50 });
      expect(res.status, escala).toBe(400);
    }
    const { rows: none } = await pool.query(
      `SELECT 1 FROM regen_scale_responses WHERE notification_id = $1`, [notif.id],
    );
    expect(none).toHaveLength(0);

    const vas = await post("VAS Dor", { respostas: { vas: 3 } });
    expect(vas.status).toBe(200);
    await expect(vas.json()).resolves.toEqual({ ok: true, allCompleted: false });
    const sane = await post("SANE Joelho", { respostas: { sane: 80 } });
    expect(sane.status).toBe(200);
    await expect(sane.json()).resolves.toEqual({ ok: true, allCompleted: true });

    const timeline = await j(await call(`/regen/cases/${created.id}/notifications`));
    const olderRow = timeline.find((n: { id: number }) => n.id === older.id);
    expect(olderRow.responses).toEqual([expect.objectContaining({ score: 70 })]);
    expect(String(olderRow.responses[0].nome_escala)).toContain("KOOS");
  });
});

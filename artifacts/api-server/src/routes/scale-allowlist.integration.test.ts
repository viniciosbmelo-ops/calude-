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
} from "@workspace/db";
import app from "../app";
import { signToken } from "../lib/auth";

/**
 * Only the scales DocKnee offers can be written from a client: manual regen
 * PROM "VAS" and the regen follow-up link scale "VAS Dor". Licensed or retired
 * names are rejected with 400, while rows stored under old names keep being
 * returned for display.
 */

const REJECTED = ["KOOS", "WOMAC", "IKDC", "ASES", "DASH"];

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
const createdCases: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();

function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Doctor Scale Allowlist",
    email: `docknee-scale-allowlist-${randomUUID()}@example.test`,
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
    await db.delete(regenTermsAcceptanceTable).where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
    await db.delete(patientsTable).where(eq(patientsTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("DocKnee regen PROM instrument allowlist", () => {
  it("rejects licensed/retired instruments, accepts VAS and still lists historical rows", async () => {
    const created = await call("/regen/cases", {
      method: "POST",
      body: JSON.stringify({ patientName: "Paciente Fictício Escalas", conditionCode: "OA_OMBRO" }),
    });
    const caseBody = await j(created);
    expect(created.status, JSON.stringify(caseBody)).toBe(201);
    createdCases.push(caseBody.id);
    const promsPath = `/regen/cases/${caseBody.id}/proms`;

    for (const instrument of [...REJECTED, "vas", "VAS Dor", "SANE", ""]) {
      const res = await call(promsPath, {
        method: "POST",
        body: JSON.stringify({ instrument, timepoint: "1 mês", score: 5 }),
      });
      expect(res.status, instrument).toBe(400);
    }

    const ok = await call(promsPath, {
      method: "POST",
      body: JSON.stringify({ instrument: "VAS", timepoint: "1 mês", score: 4 }),
    });
    expect(ok.status).toBe(201);
    expect((await j(ok)).instrument).toBe("VAS");

    // A row recorded before the allowlist existed keeps being displayed.
    await pool.query(
      `INSERT INTO regen_prom_responses (case_id, instrument, timepoint, answers, score)
       VALUES ($1, 'KOOS', '3 meses', '{}', 62)`,
      [caseBody.id],
    );
    const list = await j(await call(promsPath));
    expect(list.map((p: { instrument: string }) => p.instrument).sort()).toEqual(["KOOS", "VAS"]);
  });
});

describe("DocKnee regen follow-up link scale allowlist", () => {
  it("asks only for offered scales, rejects retired ones and keeps historical answers visible", async () => {
    const [patient] = await db.insert(patientsTable).values({
      doctorId, nome: "Paciente Regen Legado", cpf: "555.444.333-22",
    }).returning();
    const caseId = randomUUID();
    createdCases.push(caseId);
    await pool.query(
      `INSERT INTO regen_cases (id, doctor_id, patient_id, condition_code) VALUES ($1, $2, $3, 'OA_OMBRO')`,
      [caseId, doctorId, patient.id],
    );
    const token = randomUUID();
    const { rows: [notif] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '3 meses', 90, $2, $3) RETURNING id`,
      [caseId, ["VAS Dor", "KOOS", "WOMAC"], token],
    );
    // Historical answer to a retired scale on an older notification.
    const { rows: [older] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '1 mês', 30, $2, $3) RETURNING id`,
      [caseId, ["KOOS"], randomUUID()],
    );
    await pool.query(
      `INSERT INTO regen_scale_responses (notification_id, nome_escala, respostas, score) VALUES ($1, 'KOOS', '{}', 70)`,
      [older.id],
    );

    const publicView = await fetch(`${baseUrl}/api/patient/regen/${token}`);
    expect(publicView.status).toBe(200);
    await expect(publicView.json()).resolves.toMatchObject({ scales: ["VAS Dor"], noScales: false });

    const verify = await fetch(`${baseUrl}/api/patient/regen/${token}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf: "55544433322" }),
    });
    expect(verify.status).toBe(200);
    await expect(verify.json()).resolves.toMatchObject({ scales: ["VAS Dor"] });
    const cookie = (verify.headers.get("set-cookie") ?? "").split(";")[0];

    const post = (escala: string, body: unknown) => fetch(
      `${baseUrl}/api/patient/regen/${token}/scale/${encodeURIComponent(escala)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
        body: JSON.stringify(body),
      },
    );
    for (const escala of REJECTED) {
      const res = await post(escala, { respostas: { q1: 1 }, score: 50 });
      expect(res.status, escala).toBe(400);
    }
    const { rows: none } = await pool.query(
      `SELECT 1 FROM regen_scale_responses WHERE notification_id = $1`, [notif.id],
    );
    expect(none).toHaveLength(0);

    const vas = await post("VAS Dor", { respostas: { vas: 3 } });
    expect(vas.status).toBe(200);
    await expect(vas.json()).resolves.toEqual({ ok: true, allCompleted: true });

    const timeline = await j(await call(`/regen/cases/${caseId}/notifications`));
    const olderRow = timeline.find((n: { id: number }) => n.id === older.id);
    expect(olderRow.responses).toEqual([expect.objectContaining({ score: 70 })]);
    expect(String(olderRow.responses[0].nome_escala)).toContain("KOOS");
  });
});

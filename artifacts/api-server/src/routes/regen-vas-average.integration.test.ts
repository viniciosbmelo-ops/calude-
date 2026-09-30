import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, pool, regenTermsAcceptanceTable } from "@workspace/db";
import app from "../app";
import { signToken } from "../lib/auth";
import { initRegenData } from "./regen";

/**
 * The patient answers the pain scale through the follow-up link ("VAS Dor",
 * stored in regen_scale_responses). The dashboard average VAS and the research
 * export's avg_vas must include those answers, not only clinician-entered VAS.
 */

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (path: string, init?: RequestInit): Promise<any> => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  expect(res.status, text).toBeLessThan(300);
  return res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
};

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Doctor VAS Average",
    email: `regen-vas-average-${randomUUID()}@example.test`,
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
  if (doctorId) {
    await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
    await db.delete(regenTermsAcceptanceTable).where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("average VAS includes the patient's follow-up-link answers", () => {
  it("averages clinician VAS and patient 'VAS Dor' in /regen/stats and the research export", async () => {
    const created = await call("/regen/cases", {
      method: "POST",
      body: JSON.stringify({ patientName: "Paciente Fictício VAS", conditionCode: "OA_JOELHO_KL3" }),
    });
    await call(`/regen/cases/${created.id}/proms`, {
      method: "POST",
      body: JSON.stringify({ instrument: "VAS", timepoint: "Pré-operatório / Basal", score: 6 }),
    });
    const { rows: [notification] } = await pool.query(
      `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scales, token)
       VALUES ($1, '1 mês', 30, $2, $3) RETURNING id`,
      [created.id, ["VAS Dor"], randomUUID()],
    );
    await pool.query(
      `INSERT INTO regen_scale_responses (notification_id, nome_escala, respostas, score)
       VALUES ($1, 'VAS Dor', '{"vas":2}', 2)`,
      [notification.id],
    );

    const stats = await call("/regen/stats");
    expect(Number(stats.avg_vas)).toBe(4);

    const rows = await call("/regen/research");
    expect(Number(rows.find((r: { id: string }) => r.id === created.id)?.avg_vas)).toBe(4);

    const csv: string = await call("/regen/research?format=csv");
    const [header, ...lines] = csv.split("\r\n");
    const cols = header!.split(",");
    const line = lines.find((l) => l.startsWith(created.id))!.split(",");
    expect(line[cols.indexOf("avg_vas")]).toBe("4.0");
  });
});

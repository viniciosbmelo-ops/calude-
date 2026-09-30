/**
 * AI clinical summary: the prompt sent to the external provider carries no
 * direct identifiers, and each doctor has a DB-backed daily quota (429).
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";

const prompts: string[] = [];
vi.mock("../lib/gemini", () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: async (request: { contents: Array<{ parts: Array<{ text: string }> }> }) => {
        prompts.push(request.contents[0]!.parts[0]!.text);
        return { candidates: [{ content: { parts: [{ text: "Resumo clínico." }] } }] };
      },
    },
  }),
  isGeminiConfigured: () => true,
}));

const { db, doctorsTable, patientsTable, pool, rateLimitBucketsTable } = await import("@workspace/docregen-db");
const { default: app } = await import("../app");
const { signToken } = await import("../lib/auth");
const { ageInYears, buildAiSummaryPrompt } = await import("../lib/ai-summary-prompt");

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
let caseId: string;

const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}/regen-api${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
});

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "AI Doctor", email: `ai-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });
  const [patient] = await db.insert(patientsTable).values({ doctorId, nome: "JOANA IDENTIFICAVEL", cpf: "529.982.247-25", telefone: "27999991111" }).returning();
  caseId = randomUUID();
  await pool.query(
    `INSERT INTO regen_cases (id, doctor_id, patient_id, patient_name, patient_dob, patient_sex, patient_phone, condition_code,
                              condition_custom, imc, goal_vev, status)
     VALUES ($1,$2,$3,'JOANA IDENTIFICAVEL','1960-06-15','F','27999991111','OA_JOELHO_KL3','Joana caiu na escada', 27.5, ARRAY['reduzir_dor'], 'active')`,
    [caseId, doctorId, patient!.id],
  );
  await pool.query(
    `INSERT INTO regen_procedures (case_id, doctor_id, product_code, performed_at, adverse_event, adverse_event_desc)
     VALUES ($1,$2,'PRP','2026-03-10T13:00:00Z',true,'Joana teve dor no local'), ($1,$2,'PRP','2026-04-09T13:00:00Z',false,NULL)`,
    [caseId, doctorId],
  );
  await pool.query(`INSERT INTO regen_prom_responses (case_id, instrument, timepoint, score) VALUES ($1,'VAS','Basal',7)`, [caseId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
  await db.delete(rateLimitBucketsTable).where(like(rateLimitBucketsTable.key, `ai-summary:${doctorId}`));
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  prompts.length = 0;
  await db.delete(rateLimitBucketsTable).where(eq(rateLimitBucketsTable.key, `ai-summary:${doctorId}`));
});

describe("AI summary prompt minimization", () => {
  it("sends age and sex, never name, birth date, CPF, phone, calendar dates or free text", async () => {
    const response = await call(`/regen/cases/${caseId}/ai-summary`, { method: "POST" });
    expect(response.status).toBe(200);
    const prompt = prompts[0]!;
    expect(prompt).toContain("Idade: ");
    expect(prompt).toMatch(/Idade: \d+ anos/);
    expect(prompt).toContain("Sexo: feminino");
    for (const forbidden of ["JOANA", "Joana", "1960", "15/06", "529.982.247-25", "27999991111", "2026-03-10", "10/03/2026", "escada", "dor no local"]) {
      expect(prompt, forbidden).not.toContain(forbidden);
    }
    expect(prompt).toContain("dia 0: PRP");
    expect(prompt).toContain("dia 30: PRP");
    expect(prompt).toContain("[evento adverso registrado]");
  });

  it("ageInYears handles birthdays", () => {
    expect(ageInYears("1960-06-15", new Date("2026-06-14T12:00:00Z"))).toBe(65);
    expect(ageInYears("1960-06-15", new Date("2026-06-15T12:00:00Z"))).toBe(66);
    expect(ageInYears(null)).toBeNull();
    expect(buildAiSummaryPrompt({ caso: { patient_name: "X Y" }, procedures: [], proms: [], labs: [] })).not.toContain("X Y");
  });
});

describe("per-doctor AI quota", () => {
  it("answers 429 with a clear message after the daily limit", async () => {
    process.env["DOCREGEN_AI_DAILY_LIMIT"] = "2";
    try {
      expect((await call(`/regen/cases/${caseId}/ai-summary`, { method: "POST" })).status).toBe(200);
      expect((await call(`/regen/cases/${caseId}/ai-summary`, { method: "POST" })).status).toBe(200);
      const limited = await call(`/regen/cases/${caseId}/ai-summary`, { method: "POST" });
      expect(limited.status).toBe(429);
      const body = await limited.json() as { error: string; code: string };
      expect(body.code).toBe("AI_RATE_LIMIT");
      expect(body.error).toMatch(/Limite diário/);
      expect(limited.headers.get("retry-after")).toBeTruthy();
      expect(prompts).toHaveLength(2);
    } finally {
      delete process.env["DOCREGEN_AI_DAILY_LIMIT"];
    }
  });
});

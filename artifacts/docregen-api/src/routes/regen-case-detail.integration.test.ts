import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  pool,
  regenCasesTable,
  regenFollowupNotificationsTable,
  regenTermsAcceptanceTable,
} from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";
import { initRegenData } from "./regen";

/**
 * Regenerative case detail contract used by the DocRegen case page:
 * calendar dates as "YYYY-MM-DD", procedures/PROMs/labs endpoints, the
 * product-specific follow-up schedule, the knee conditions catalog and the
 * optional Gemini integration.
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

async function createCase(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await call("/regen/cases", {
    method: "POST",
    body: JSON.stringify({ patientName: "Paciente Fictício Teste", ...body }),
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
    nome: "Doctor Case Detail",
    email: `docregen-case-detail-${randomUUID()}@example.test`,
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
  await db.delete(regenTermsAcceptanceTable).where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("calendar dates are serialised as YYYY-MM-DD", () => {
  it("returns date-only columns verbatim (no midnight-UTC timestamp)", async () => {
    const created = await createCase({
      conditionCode: "OA_JOELHO_KL2",
      dataCaso: "2026-09-29",
      patientDob: "1961-03-01",
    });
    expect(created.data_caso).toBe("2026-09-29");
    expect(created.patient_dob).toBe("1961-03-01");

    const res = await call(`/regen/cases/${created.id}`);
    const body = await j(res);
    expect(body.data_caso).toBe("2026-09-29");
    expect(body.patient_dob).toBe("1961-03-01");

    const list = await j(await call("/regen/cases"));
    expect(list.find((c: any) => c.id === created.id).data_caso).toBe("2026-09-29");
  });

  it("follow-up overview returns scheduled_date as YYYY-MM-DD and flags overdue ones", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL3", plannedProducts: ["PRP"] });
    await db.insert(regenFollowupNotificationsTable).values([
      { caseId: created.id, periodo: "1 mês", daysAfterProcedure: 30, scheduledDate: "2020-01-15", scales: ["VAS Dor"] },
      { caseId: created.id, periodo: "12 meses", daysAfterProcedure: 365, scheduledDate: "2099-09-29", scales: ["VAS Dor"] },
    ]);
    const overview = await j(await call("/regen/followup-overview"));
    const all = [...overview.vencidos, ...overview.agendados, ...overview.respondidos, ...overview.aguardando]
      .filter((row: any) => row.case_id === created.id);
    expect(all.map((row: any) => row.scheduled_date).sort()).toEqual(["2020-01-15", "2099-09-29"]);
    expect(overview.vencidos.some((row: any) => row.case_id === created.id && row.scheduled_date === "2020-01-15")).toBe(true);
    expect(overview.agendados.some((row: any) => row.case_id === created.id && row.scheduled_date === "2099-09-29")).toBe(true);
  });
});

describe("follow-up schedule is product-specific", () => {
  it("does not schedule the 6-week HA review for a PRP case", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL2", plannedProducts: ["PRP"] });
    const res = await call(`/regen/cases/${created.id}/notifications/init`, {
      method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }),
    });
    const rows = await j(res);
    expect(res.status).toBe(200);
    const periods = rows.map((row: any) => row.periodo);
    expect(periods).not.toContain("6 semanas (HA)");
    expect(periods).toContain("6 meses ★");
    const oneMonth = rows.find((row: any) => row.periodo === "1 mês");
    expect(oneMonth.scheduled_date).toBe("2026-10-29");
  });

  it("schedules it for a hyaluronic acid case", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL3", plannedProducts: ["AH"] });
    const rows = await j(await call(`/regen/cases/${created.id}/notifications/init`, {
      method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }),
    }));
    const ha = rows.find((row: any) => row.periodo === "6 semanas (HA)");
    expect(ha?.scheduled_date).toBe("2026-11-10");
  });
});

describe("procedures, PROMs and labs for the case detail tabs", () => {
  it("records a procedure and VAS 8 → 5 → 3 and lists them all", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL2", plannedProducts: ["PRP"] });

    const proc = await call(`/regen/cases/${created.id}/procedures`, {
      method: "POST",
      body: JSON.stringify({
        productCode: "PRP",
        guidanceMode: "ultrassom",
        accessRoute: "Intra-articular",
        performedAt: "2026-09-29T15:00:00.000Z",
        biologicDetails: { volumeFinal: "5" },
      }),
    });
    expect(proc.status).toBe(201);
    const procs = await j(await call(`/regen/cases/${created.id}/procedures`));
    expect(procs).toHaveLength(1);
    expect(procs[0]).toMatchObject({ product_code: "PRP", access_route: "Intra-articular" });

    const scores = [
      ["Pré-operatório / Basal", 8, "2026-09-29T15:00:00.000Z"],
      ["1 mês", 5, "2026-10-29T15:00:00.000Z"],
      ["3 meses", 3, "2026-12-28T15:00:00.000Z"],
    ] as const;
    for (const [timepoint, score, answeredAt] of scores) {
      // The case page sends only instrument/timepoint/score (no `answers`).
      const res = await call(`/regen/cases/${created.id}/proms`, {
        method: "POST", body: JSON.stringify({ instrument: "VAS", timepoint, score, answeredAt }),
      });
      expect(res.status).toBe(201);
    }
    const proms = await j(await call(`/regen/cases/${created.id}/proms`));
    const ordered = [...proms].sort((a: any, b: any) => Date.parse(a.answered_at) - Date.parse(b.answered_at));
    expect(ordered.map((p: any) => Number(p.score))).toEqual([8, 5, 3]);
    expect(new Date(ordered[0].answered_at).toISOString()).toBe("2026-09-29T15:00:00.000Z");

    const invalid = await call(`/regen/cases/${created.id}/proms`, {
      method: "POST", body: JSON.stringify({ instrument: "VAS", timepoint: "1 mês", score: 11 }),
    });
    expect(invalid.status).toBe(400);
    const missing = await call(`/regen/cases/${created.id}/proms`, {
      method: "POST", body: JSON.stringify({ score: 4 }),
    });
    expect(missing.status).toBe(400);

    const labs = await call(`/regen/cases/${created.id}/labs`, {
      method: "POST",
      body: JSON.stringify({ results: [{ analyte: "Plaquetas", value: 250, unit: "×10³/μL", collectedAt: "2026-09-20" }] }),
    });
    expect(labs.status).toBe(201);
    const labRows = await j(await call(`/regen/cases/${created.id}/labs`));
    expect(labRows[0].collected_at).toBe("2026-09-20");
  });
});

describe("knee conditions catalog", () => {
  it("seeds the Joelho conditions and accepts them on new cases", async () => {
    const conditions = await j(await call("/regen/conditions"));
    const codes = conditions.map((c: any) => c.code);
    for (const code of [
      "OA_JOELHO_KL1", "OA_JOELHO_KL2", "OA_JOELHO_KL3", "OA_JOELHO_KL4",
      "LESAO_MENISCAL_DEGENERATIVA", "TENDINOPATIA_PATELAR", "CONDROPATIA_PATELAR",
    ]) {
      expect(codes).toContain(code);
    }
    expect(conditions.find((c: any) => c.code === "OA_JOELHO_KL4").name)
      .toBe("Osteoartrite de Joelho — Kellgren-Lawrence IV");

    const created = await createCase({ conditionCode: "TENDINOPATIA_PATELAR" });
    expect(created.condition_code).toBe("TENDINOPATIA_PATELAR");
  });

  it("rejects unknown condition codes", async () => {
    const res = await call("/regen/cases", {
      method: "POST", body: JSON.stringify({ patientName: "Paciente Fictício", conditionCode: "NAO_EXISTE" }),
    });
    expect(res.status).toBe(400);
  });

  it("reports cases by condition code (labels are applied by the frontend)", async () => {
    await createCase({ conditionCode: "CONDROPATIA_PATELAR", status: "active" });
    const report = await j(await call("/reports/regen"));
    expect(report.byCondition.CONDROPATIA_PATELAR).toBeGreaterThanOrEqual(1);
    expect(report.byStatus.active).toBeGreaterThanOrEqual(1);
  });
});

describe("optional Gemini integration", () => {
  it("answers 503 'IA não configurada' when the Gemini variables are missing", async () => {
    const created = await createCase({ conditionCode: "OA_JOELHO_KL1" });
    vi.stubEnv("AI_INTEGRATIONS_GEMINI_BASE_URL", "");
    vi.stubEnv("AI_INTEGRATIONS_GEMINI_API_KEY", "");
    try {
      const res = await call(`/regen/cases/${created.id}/ai-summary`, { method: "POST" });
      expect(res.status).toBe(503);
      expect((await j(res)).error).toBe("IA não configurada");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("pg pool date parsing", () => {
  it("returns SQL date values as plain strings", async () => {
    const { rows } = await pool.query(`SELECT DATE '2026-09-29' AS d`);
    expect(rows[0].d).toBe("2026-09-29");
  });
});

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  doctorsTable,
  pool,
  regenCasesTable,
  regenFollowupNotificationsTable,
  regenTermsAcceptanceTable,
} from "@workspace/db";
import app from "../app";
import { signToken } from "../lib/auth";

/**
 * Regenerative case contract used by the DocKnee case page and follow-up
 * central: calendar dates serialised as "YYYY-MM-DD" (no midnight-UTC
 * timestamp that browsers in Brazil render one day early), overdue follow-ups
 * detected, manual PROMs recorded without `answers`, and the procedures /
 * PROMs / labs endpoints behind the case detail tabs. Runs in
 * America/Sao_Paulo (UTC-3), where the old behaviour shifted dates.
 */

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
const createdCases: string[] = [];
const originalTz = process.env.TZ;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();

function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createCase(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await call("/regen/cases", {
    method: "POST",
    body: JSON.stringify({ patientName: "Paciente Fictício Teste", conditionCode: "OA_OMBRO", ...body }),
  });
  const json = await j(res);
  expect(res.status, JSON.stringify(json)).toBe(201);
  createdCases.push(json.id);
  return json;
}

beforeAll(async () => {
  process.env.TZ = "America/Sao_Paulo";
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Doctor Calendar Dates",
    email: `docknee-calendar-dates-${randomUUID()}@example.test`,
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
    await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  }
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("pg pool date parsing", () => {
  it("runs west of UTC", () => {
    expect(new Date(2026, 8, 29).getTimezoneOffset()).toBe(180);
  });

  it("returns SQL date values as plain strings (other types unchanged)", async () => {
    const { rows } = await pool.query(
      `SELECT DATE '2026-09-29' AS d, TIMESTAMPTZ '2026-09-29T15:00:00Z' AS ts, 42::int AS n`,
    );
    expect(rows[0].d).toBe("2026-09-29");
    expect(rows[0].ts).toBeInstanceOf(Date);
    expect((rows[0].ts as Date).toISOString()).toBe("2026-09-29T15:00:00.000Z");
    expect(rows[0].n).toBe(42);
  });
});

describe.sequential("calendar dates are serialised as YYYY-MM-DD", () => {
  it("returns date-only columns verbatim (no midnight-UTC timestamp)", async () => {
    const created = await createCase({ dataCaso: "2026-09-29", patientDob: "1961-03-01" });
    expect(created.data_caso).toBe("2026-09-29");
    expect(created.patient_dob).toBe("1961-03-01");

    const body = await j(await call(`/regen/cases/${created.id}`));
    expect(body.data_caso).toBe("2026-09-29");
    expect(body.patient_dob).toBe("1961-03-01");

    const list = await j(await call("/regen/cases"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(list.find((c: any) => c.id === created.id).data_caso).toBe("2026-09-29");
  });

  it("follow-up overview returns scheduled_date as YYYY-MM-DD and flags overdue ones", async () => {
    const created = await createCase({ plannedProducts: ["PRP"] });
    await db.insert(regenFollowupNotificationsTable).values([
      { caseId: created.id, periodo: "1 mês", daysAfterProcedure: 30, scheduledDate: "2020-01-15", scales: ["VAS Dor"] },
      { caseId: created.id, periodo: "12 meses", daysAfterProcedure: 365, scheduledDate: "2099-09-29", scales: ["VAS Dor"] },
    ]);
    const overview = await j(await call("/regen/followup-overview"));
    const all = [...overview.vencidos, ...overview.agendados, ...overview.respondidos, ...overview.aguardando]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((row: any) => row.case_id === created.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(all.map((row: any) => row.scheduled_date).sort()).toEqual(["2020-01-15", "2099-09-29"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(overview.vencidos.some((row: any) => row.case_id === created.id && row.scheduled_date === "2020-01-15")).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(overview.agendados.some((row: any) => row.case_id === created.id && row.scheduled_date === "2099-09-29")).toBe(true);
  });

  it("schedules follow-ups from the base calendar date without shifting it", async () => {
    const created = await createCase({ plannedProducts: ["PRP"] });
    const res = await call(`/regen/cases/${created.id}/notifications/init`, {
      method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }),
    });
    const rows = await j(res);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byPeriod = Object.fromEntries(rows.map((row: any) => [row.periodo, row.scheduled_date]));
    expect(byPeriod["Pré-op (Baseline)"]).toBe("2026-09-29");
    expect(byPeriod["1 mês"]).toBe("2026-10-29");
    expect(byPeriod["6 semanas (HA)"]).toBe("2026-11-10");

    const stored = await pool.query(
      `SELECT scheduled_date::text AS d FROM regen_followup_notifications WHERE case_id = $1 AND days_after_procedure = 0`,
      [created.id],
    );
    expect(stored.rows[0].d).toBe("2026-09-29");

    const bad = await call(`/regen/cases/${created.id}/notifications/init`, {
      method: "POST", body: JSON.stringify({ baseDate: "29/09/2026" }),
    });
    expect(bad.status).toBe(400);
  });
});

describe.sequential("procedures, PROMs and labs for the case detail tabs", () => {
  it("records a procedure and VAS 8 → 5 → 3 without answers, and lists them all", async () => {
    const created = await createCase({ plannedProducts: ["PRP"] });

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
    const zero = await call(`/regen/cases/${created.id}/proms`, {
      method: "POST", body: JSON.stringify({ instrument: "VAS", timepoint: "6 meses", score: 0, answeredAt: "2027-03-29T15:00:00.000Z" }),
    });
    expect(zero.status).toBe(201);
    expect(Number((await j(zero)).score)).toBe(0);

    const proms = await j(await call(`/regen/cases/${created.id}/proms`));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ordered = [...proms].sort((a: any, b: any) => Date.parse(a.answered_at) - Date.parse(b.answered_at));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(ordered.map((p: any) => Number(p.score))).toEqual([8, 5, 3, 0]);
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
    expect((await j(labs))[0].collected_at).toBe("2026-09-20");
    const labRows = await j(await call(`/regen/cases/${created.id}/labs`));
    expect(labRows[0].collected_at).toBe("2026-09-20");
  });
});

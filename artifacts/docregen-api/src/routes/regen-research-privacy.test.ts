/**
 * Research export de-identification: per-export pseudonyms (no case UUID),
 * month/year dates, age and BMI bands, k<5 warning with suppression of the
 * descriptive column, no free text, safe CSV (formula injection).
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, doctorsTable, pool, regenTermsAcceptanceTable } from "@workspace/docregen-db";
import app from "../app";
import { signToken } from "../lib/auth";
import { initRegenData } from "./regen";
import { csvCell } from "../lib/csv";
import { ageBand, bmiBand, buildResearchRows, researchPrivacySummary } from "../lib/research-export";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
const caseIds: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();
const call = (path: string, init?: RequestInit) => fetch(`${baseUrl}/regen-api${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...init?.headers },
});

async function createCase(body: Record<string, unknown>): Promise<string> {
  const res = await call("/regen/cases", {
    method: "POST",
    body: JSON.stringify({ patientName: "Maria Identificavel Silva", ...body }),
  });
  const json = await j(res);
  expect(res.status, JSON.stringify(json)).toBe(201);
  caseIds.push(json.id);
  return json.id;
}

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Research Doctor", email: `research-${randomUUID()}@example.test`, senhaHash: "x", isFree: true,
  }).returning();
  doctorId = doctor!.id;
  await db.insert(regenTermsAcceptanceTable).values({ doctorId, termsVersion: "terms_regen_v1", dpaVersion: "dpa_regen_v1" });
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: 0 });

  // Five knee OA cases in the same demographic group (50–54, F, BMI 25–29)…
  for (let i = 0; i < 5; i++) {
    await createCase({
      conditionCode: "OA_JOELHO_KL3", patientDob: `197${3 + (i % 2)}-03-1${i}`, patientSex: "F",
      weightKg: 70 + i, heightCm: 165, conditionCustom: "=HYPERLINK(\"http://evil\")", goalCustom: "Voltar a jogar com o João",
      productDetails: { locaisAplicacao: JSON.stringify([{ localAplicacao: "Joelho", guia: "ultrassom", estruturaAnatomica: "JOELHO" }]) },
    });
  }
  // …and one outlier (80–84, M) that is alone in its group.
  await createCase({
    conditionCode: "OA_JOELHO_KL3", patientDob: "1943-07-02", patientSex: "M", weightKg: 60, heightCm: 170,
    productDetails: { locaisAplicacao: JSON.stringify([{ localAplicacao: "Joelho", guia: "ultrassom", estruturaAnatomica: "JOELHO" }]) },
  });
});

afterAll(async () => {
  await pool.query(`DELETE FROM regen_cases WHERE doctor_id = $1`, [doctorId]);
  await db.delete(regenTermsAcceptanceTable).where(eq(regenTermsAcceptanceTable.doctorId, doctorId));
  await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("research export de-identification", () => {
  it("JSON: pseudonyms instead of case ids, bands, month/year, k<5 warning", async () => {
    const payload = await j(await call("/regen/research"));
    expect(payload.pseudonymized).toBe(true);
    expect(payload.total).toBe(6);
    const text = JSON.stringify(payload);
    for (const id of caseIds) expect(text).not.toContain(id);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no exact dates
    expect(text).not.toContain("Maria Identificavel");
    expect(text).not.toContain("HYPERLINK");
    expect(text).not.toContain("João");

    const rows = payload.rows as Array<Record<string, any>>;
    for (const row of rows) {
      expect(row.pseudo_id).toMatch(/^R-[0-9a-f]{8}$/);
      expect(row).not.toHaveProperty("id");
      expect(row).not.toHaveProperty("age");
      expect(row).not.toHaveProperty("imc");
      expect(row).not.toHaveProperty("created_at");
      expect(row.case_month).toMatch(/^\d{4}-\d{2}$/);
    }
    const group = rows.filter((row) => row.sex === "F");
    expect(group).toHaveLength(5);
    expect(new Set(group.map((row) => row.age_band))).toEqual(new Set(["50-54"]));
    expect(new Set(group.map((row) => row.bmi_band))).toEqual(new Set(["25-29"]));
    expect(group.every((row) => row.anatomical_sites && !row.small_group)).toBe(true);

    const [outlier] = rows.filter((row) => row.sex === "M");
    expect(outlier).toMatchObject({ age_band: "80-84", bmi_band: "20-24", small_group: true, anatomical_sites: null });
    expect(payload.smallGroupWarning).toBe(true);
    expect(payload.smallGroups).toEqual([{ age_band: "80-84", sex: "M", bmi_band: "20-24", count: 1 }]);
    expect(payload.warning).toMatch(/k<5/);
  });

  it("pseudonyms change between exports (no linkage)", async () => {
    const a = (await j(await call("/regen/research"))).rows.map((r: any) => r.pseudo_id);
    const b = (await j(await call("/regen/research"))).rows.map((r: any) => r.pseudo_id);
    expect(a.filter((id: string) => b.includes(id))).toEqual([]);
  });

  it("CSV: no UUID, no exact date, warning header", async () => {
    const response = await call("/regen/research?format=csv");
    expect(response.headers.get("x-research-warning")).toBe("k<5");
    expect(response.headers.get("content-disposition")).not.toMatch(/\d{13}/);
    const csv = await response.text();
    for (const id of caseIds) expect(csv).not.toContain(id);
    expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const [header] = csv.replace(/^﻿/, "").split("\r\n");
    expect(header!.split(",").slice(0, 3)).toEqual(["pseudo_id", "age_band", "sex"]);
    expect(header).not.toMatch(/(^|,)id(,|$)/);
  });

  it("filters: invalid numeric filter is a 400, not a 500", async () => {
    expect((await call("/regen/research?age_min=abc")).status).toBe(400);
  });
});

describe("helpers", () => {
  it("bands", () => {
    expect(ageBand(52)).toBe("50-54");
    expect(ageBand(94)).toBe("90+");
    expect(ageBand(null)).toBeNull();
    expect(bmiBand(27.9)).toBe("25-29");
    expect(bmiBand(46)).toBe("45+");
  });

  it("csvCell neutralizes spreadsheet formulas and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-3.3")).toBe("-3.3");
    expect(csvCell(-3.3)).toBe("-3.3");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("line\nbreak")).toBe("line break");
  });

  it("whole export smaller than k is flagged even in a single group", () => {
    const rows = buildResearchRows([1, 2].map(() => ({
      age: 40, sex: "F", imc: 22, condition: "X", sane_region: null, anatomical_sites: "Joelho",
      status: "active", procedure_count: 1, adverse_events: 0, avg_vas: null, dm: false, case_month: "2026-01", measures: {},
    })));
    expect(rows.every((row) => row.anatomical_sites === null)).toBe(true);
    expect(researchPrivacySummary(rows).smallGroupWarning).toBe(true);
  });
});

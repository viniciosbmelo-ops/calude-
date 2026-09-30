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
import { REGEN_PATIENT_SCALES } from "../lib/regen-followup-schedule";
import { initRegenData } from "./regen";

/**
 * Conditions without a region ("outras": condral focal, tendinopatia, …) take
 * the SANE of their application site(s) when all sites map to one region;
 * otherwise VAS only. Computed from the case's current data (schedule, patient
 * link, clinician list, research export) — nothing is migrated.
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

type Site = { localAplicacao?: string; guia?: string; estruturaAnatomica?: string; estruturaAnatomicaDetalhe?: string };
const sites = (...rows: Site[]) => ({
  locaisAplicacao: JSON.stringify(rows.map((row) => ({ localAplicacao: "", guia: "", ...row }))),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createCase(body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await call("/regen/cases", {
    method: "POST",
    body: JSON.stringify({ patientName: "Paciente Fictício Local", plannedProducts: ["PRP"], ...body }),
  });
  const json = await j(res);
  expect(res.status, JSON.stringify(json)).toBe(201);
  createdCases.push(json.id);
  return json;
}

const initNotifications = async (caseId: string) =>
  j(await call(`/regen/cases/${caseId}/notifications/init`, { method: "POST", body: JSON.stringify({ baseDate: "2026-09-29" }) }));

async function scheduledScales(body: Record<string, unknown>): Promise<string[]> {
  const created = await createCase(body);
  const rows = await initNotifications(created.id);
  expect(rows.length).toBeGreaterThan(0);
  const distinct = [...new Set(rows.map((row: { scales: string[] }) => row.scales.join("|")))];
  expect(distinct, JSON.stringify(body)).toHaveLength(1);
  return (distinct[0] as string).split("|");
}

let cpfSeq = 0;
/** Valid fictional CPF (check digits computed). */
function fakeCpf(): string {
  const base = String(100000000 + ((Date.now() + cpfSeq++ * 7919) % 899999999)).slice(0, 9).split("").map(Number);
  const digit = (nums: number[]) => {
    const sum = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join("");
}

beforeAll(async () => {
  await initRegenData();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [doctor] = await db.insert(doctorsTable).values({
    nome: "Doctor Site SANE",
    email: `docregen-site-sane-${randomUUID()}@example.test`,
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

describe("schedule: region-less conditions take the application site's region SANE", () => {
  it("condral focal + knee site → VAS + SANE Joelho", async () => {
    expect(await scheduledScales({
      conditionCode: "CONDRAL_FOCAL",
      productDetails: sites({ localAplicacao: "Intra-articular", guia: "Ultrassom", estruturaAnatomica: "JOELHO" }),
    })).toEqual(["VAS Dor", "SANE Joelho"]);
  });

  it("tendinopatia + Achilles tendon → VAS + SANE Tornozelo e Pé", async () => {
    expect(await scheduledScales({
      conditionCode: "TENDINOPATIA",
      productDetails: sites({ localAplicacao: "Tecido periarticular", estruturaAnatomica: "TENDAO_AQUILES" }),
    })).toEqual(["VAS Dor", "SANE Tornozelo e Pé"]);
  });

  it("legacy compartment 'Tendão patelar' alone identifies the knee", async () => {
    expect(await scheduledScales({
      conditionCode: "TENDINOPATIA",
      productDetails: sites({ localAplicacao: "Tendão patelar", guia: "Ultrassom" }),
    })).toEqual(["VAS Dor", "SANE Joelho"]);
  });

  it("sites in the same SANE region (knee + patella, cervical + lumbar) keep that SANE", async () => {
    expect(await scheduledScales({
      conditionCode: "OSTEOCONDRAL",
      productDetails: sites({ estruturaAnatomica: "JOELHO" }, { estruturaAnatomica: "PATELA" }),
    })).toEqual(["VAS Dor", "SANE Joelho"]);
    expect(await scheduledScales({
      conditionCode: "POS_OPERATORIO",
      productDetails: sites({ estruturaAnatomica: "COLUNA_CERVICAL" }, { estruturaAnatomica: "COLUNA_LOMBAR" }),
    })).toEqual(["VAS Dor", "SANE Coluna"]);
  });

  it("multi-region sites → VAS only", async () => {
    expect(await scheduledScales({
      conditionCode: "CONDRAL_FOCAL",
      productDetails: sites({ estruturaAnatomica: "JOELHO" }, { estruturaAnatomica: "OMBRO" }),
    })).toEqual(["VAS Dor"]);
  });

  it("no site, or an unmapped site → VAS only", async () => {
    expect(await scheduledScales({ conditionCode: "CONDRAL_FOCAL" })).toEqual(["VAS Dor"]);
    expect(await scheduledScales({
      conditionCode: "BURSITE",
      productDetails: sites({ localAplicacao: "Intra-articular", guia: "Ultrassom" }),
    })).toEqual(["VAS Dor"]);
    expect(await scheduledScales({
      conditionCode: "SINOVITE",
      productDetails: sites({ estruturaAnatomica: "JOELHO" }, { estruturaAnatomica: "SACROILIACA" }),
    })).toEqual(["VAS Dor"]);
  });

  it("expanded catalog: Polia A1 → Punho e Mão, Facetária lombar / peridural → Coluna, Sacroilíaca → VAS only", async () => {
    expect(await scheduledScales({
      conditionCode: "TENDINOPATIA",
      productDetails: sites({ localAplicacao: "Tecido periarticular", guia: "Ultrassom", estruturaAnatomica: "MAO_POLIA_A1" }),
    })).toEqual(["VAS Dor", "SANE Punho e Mão"]);
    expect(await scheduledScales({
      conditionCode: "CONDRAL_FOCAL",
      productDetails: sites({ estruturaAnatomica: "COLUNA_FACETARIA_LOMBAR" }, { estruturaAnatomica: "COLUNA_PERIDURAL" }),
    })).toEqual(["VAS Dor", "SANE Coluna"]);
    expect(await scheduledScales({
      conditionCode: "CONDRAL_FOCAL",
      productDetails: sites({ estruturaAnatomica: "SACROILIACA" }),
    })).toEqual(["VAS Dor"]);
    // A legacy code and a new code in the same region still agree.
    expect(await scheduledScales({
      conditionCode: "CONDRAL_FOCAL",
      productDetails: sites({ estruturaAnatomica: "MENISCO" }, { estruturaAnatomica: "JOELHO_MENISCO_LATERAL" }),
    })).toEqual(["VAS Dor", "SANE Joelho"]);
  });

  it("accepts the free-text complement of 'Músculo (especificar)' and rejects a non-string one", async () => {
    expect(await scheduledScales({
      conditionCode: "TENDINOPATIA",
      productDetails: sites({ estruturaAnatomica: "MUSCULO", estruturaAnatomicaDetalhe: "reto femoral" }),
    })).toEqual(["VAS Dor"]);
    const res = await call("/regen/cases", {
      method: "POST",
      body: JSON.stringify({
        patientName: "Paciente Fictício Local",
        conditionCode: "TENDINOPATIA",
        productDetails: { locaisAplicacao: JSON.stringify([{ localAplicacao: "", guia: "", estruturaAnatomica: "MUSCULO", estruturaAnatomicaDetalhe: 3 }]) },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("a condition with a region keeps its own SANE whatever the site", async () => {
    expect(await scheduledScales({
      conditionCode: "OA_OMBRO",
      productDetails: sites({ estruturaAnatomica: "JOELHO" }),
    })).toEqual(["VAS Dor", "SANE Ombro"]);
  });

  it("the patient-scale allowlist is still exactly VAS + the 7 region SANEs", () => {
    expect([...REGEN_PATIENT_SCALES].sort()).toEqual([
      "SANE Coluna", "SANE Cotovelo", "SANE Joelho", "SANE Ombro", "SANE Punho e Mão", "SANE Quadril", "SANE Tornozelo e Pé", "VAS Dor",
    ]);
  });

  it("rejects a malformed anatomical-site value in the application-site extension", async () => {
    const res = await call("/regen/cases", {
      method: "POST",
      body: JSON.stringify({
        patientName: "Paciente Fictício Local",
        conditionCode: "CONDRAL_FOCAL",
        productDetails: { locaisAplicacao: JSON.stringify([{ localAplicacao: "Intra-articular", guia: "", estruturaAnatomica: 7 }]) },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("patient link: condral focal on the knee asks SANE Joelho", () => {
  async function linkFor(caseId: string, periodo: string) {
    const { rows: [n] } = await pool.query(
      `SELECT id FROM regen_followup_notifications WHERE case_id = $1 AND periodo = $2`,
      [caseId, periodo],
    );
    const prepared = await j(await call(`/regen/cases/${caseId}/notifications/${n.id}/prepare-whatsapp`, { method: "POST" }));
    return prepared as { token: string; message: string };
  }

  async function verify(token: string, cpf: string) {
    const res = await fetch(`${baseUrl}/regen-api/patient/regen/${token}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpf }),
    });
    expect(res.status).toBe(200);
    const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
    return { body: await j(res), cookie };
  }

  const submit = (token: string, cookie: string, escala: string, respostas: Record<string, unknown>) =>
    fetch(`${baseUrl}/regen-api/patient/regen/${token}/scale/${encodeURIComponent(escala)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ respostas }),
    });

  it("schedules, shows and scores SANE Joelho end to end", async () => {
    const cpf = fakeCpf();
    const [patient] = await db.insert(patientsTable).values({ doctorId, nome: "Paciente Fictício Condral", cpf }).returning();
    const created = await createCase({
      conditionCode: "CONDRAL_FOCAL",
      patientId: patient.id,
      productDetails: sites({ localAplicacao: "Intra-articular", guia: "Ultrassom", estruturaAnatomica: "JOELHO" }),
    });
    await initNotifications(created.id);
    const { token, message } = await linkFor(created.id, "3 meses");
    expect(message).toContain("SANE Joelho");

    const publicView = await j(await fetch(`${baseUrl}/regen-api/patient/regen/${token}`));
    expect(publicView.scales).toEqual(["VAS Dor", "SANE Joelho"]);
    const { body, cookie } = await verify(token, cpf);
    expect(body.scales).toEqual(["VAS Dor", "SANE Joelho"]);
    expect((await submit(token, cookie, "SANE Ombro", { sane: 50 })).status).toBe(400);
    expect((await submit(token, cookie, "VAS Dor", { vas: 4 })).status).toBe(200);
    const last = await j(await submit(token, cookie, "SANE Joelho", { sane: 60 }));
    expect(last).toMatchObject({ ok: true, allCompleted: true });
  });

  it("existing VAS-only follow-ups pick up the site SANE at read time; completed ones are not reopened", async () => {
    const cpf = fakeCpf();
    const [patient] = await db.insert(patientsTable).values({ doctorId, nome: "Paciente Fictício Legado", cpf }).returning();
    const created = await createCase({ conditionCode: "CONDRAL_FOCAL", patientId: patient.id });
    // Scheduled before any site: VAS only.
    const before = await initNotifications(created.id);
    for (const row of before) expect(row.scales).toEqual(["VAS Dor"]);
    await pool.query(
      `UPDATE regen_followup_notifications SET status = 'completed' WHERE case_id = $1 AND periodo = '1 mês'`,
      [created.id],
    );

    // The doctor records the knee as the application site afterwards.
    const patched = await call(`/regen/cases/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ productDetails: sites({ localAplicacao: "Intra-articular", estruturaAnatomica: "JOELHO" }) }),
    });
    expect(patched.status).toBe(200);

    const list = await j(await call(`/regen/cases/${created.id}/notifications`));
    const byPeriod = Object.fromEntries(list.map((row: { periodo: string; scales: string[] }) => [row.periodo, row.scales]));
    expect(byPeriod["3 meses"]).toEqual(["VAS Dor", "SANE Joelho"]);
    expect(byPeriod["1 mês"]).toEqual(["VAS Dor"]);

    const { token } = await linkFor(created.id, "3 meses");
    const { body, cookie } = await verify(token, cpf);
    expect(body.scales).toEqual(["VAS Dor", "SANE Joelho"]);
    expect((await submit(token, cookie, "VAS Dor", { vas: 5 })).status).toBe(200);
    expect(await j(await submit(token, cookie, "SANE Joelho", { sane: 55 }))).toMatchObject({ allCompleted: true });
    // The completed row records what the patient answered.
    const { rows: [stored] } = await pool.query(
      `SELECT scales, status FROM regen_followup_notifications WHERE case_id = $1 AND periodo = '3 meses'`,
      [created.id],
    );
    expect(stored).toEqual({ scales: ["VAS Dor", "SANE Joelho"], status: "completed" });
  });
});

describe("research export: sane_region follows the same rule", () => {
  // The export is pseudonymized (no case id): rows are matched by content.
  type ResearchRow = Record<string, any>;
  const research = async (qs = ""): Promise<ResearchRow[]> => (await j(await call(`/regen/research${qs}`))).rows;
  const regionsOf = (rows: ResearchRow[], condition: string) =>
    rows.filter((row) => row.condition === condition).map((row) => row.sane_region);

  it("exports the derived SANE key per case", async () => {
    const before = await research();
    await createCase({ conditionCode: "CONDRAL_FOCAL", productDetails: sites({ estruturaAnatomica: "JOELHO" }) });
    await createCase({ conditionCode: "CONDRAL_FOCAL", productDetails: sites({ estruturaAnatomica: "JOELHO" }, { estruturaAnatomica: "PUNHO" }) });
    await createCase({ conditionCode: "OA_OMBRO" });
    const rows = await research();
    const added = (condition: string, region: string | null) =>
      regionsOf(rows, condition).filter((r) => r === region).length - regionsOf(before, condition).filter((r) => r === region).length;
    expect(added("CONDRAL_FOCAL", "sane_joelho")).toBe(1);
    expect(added("CONDRAL_FOCAL", null)).toBe(1);
    expect(added("OA_OMBRO", "sane_ombro")).toBe(1);
    for (const row of rows) {
      expect(row).not.toHaveProperty("product_details");
      expect(row).not.toHaveProperty("id");
    }

    const csv = await (await call(`/regen/research?format=csv`)).text();
    const [header, ...lines] = csv.replace(/^\uFEFF/, "").split("\r\n");
    const cols = header!.split(",");
    expect(cols).toContain("sane_region");
    const shoulder = lines.map((l) => l.split(",")).filter((l) => l[cols.indexOf("condition")] === "OA_OMBRO");
    expect(shoulder.some((l) => l[cols.indexOf("sane_region")] === "sane_ombro")).toBe(true);
    expect(csv).not.toContain("locaisAplicacao");
  });

  it("exports the anatomical labels (catalog labels only, never the free text)", async () => {
    await createCase({ conditionCode: "TENDINOPATIA", productDetails: sites({ estruturaAnatomica: "MAO_POLIA_A1" }) });
    await createCase({ conditionCode: "CONDRAL_FOCAL", productDetails: sites({ estruturaAnatomica: "MENISCO" }, { estruturaAnatomica: "JOELHO_CISTO_BAKER" }) });
    await createCase({
      conditionCode: "TENDINOPATIA",
      productDetails: sites({ estruturaAnatomica: "MUSCULO", estruturaAnatomicaDetalhe: "Texto livre identificável" }),
    });
    await createCase({ conditionCode: "OA_OMBRO" });
    const payload = await j(await call(`/regen/research`));
    const rows: ResearchRow[] = payload.rows;
    // Enough cases in the same demographic group: labels are not suppressed.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const labels = rows.map((row) => [row.condition, row.anatomical_sites, row.sane_region]);
    expect(labels).toContainEqual(["TENDINOPATIA", "Polia A1 (dedo em gatilho)", "sane_punho_mao"]);
    expect(labels).toContainEqual(["CONDRAL_FOCAL", "Menisco; Cisto de Baker", "sane_joelho"]);
    expect(labels).toContainEqual(["TENDINOPATIA", "Músculo (especificar)", null]);
    expect(labels).toContainEqual(["OA_OMBRO", null, "sane_ombro"]);

    const csv = await (await call(`/regen/research?format=csv`)).text();
    const [header, ...lines] = csv.replace(/^\uFEFF/, "").split("\r\n");
    const cols = header!.split(",");
    expect(cols.indexOf("anatomical_sites")).toBe(cols.indexOf("sane_region") + 1);
    expect(lines.some((l) => l.split(",")[cols.indexOf("anatomical_sites")] === "Polia A1 (dedo em gatilho)")).toBe(true);
    expect(csv).not.toContain("Texto livre identificável");
  });
});


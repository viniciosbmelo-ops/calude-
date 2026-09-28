import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, doctorsTable, patientsTable, surgeriesTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorAId: number;
let doctorBId: number;
let patientAId: number;
let authA: string;
let authB: string;
const createdSurgeries: number[] = [];

const geral = {
  positioning: "beach_chair",
  anesthesia: { type: "general_plus_block", block: "interscalene" },
  approach: ["arthroscopic"],
  portals: ["posterior", "anterior"],
  preop_dx: ["SH_BICEPS"],
  postop_dx: ["SH_BICEPS"],
  start_time: "2026-09-23T10:00:00-03:00",
  end_time: "2026-09-23T10:50:00-03:00",
};
const tenodese = { procedure: "tenodesis", tenodesis_site: "suprapectoral_arthroscopic", tenodesis_fixation: "anchor" };

function body(dadosClinicos: unknown, extra: Record<string, unknown> = {}) {
  return {
    patientId: patientAId,
    dataCirurgia: "2026-09-23",
    lado: "Direito",
    hospital: "Hospital Exemplo",
    tipoCaso: "Bíceps e SLAP",
    tiposProcedimento: ["SH_BICEPS_SLAP"],
    ligamentosAcometidos: [],
    diagnostico: "Lesão do cabo longo do bíceps",
    dadosClinicos,
    ...extra,
  };
}

// Respostas da API em testes: JSON sem tipo estático
const json = (r: Response): Promise<any> => r.json();

async function api(path: string, method: string, payload?: unknown, auth = authA): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const suffix = randomUUID();
  const senhaHash = await hashPassword("shoulder-test-password");
  const [a, b] = await db
    .insert(doctorsTable)
    .values([
      { nome: "Dr. Ombro A", email: `ombro-a-${suffix}@example.test`, senhaHash, isFree: true, crm: "13416", crmEstado: "ES" },
      { nome: "Dra. Ombro B", email: `ombro-b-${suffix}@example.test`, senhaHash, isFree: true },
    ])
    .returning();
  doctorAId = a.id;
  doctorBId = b.id;
  const [p] = await db
    .insert(patientsTable)
    .values({ doctorId: doctorAId, nome: "Paciente Ombro", telefone: "5527999999999", numeroRegistro: `PR-${suffix.slice(0, 8)}` })
    .returning();
  patientAId = p.id;
  authA = signToken({ doctorId: doctorAId, isAdmin: false });
  authB = signToken({ doctorId: doctorBId, isAdmin: false });
});

afterAll(async () => {
  if (createdSurgeries.length) await db.delete(surgeriesTable).where(inArray(surgeriesTable.id, createdSurgeries));
  await db.delete(patientsTable).where(eq(patientsTable.id, patientAId));
  await db.delete(doctorsTable).where(inArray(doctorsTable.id, [doctorAId, doctorBId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("cirurgia de ombro e cotovelo", () => {
  let draftId: number;

  it("rascunho aceita registro incompleto e grava região e dados clínicos", async () => {
    const r = await api("/api/surgeries/draft", "POST", body({ regiao: "shoulder", geral: { positioning: "beach_chair" }, procedimentos: [{ tipoCaso: "SH_BICEPS_SLAP", codigo: "SH_BICEPS", dados: {} }] }));
    expect(r.status).toBe(200);
    draftId = (await json(r)).id;
    createdSurgeries.push(draftId);
    const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, draftId));
    expect(row.status).toBe("rascunho");
    expect(row.regiao).toBe("shoulder");
    expect((row.dadosClinicos as any).procedimentos[0]).toMatchObject({ codigo: "SH_BICEPS", sequencia: 1 });
  });

  it("rascunho com forma inválida é recusado com mensagem clara", async () => {
    const r = await api("/api/surgeries/draft", "POST", body({ regiao: "shoulder", procedimentos: [{ tipoCaso: "SH_CUFF", codigo: "EL_DBR", dados: {} }] }, { id: draftId }));
    expect(r.status).toBe(400);
    expect(await json(r)).toMatchObject({ code: "CLINICAL_DATA_INVALID", error: expect.stringMatching(/fora do tipo/) });
  });

  it("finalizar incompleto devolve as pendências por seção", async () => {
    const r = await api(`/api/surgeries/${draftId}/finalize`, "POST", body({ regiao: "shoulder", geral: { positioning: "beach_chair" }, procedimentos: [{ tipoCaso: "SH_BICEPS_SLAP", codigo: "SH_BICEPS", dados: {} }] }));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j.code).toBe("CLINICAL_VALIDATION_FAILED");
    expect(j.details.map((d: any) => d.scope)).toEqual(["geral", "procedimento 1: Lesão do cabo longo do bíceps"]);
    const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, draftId));
    expect(row.status).toBe("rascunho");
  });

  it("finalizar completo grava como completo", async () => {
    const r = await api(`/api/surgeries/${draftId}/finalize`, "POST", body({ regiao: "shoulder", geral, procedimentos: [{ tipoCaso: "SH_BICEPS_SLAP", codigo: "SH_BICEPS", dados: tenodese }], implantes: [{ categoria: "anchor", fabricante: "Fabricante B", modelo: "Âncora tenodese", lote: "L789", quantidade: 1 }] }));
    expect(r.status).toBe(200);
    const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, draftId));
    expect(row.status).toBe("completo");
  });

  it("relatório em texto com paciente, prontuário, cirurgião e procedimento", async () => {
    const r = await api(`/api/surgeries/${draftId}/relatorio`, "GET");
    expect(r.status).toBe(200);
    const { texto, versoesTemplate } = await json(r);
    expect(texto).toMatch(/^DESCRIÇÃO CIRÚRGICA/);
    expect(texto).toMatch(/Paciente: Paciente Ombro — Prontuário PR-/);
    expect(texto).toContain("Cirurgião: Dr. Ombro A (CRM 13416-ES)");
    expect(texto).toContain("Lado: direito");
    expect(texto).toContain("1. Lesão do cabo longo do bíceps");
    expect(texto).toContain("tenodese do cabo longo do bíceps");
    expect(texto).toContain("1× Fabricante B Âncora tenodese — lote L789");
    expect(versoesTemplate).toEqual({ SH_BICEPS: 1 });
  });

  it("outro médico não vê o relatório (404)", async () => {
    expect((await api(`/api/surgeries/${draftId}/relatorio`, "GET", undefined, authB)).status).toBe(404);
  });

  it("criar cirurgia completa sem dados clínicos é recusado", async () => {
    const r = await api("/api/surgeries", "POST", body(undefined));
    expect(r.status).toBe(422);
    expect((await json(r)).code).toBe("CLINICAL_DATA_REQUIRED");
  });

  it("criar cirurgia completa com procedimento de descrição livre", async () => {
    const r = await api("/api/surgeries", "POST", body({ regiao: "shoulder", geral: { ...geral, preop_dx: ["SH_FX_PROX_HUM"], postop_dx: ["SH_FX_PROX_HUM"] }, procedimentos: [{ tipoCaso: "SH_FRACTURE", codigo: "SH_FX_PROX_HUM", dados: { descricao: "Osteossíntese com placa bloqueada." } }] }, { tipoCaso: "Fraturas", tiposProcedimento: ["SH_FRACTURE"] }));
    expect(r.status).toBe(201);
    const id = (await json(r)).id;
    createdSurgeries.push(id);
    const rel = await json(await api(`/api/surgeries/${id}/relatorio`, "GET"));
    expect(rel.texto).toContain("1. Fratura do úmero proximal\nOsteossíntese com placa bloqueada.");
  });

  it("relatório de cirurgia sem dados de ombro responde 409", async () => {
    const [s] = await db.insert(surgeriesTable).values({ doctorId: doctorAId, patientId: patientAId }).returning();
    createdSurgeries.push(s.id);
    expect((await api(`/api/surgeries/${s.id}/relatorio`, "GET")).status).toBe(409);
  });
});

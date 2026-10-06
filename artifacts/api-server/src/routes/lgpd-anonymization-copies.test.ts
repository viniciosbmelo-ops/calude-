/**
 * Anonimização LGPD do paciente alcança as cópias: execuções do apoio à decisão (do paciente e das cirurgias dele)
 * e casos regenerativos vinculados. Trilha de auditoria (algoritmo, hash, opções, escolha) preservada; outro
 * paciente intocado. API real + banco real.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  apoioDecisaoEscolhasTable, apoioDecisaoExecucoesTable, db, doctorsTable, patientsTable,
  regenAiInteractionsTable, regenCasesTable, surgeriesTable,
} from "@workspace/db";
import { decisionRegistry, evaluate } from "@workspace/clinical";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";

let server: Server;
let baseUrl: string;
let doctorId: number;
let auth: string;
let pacienteA: number;
let pacienteB: number;
let cirurgiaA: number;
const execs: { porPaciente?: number; porCirurgia?: number; outro?: number } = {};
const casos: { a?: string; b?: string } = {};

const DBR = decisionRegistry.list().find((a) => a.def.id === "EL_DBR_APOIO")!;
const ENTRADA = {
  tipo_ruptura: "completa", dias_desde_lesao: 5, idade: 70, tabagismo: "atual", diabetes: true,
  membro_dominante: true, demanda_funcional: "alta", dpoc: true,
};
const PERFIL = ["idade", "tabagismo", "diabetes", "membro_dominante", "demanda_funcional"];
const resultado = evaluate(DBR.def, ENTRADA, { hash: DBR.hash, status: "ativo" });
const proveniencia = Object.fromEntries(Object.keys(resultado.entrada).map((k) => [
  k, ["idade", "tabagismo", "diabetes"].includes(k) ? { de: "paciente", caminho: `paciente.${k}` } : { de: "manual" },
]));
const conflitos = [{ entrada: "tabagismo", usado: "atual", origemUsada: "paciente", descartado: "nunca", origemDescartada: "manual" }];

const ANAMNESE = {
  tabagismo: "sim", cigsDay: 20, tabagismo_pack_years: 15, diabetes: true, diabetesTipo: "DM2", diabetes_hba1c: 8.1,
  telefone: "11999990000", nome: "Fulano de Tal", alcool: "social", sono_horas: 7,
  diagnosticosPorRegiao: { joelho_d: { cid: "M17.1", hba1cLab: 8 } },
};

function novaExecucao(patientId: number | null, surgeryId: number | null) {
  return {
    doctorId, patientId, surgeryId,
    algoritmoId: DBR.def.id, algoritmoVersao: DBR.def.versao, algoritmoHash: DBR.hash,
    statusNoMomento: "ativo", motorVersao: resultado.motor, modo: "preop",
    entrada: resultado.entrada, proveniencia, conflitos, parametrosIgnorados: false, resultado,
  };
}

function novoCaso(patientId: number, nome: string) {
  return {
    doctorId, patientId, patientName: nome, patientDob: "1956-03-02", patientSex: "M", patientPhone: "11988887777",
    weightKg: "80", heightCm: "175", conditionCode: "OA_JOELHO", dm: true, hba1c: "8.10", anticoagulant: true,
    ladoArticulacao: "D", plannedProducts: ["PRP"], anamneseRegen: ANAMNESE,
    planoOtimizacao: { notas: "parar de fumar", gerado: `Paciente ${nome}, tabagista, DM2` },
  };
}

beforeAll(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve(s)));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const senhaHash = await hashPassword("anon-copies-test-password");
  const [d] = await db.insert(doctorsTable)
    .values({ nome: "Anon Doctor", email: `anon-copies-${randomUUID()}@example.test`, senhaHash, isFree: true })
    .returning();
  doctorId = d.id;
  auth = signToken({ doctorId, isAdmin: false, sessionVersion: d.sessionVersion });

  const perfil = { tabagismo: "atual", diabetes: true, ladoDominante: "R", nivelAtividade: "competitivo" };
  const [a] = await db.insert(patientsTable).values({ doctorId, nome: "Paciente A", cpf: "52998224725", dataNascimento: "1956-03-02", ...perfil }).returning();
  const [b] = await db.insert(patientsTable).values({ doctorId, nome: "Paciente B", dataNascimento: "1960-01-01", ...perfil }).returning();
  pacienteA = a.id;
  pacienteB = b.id;
  const [s] = await db.insert(surgeriesTable).values({ doctorId, patientId: pacienteA, tiposProcedimento: ["EL_DBR"], status: "rascunho" }).returning();
  cirurgiaA = s.id;

  const [e1] = await db.insert(apoioDecisaoExecucoesTable).values(novaExecucao(pacienteA, null)).returning();
  const [e2] = await db.insert(apoioDecisaoExecucoesTable).values(novaExecucao(null, cirurgiaA)).returning();
  const [e3] = await db.insert(apoioDecisaoExecucoesTable).values(novaExecucao(pacienteB, null)).returning();
  execs.porPaciente = e1.id;
  execs.porCirurgia = e2.id;
  execs.outro = e3.id;
  await db.insert(apoioDecisaoEscolhasTable).values({ execucaoId: e1.id, doctorId, opcao: "reparo_anatomico", concordancia: "concorda" });

  const [ca] = await db.insert(regenCasesTable).values(novoCaso(pacienteA, "Paciente A")).returning();
  const [cb] = await db.insert(regenCasesTable).values(novoCaso(pacienteB, "Paciente B")).returning();
  casos.a = ca.id;
  casos.b = cb.id;
  await db.insert(regenAiInteractionsTable).values([
    { caseId: ca.id, doctorId, model: "m", rawOutput: { summary: "Paciente A, DM2" }, acceptedOutput: { summary: "Paciente A, DM2" } },
    { caseId: cb.id, doctorId, model: "m", rawOutput: { summary: "Paciente B, DM2" }, acceptedOutput: { summary: "Paciente B, DM2" } },
  ]);
});

afterAll(async () => {
  const ids = [casos.a, casos.b].filter((x): x is string => !!x);
  if (ids.length) await db.delete(regenCasesTable).where(inArray(regenCasesTable.id, ids));
  if (doctorId) await db.delete(doctorsTable).where(eq(doctorsTable.id, doctorId));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.sequential("anonimização do paciente: cópias no apoio à decisão e na regenerativa", () => {
  it("anonimiza e conta o que limpou", async () => {
    const res = await fetch(`${baseUrl}/api/lgpd/anonimizar-paciente/${pacienteA}`, {
      method: "POST", headers: { Authorization: `Bearer ${auth}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ execucoesApoioDecisao: 2, casosRegen: 1 });
  });

  it("execuções do paciente e da cirurgia dele perdem o perfil; hash, versão, opções e escolha ficam", async () => {
    const rows = await db.select().from(apoioDecisaoExecucoesTable)
      .where(inArray(apoioDecisaoExecucoesTable.id, [execs.porPaciente!, execs.porCirurgia!]));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      const res = r.resultado as Record<string, unknown>;
      for (const c of PERFIL) {
        expect(r.entrada).not.toHaveProperty(c);
        expect(r.proveniencia).not.toHaveProperty(c);
        expect(res["entrada"]).not.toHaveProperty(c);
        for (const t of res["trace"] as { valores: object }[]) expect(t.valores).not.toHaveProperty(c);
      }
      expect(r.conflitos).toEqual([]);
      expect(JSON.stringify(r)).not.toContain("70 anos");
      expect(r.entrada).toMatchObject({ tipo_ruptura: "completa", dias_desde_lesao: 5, dpoc: true });
      expect(r).toMatchObject({
        algoritmoId: DBR.def.id, algoritmoVersao: DBR.def.versao, algoritmoHash: DBR.hash,
        motorVersao: resultado.motor, statusNoMomento: "ativo", modo: "preop",
      });
      expect(res).toMatchObject({ anonimizado: true, algoritmo: resultado.algoritmo });
      expect(typeof res["anonimizadoEm"]).toBe("string");
      const op = (x: unknown) => (x as typeof resultado.opcoes).map((o) => [o.opcao, o.forca, o.sentido]);
      expect(op(res["opcoes"])).toEqual(op(resultado.opcoes));
    }
    const [escolha] = await db.select().from(apoioDecisaoEscolhasTable).where(eq(apoioDecisaoEscolhasTable.execucaoId, execs.porPaciente!));
    expect(escolha).toMatchObject({ opcao: "reparo_anatomico", concordancia: "concorda" });
  });

  it("caso regenerativo do paciente: identificação, tabagismo e diabetes limpos; dados do procedimento ficam", async () => {
    const [c] = await db.select().from(regenCasesTable).where(eq(regenCasesTable.id, casos.a!));
    expect(c.patientName).toMatch(/^Paciente Anonimizado #/);
    expect(c).toMatchObject({ patientDob: null, patientPhone: null, dm: null, hba1c: null });
    expect(c.anamneseRegen).toEqual({ alcool: "social", sono_horas: 7, diagnosticosPorRegiao: { joelho_d: { cid: "M17.1" } } });
    expect(c.planoOtimizacao).toEqual({});
    expect(c).toMatchObject({ conditionCode: "OA_JOELHO", ladoArticulacao: "D", plannedProducts: ["PRP"], patientSex: "M", anticoagulant: true });
    const [ia] = await db.select().from(regenAiInteractionsTable).where(eq(regenAiInteractionsTable.caseId, casos.a!));
    expect(ia.rawOutput).toMatchObject({ anonimizado: true });
    expect(JSON.stringify(ia)).not.toContain("Paciente A");
  });

  it("outro paciente intocado", async () => {
    const [e] = await db.select().from(apoioDecisaoExecucoesTable).where(eq(apoioDecisaoExecucoesTable.id, execs.outro!));
    expect(e.entrada).toEqual(resultado.entrada);
    expect(e.resultado).toEqual(resultado);
    expect(e.conflitos).toEqual(conflitos);
    const [c] = await db.select().from(regenCasesTable).where(eq(regenCasesTable.id, casos.b!));
    expect(c).toMatchObject({ patientName: "Paciente B", patientDob: "1956-03-02", patientPhone: "11988887777", dm: true, hba1c: "8.10" });
    expect(c.anamneseRegen).toEqual(ANAMNESE);
    const [ia] = await db.select().from(regenAiInteractionsTable).where(eq(regenAiInteractionsTable.caseId, casos.b!));
    expect(ia.rawOutput).toEqual({ summary: "Paciente B, DM2" });
    const [p] = await db.select().from(patientsTable).where(eq(patientsTable.id, pacienteB));
    expect(p).toMatchObject({ nome: "Paciente B", tabagismo: "atual", diabetes: true });
  });
});

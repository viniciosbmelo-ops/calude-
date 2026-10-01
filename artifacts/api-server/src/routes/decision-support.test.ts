import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  apoioDecisaoEscolhasTable,
  apoioDecisaoExecucoesTable,
  apoioDecisaoStatusTable,
  doctorsTable,
  featureFlagsTable,
  patientsTable,
  surgeriesTable,
} from "@workspace/db";
import {
  algorithmKey,
  createDecisionRegistry,
  evaluate,
  hashDefinition,
  type AlgorithmDef,
} from "@workspace/clinical";
import app from "../app";
import { hashPassword, signToken } from "../lib/auth";
import { APOIO_DECISAO_FLAG, createDecisionSupportRouter } from "./decision-support";

// Algoritmo FALSO, só de teste (nomes não clínicos; PMID/DOI fictícios).
const ALG_ID = `TESTE_API_${randomUUID().slice(0, 8)}`;
function fakeDef(versao: string, extra = ""): AlgorithmDef {
  return {
    id: ALG_ID,
    versao,
    patologias: [],
    titulo: `Exemplo de teste ${versao}${extra}`,
    escopo: "Somente testes da API.",
    foraDeEscopo: [],
    entradas: [
      { id: "temperatura", rotulo: "Temperatura", def: { tipo: "numero", unidade: "°C", min: -30, max: 50 }, origem: { de: "manual" }, momento: "preop" },
      { id: "solo", rotulo: "Solo", def: { tipo: "enum", valores: ["seco", "umido"] }, origem: { de: "manual" }, momento: "preop" },
    ],
    opcoes: [{ id: "regar", rotulo: "Regar" }, { id: "esperar", rotulo: "Esperar" }],
    regras: [
      {
        id: "R.CALOR", titulo: "Calor",
        quando: { all: [{ campo: "temperatura", op: ">=", valor: 30 }, { campo: "solo", op: "==", valor: "seco" }] },
        efeitos: [{ opcao: "regar", efeito: "favorece", forca: "moderada" }],
        motivo: "Temperatura {temperatura}.",
        referencias: [{ ref: "Alfa2001" }],
      },
    ],
    referencias: [{ id: "Alfa2001", citacao: "Alfa A. Fictícia. Rev Teste. 2001;1:1.", pmid: "11111111", nivel: "III", tipo: "coorte" }],
    avisosGerais: ["Exemplo fictício."],
    referenciasGerais: [],
  };
}
const V1 = fakeDef("1.0.0");
const V2 = fakeDef("2.0.0");
const V3_STALE = fakeDef("3.0.0");
const LOCK = {
  [algorithmKey(V1)]: hashDefinition(V1),
  [algorithmKey(V2)]: hashDefinition(V2),
  // Lock gravado para um conteúdo anterior: o código mudou sem subir a versão
  [algorithmKey(V3_STALE)]: hashDefinition(fakeDef("3.0.0", " (antigo)")),
};
const registry = createDecisionRegistry([V1, V2, V3_STALE], LOCK);

let fullServer: Server;
let server: Server;
let fullUrl: string;
let baseUrl: string;
let doctorId: number;
let otherDoctorId: number;
let adminId: number;
let patientId: number;
let otherPatientId: number;
let surgeryId: number;
let authDoctor: string;
let authOther: string;
let authAdmin: string;
let flagBefore: { id: number; enabled: boolean } | undefined;

async function listen(a: express.Express): Promise<[Server, string]> {
  const s = await new Promise<Server>((resolve, reject) => {
    const srv = a.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve(srv)));
  });
  return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };

async function call(path: string, method: string, token: string | null, body?: unknown, url = baseUrl): Promise<JsonResponse> {
  return fetch(`${url}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setFlag(enabled: boolean): Promise<void> {
  const [row] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, APOIO_DECISAO_FLAG));
  if (row) await db.update(featureFlagsTable).set({ enabled }).where(eq(featureFlagsTable.id, row.id));
  else await db.insert(featureFlagsTable).values({ key: APOIO_DECISAO_FLAG, enabled });
}

const avaliar = (versao: string) => `/api/apoio-decisao/algoritmos/${ALG_ID}/${versao}/avaliar`;
const statusPath = (versao: string) => `/api/apoio-decisao/algoritmos/${ALG_ID}/${versao}/status`;

beforeAll(async () => {
  [fullServer, fullUrl] = await listen(app);
  const mini = express();
  mini.use(express.json());
  mini.use("/api", createDecisionSupportRouter(registry));
  [server, baseUrl] = await listen(mini);

  const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, APOIO_DECISAO_FLAG));
  flagBefore = flag ? { id: flag.id, enabled: flag.enabled } : undefined;
  await setFlag(false);

  const suffix = randomUUID();
  const senhaHash = await hashPassword("decision-support-test-password");
  const [d, o, a] = await db
    .insert(doctorsTable)
    .values([
      { nome: "DS Doctor", email: `ds-doctor-${suffix}@example.test`, senhaHash, isFree: true },
      { nome: "DS Other", email: `ds-other-${suffix}@example.test`, senhaHash, isFree: true },
      { nome: "DS Admin", email: `ds-admin-${suffix}@example.test`, senhaHash, isFree: true, isAdmin: true },
    ])
    .returning();
  doctorId = d.id;
  otherDoctorId = o.id;
  adminId = a.id;
  const [p, op] = await db
    .insert(patientsTable)
    .values([{ doctorId, nome: "DS Patient" }, { doctorId: otherDoctorId, nome: "DS Other Patient" }])
    .returning();
  patientId = p.id;
  otherPatientId = op.id;
  const [s] = await db.insert(surgeriesTable).values({ doctorId, patientId, regiao: "shoulder" }).returning();
  surgeryId = s.id;
  authDoctor = signToken({ doctorId, isAdmin: false, sessionVersion: d.sessionVersion });
  authOther = signToken({ doctorId: otherDoctorId, isAdmin: false, sessionVersion: o.sessionVersion });
  authAdmin = signToken({ doctorId: adminId, isAdmin: true, sessionVersion: a.sessionVersion });
});

afterAll(async () => {
  await db.delete(apoioDecisaoStatusTable).where(eq(apoioDecisaoStatusTable.algoritmoId, ALG_ID));
  const ids = [doctorId, otherDoctorId, adminId].filter(Boolean);
  if (ids.length) await db.delete(doctorsTable).where(inArray(doctorsTable.id, ids));
  if (flagBefore) await db.update(featureFlagsTable).set({ enabled: flagBefore.enabled }).where(eq(featureFlagsTable.id, flagBefore.id));
  else await db.delete(featureFlagsTable).where(eq(featureFlagsTable.key, APOIO_DECISAO_FLAG));
  for (const s of [server, fullServer]) {
    await new Promise<void>((resolve, reject) => s.close((error) => (error ? reject(error) : resolve())));
  }
});

describe.sequential("apoio à decisão: API", () => {
  let execucaoId: number;

  it("está montada no app real, exige login e, com a flag desligada, não mostra nada a quem não é admin", async () => {
    expect((await call("/api/apoio-decisao/algoritmos", "GET", null, undefined, fullUrl)).status).toBe(401);
    const res = await call("/api/apoio-decisao/algoritmos", "GET", authDoctor, undefined, fullUrl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moduloAtivo: false, algoritmos: [] });
  });

  it("todo algoritmo começa como rascunho, visível só ao admin", async () => {
    const doc = await (await call("/api/apoio-decisao/algoritmos", "GET", authDoctor)).json();
    expect(doc).toEqual({ moduloAtivo: false, algoritmos: [] });
    const adm = await (await call("/api/apoio-decisao/algoritmos", "GET", authAdmin)).json();
    expect(adm.algoritmos.map((a: { versao: string; status: string; hashConfereLock: boolean }) => [a.versao, a.status, a.hashConfereLock]))
      .toEqual([["1.0.0", "rascunho", true], ["2.0.0", "rascunho", true], ["3.0.0", "rascunho", false]]);
    expect(adm.algoritmos[0].hash).toBe(hashDefinition(V1));
    expect(adm.algoritmos[0].definicao.id).toBe(ALG_ID);
  });

  it("médico não avalia rascunho; admin avalia em modo revisão, sem vínculo com paciente", async () => {
    expect((await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: {}, modo: "preop" })).status).toBe(404);
    const res = await call(avaliar("1.0.0"), "POST", authAdmin, { entrada: { temperatura: 35, solo: "seco" }, modo: "preop" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.modo).toBe("revisao");
    expect(body.resultado.algoritmo.status).toBe("rascunho");
    const linked = await call(avaliar("1.0.0"), "POST", authAdmin, { entrada: {}, modo: "preop", patientId });
    expect(linked.status).toBe(422);
    expect((await linked.json()).code).toBe("REVIEW_RUN_NOT_LINKABLE");
    const choice = await call(`/api/apoio-decisao/execucoes/${body.execucaoId}/escolha`, "POST", authAdmin, { opcao: "regar" });
    expect(choice.status).toBe(409);
  });

  it("mudança de status: só admin, recusa hash divergente, lock desatualizado e transição inválida", async () => {
    const h1 = hashDefinition(V1);
    expect((await call(statusPath("1.0.0"), "POST", authDoctor, { status: "revisado", hash: h1 })).status).toBe(403);
    const wrong = await call(statusPath("1.0.0"), "POST", authAdmin, { status: "revisado", hash: "0".repeat(64) });
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).code).toBe("HASH_MISMATCH");
    const stale = await call(statusPath("3.0.0"), "POST", authAdmin, { status: "revisado", hash: hashDefinition(V3_STALE) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("LOCK_MISMATCH");
    const skip = await call(statusPath("1.0.0"), "POST", authAdmin, { status: "ativo", hash: h1 });
    expect(skip.status).toBe(422);
    expect((await skip.json()).code).toBe("INVALID_TRANSITION");
    expect((await call(statusPath("9.9.9"), "POST", authAdmin, { status: "revisado", hash: h1 })).status).toBe(404);
  });

  it("rascunho → revisado → ativo, com histórico só de inserção", async () => {
    const h1 = hashDefinition(V1);
    const r1 = await call(statusPath("1.0.0"), "POST", authAdmin, { status: "revisado", hash: h1, nota: "Casos revisados." });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toMatchObject({ status: "revisado", anterior: "rascunho", aposentadas: [] });
    const r2 = await call(statusPath("1.0.0"), "POST", authAdmin, { status: "ativo", hash: h1 });
    expect(r2.status).toBe(201);
    expect(await r2.json()).toMatchObject({ status: "ativo", anterior: "revisado", hash: h1 });
    const rows = await db.select().from(apoioDecisaoStatusTable).where(eq(apoioDecisaoStatusTable.algoritmoId, ALG_ID));
    expect(rows.map((r) => r.status)).toEqual(["revisado", "ativo"]);
    expect(rows.every((r) => r.doctorId === adminId && r.algoritmoHash === h1)).toBe(true);
  });

  it("ativo, mas com a flag desligada: continua invisível para quem não é admin", async () => {
    expect((await (await call("/api/apoio-decisao/algoritmos", "GET", authDoctor)).json()).algoritmos).toEqual([]);
    expect((await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: {}, modo: "preop" })).status).toBe(404);
  });

  it("com a flag ligada, o médico vê só a versão ativa", async () => {
    await setFlag(true);
    const doc = await (await call("/api/apoio-decisao/algoritmos", "GET", authDoctor)).json();
    expect(doc.moduloAtivo).toBe(true);
    expect(doc.algoritmos.map((a: { versao: string; status: string }) => [a.versao, a.status])).toEqual([["1.0.0", "ativo"]]);
    expect((await call(avaliar("2.0.0"), "POST", authDoctor, { entrada: {}, modo: "preop" })).status).toBe(404);
  });

  it("avalia no servidor, ignora o resultado do cliente e grava a execução vinculada à cirurgia", async () => {
    const entrada = { temperatura: 35, solo: "seco" };
    const res = await call(avaliar("1.0.0"), "POST", authDoctor, {
      entrada, modo: "preop", surgeryId,
      resultado: { rotulo: "Forjado", opcoes: [{ opcao: "esperar", forca: "forte" }] },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    execucaoId = body.execucaoId;
    const esperado = evaluate(V1, entrada, { status: "ativo", hash: hashDefinition(V1), modo: "preop" });
    expect(body).toEqual({ execucaoId, modo: "preop", resultado: esperado });
    expect(body.resultado.rotulo).toBe("Sugestão");

    const [row] = await db.select().from(apoioDecisaoExecucoesTable).where(eq(apoioDecisaoExecucoesTable.id, execucaoId));
    expect(row).toMatchObject({
      doctorId, patientId, surgeryId, algoritmoId: ALG_ID, algoritmoVersao: "1.0.0", algoritmoHash: hashDefinition(V1),
      statusNoMomento: "ativo", modo: "preop", entrada, proveniencia: { temperatura: "manual", solo: "manual" },
    });
    expect(row.resultado).toEqual(esperado);
  });

  it("entrada ausente fica indeterminada; entrada implausível ou desconhecida é recusada", async () => {
    const res = await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: { solo: "seco" }, modo: "registro", patientId });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.resultado.opcoes).toEqual([]);
    expect(body.resultado.faltantes).toEqual([{ entrada: "temperatura", rotulo: "Temperatura", unidade: "°C", desbloqueia: ["R.CALOR"] }]);
    const bad = await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: { temperatura: 99 }, modo: "preop" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "DS_OUT_OF_RANGE", field: "temperatura" });
    const unknown = await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: { umidade: 1 }, modo: "preop" });
    expect(unknown.status).toBe(422);
    expect((await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: {}, modo: "outro" })).status).toBe(400);
  });

  it("posse: paciente ou cirurgia de outro médico não são vinculáveis", async () => {
    expect((await call(avaliar("1.0.0"), "POST", authOther, { entrada: {}, modo: "preop", patientId })).status).toBe(404);
    expect((await call(avaliar("1.0.0"), "POST", authOther, { entrada: {}, modo: "preop", surgeryId })).status).toBe(404);
    const mismatch = await call(avaliar("1.0.0"), "POST", authDoctor, { entrada: {}, modo: "preop", surgeryId, patientId: otherPatientId });
    expect(mismatch.status).toBe(422);
  });

  it("registra a escolha do cirurgião com concordância calculada no servidor", async () => {
    const path = `/api/apoio-decisao/execucoes/${execucaoId}/escolha`;
    const ok = await call(path, "POST", authDoctor, { opcao: "regar", concordancia: "diverge" });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ execucaoId, opcao: "regar", outra: null, concordancia: "concorda", justificativa: null });
    const div = await call(path, "POST", authDoctor, { opcao: "esperar", justificativa: "Preferência do paciente." });
    expect(await div.json()).toMatchObject({ opcao: "esperar", concordancia: "diverge", justificativa: "Preferência do paciente." });
    const outra = await call(path, "POST", authDoctor, { outra: "Adiar uma semana" });
    expect(await outra.json()).toMatchObject({ opcao: null, outra: "Adiar uma semana", concordancia: "diverge" });

    expect((await call(path, "POST", authDoctor, { opcao: "regar", outra: "x" })).status).toBe(400);
    expect((await call(path, "POST", authDoctor, {})).status).toBe(400);
    expect((await call(path, "POST", authDoctor, { opcao: "replantar" })).status).toBe(422);
    expect((await call(path, "POST", authOther, { opcao: "regar" })).status).toBe(404);
    const rows = await db.select().from(apoioDecisaoEscolhasTable).where(eq(apoioDecisaoEscolhasTable.execucaoId, execucaoId));
    expect(rows).toHaveLength(3);
  });

  it("ativar outra versão aposenta a anterior", async () => {
    const h2 = hashDefinition(V2);
    await call(statusPath("2.0.0"), "POST", authAdmin, { status: "revisado", hash: h2 });
    const res = await call(statusPath("2.0.0"), "POST", authAdmin, { status: "ativo", hash: h2 });
    expect(res.status).toBe(201);
    expect((await res.json()).aposentadas).toEqual(["1.0.0"]);
    const doc = await (await call("/api/apoio-decisao/algoritmos", "GET", authDoctor)).json();
    expect(doc.algoritmos.map((a: { versao: string }) => a.versao)).toEqual(["2.0.0"]);
    const adm = await (await call("/api/apoio-decisao/algoritmos", "GET", authAdmin)).json();
    expect(adm.algoritmos.find((a: { versao: string }) => a.versao === "1.0.0").status).toBe("aposentado");
  });

  it("histórico de status: só admin, mais recente primeiro, com o hash de cada linha", async () => {
    expect((await call(statusPath("1.0.0"), "GET", authDoctor)).status).toBe(403);
    const res = await call(statusPath("1.0.0"), "GET", authAdmin);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ algoritmoId: ALG_ID, versao: "1.0.0", hashCodigo: hashDefinition(V1), hashLock: hashDefinition(V1) });
    expect(body.historico.map((h: { status: string }) => h.status)).toEqual(["aposentado", "ativo", "revisado"]);
    expect(body.historico.every((h: { hashConfereCodigo: boolean; doctorId: number }) => h.hashConfereCodigo && h.doctorId === adminId)).toBe(true);
    expect(body.historico[2].nota).toBe("Casos revisados.");
    const vazio = await (await call(statusPath("3.0.0"), "GET", authAdmin)).json();
    expect(vazio).toMatchObject({ hashLock: LOCK[algorithmKey(V3_STALE)], historico: [] });
    expect((await call(statusPath("9.9.9"), "GET", authAdmin)).status).toBe(404);
  });

  it("lista as execuções da cirurgia com a última escolha, só para o dono", async () => {
    const path = `/api/apoio-decisao/cirurgias/${surgeryId}/execucoes`;
    expect((await call(path, "GET", null, undefined, fullUrl)).status).toBe(401);
    expect((await call(path, "GET", authOther)).status).toBe(404);
    expect((await call("/api/apoio-decisao/cirurgias/abc/execucoes", "GET", authDoctor)).status).toBe(400);
    const res = await call(path, "GET", authDoctor);
    expect(res.status).toBe(200);
    const { execucoes } = await res.json();
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]).toMatchObject({
      execucaoId, algoritmoId: ALG_ID, versao: "1.0.0", hash: hashDefinition(V1), statusNoMomento: "ativo", modo: "preop",
      escolha: { execucaoId, opcao: null, outra: "Adiar uma semana", concordancia: "diverge" },
    });
    expect(execucoes[0].resultado.rotulo).toBe("Sugestão");
  });

  it("excluir o paciente apaga as execuções e escolhas (cascade)", async () => {
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    expect(await db.select().from(apoioDecisaoExecucoesTable).where(eq(apoioDecisaoExecucoesTable.id, execucaoId))).toEqual([]);
    expect(await db.select().from(apoioDecisaoEscolhasTable).where(eq(apoioDecisaoEscolhasTable.execucaoId, execucaoId))).toEqual([]);
  });
});

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
    const r = await api("/api/surgeries", "POST", body({ regiao: "shoulder", geral: { ...geral, preop_dx: ["SH_FX_PROX_HUM"], postop_dx: ["SH_FX_PROX_HUM"] }, procedimentos: [{ tipoCaso: "SH_FRACTURE", codigo: "SH_FX_PROX_HUM", dados: { descricao: "Osteossíntese com placa bloqueada." } }] }, { tipoCaso: "Fratura", tiposProcedimento: ["SH_FRACTURE"] }));
    expect(r.status).toBe(201);
    const id = (await json(r)).id;
    createdSurgeries.push(id);
    const rel = await json(await api(`/api/surgeries/${id}/relatorio`, "GET"));
    expect(rel.texto).toContain("1. Fratura do úmero proximal\nOsteossíntese com placa bloqueada.");
  });

  const elbowGeral = {
    positioning: "supine_arm_table",
    anesthesia: { type: "general_plus_block", block: "supraclavicular" },
    approach: ["anterior_elbow_single_incision"],
    preop_dx: ["EL_DBR"],
    postop_dx: ["EL_DBR"],
  };
  const dbr = { tear: "complete", days_since_injury: 5, procedure: "single_incision_repair", fixation: ["cortical_button"] };
  const elbowBody = (dc: Record<string, unknown>) =>
    body({ regiao: "elbow", procedimentos: [{ tipoCaso: "EL_DISTAL_BICEPS", codigo: "EL_DBR", dados: dbr }], ...dc }, { tipoCaso: "Bíceps Distal", tiposProcedimento: ["EL_DISTAL_BICEPS"], diagnostico: "Rotura do bíceps distal" });

  it("cotovelo: via, portal e ângulo de ombro são recusados na gravação", async () => {
    const r = await api("/api/surgeries", "POST", elbowBody({ geral: { ...elbowGeral, approach: ["deltopectoral"], portals: ["neviaser", "posterolateral"], beach_chair_angle_deg: 60 } }));
    expect(r.status).toBe(422);
    const j = await json(r);
    expect(j.details[0].scope).toBe("geral");
    expect(j.details[0].issues.map((i: any) => i.field)).toEqual(["approach", "portals", "beach_chair_angle_deg", "portals"]);
  });

  it("cotovelo aberto: inventário artroscópico é recusado na gravação", async () => {
    const r = await api("/api/surgeries", "POST", elbowBody({ geral: elbowGeral, mapaArtroscopico: [{ structure_code: "EL_RH", status: "normal" }] }));
    expect(r.status).toBe(422);
    expect((await json(r)).details.map((d: any) => d.scope)).toEqual(["inventário artroscópico"]);
  });

  it("cotovelo aberto com botão cortical: categoria preservada e relatório sem inventário artroscópico", async () => {
    const implantes = [{ categoria: "button", fabricante: "Fabricante C", modelo: "Botão cortical", quantidade: 1 }];
    const r = await api("/api/surgeries", "POST", elbowBody({ geral: elbowGeral, implantes }));
    expect(r.status).toBe(201);
    const id = (await json(r)).id;
    createdSurgeries.push(id);
    const got = await json(await api(`/api/surgeries/${id}`, "GET"));
    expect(got.dadosClinicos.implantes).toEqual(implantes);
    // Registro antigo gravado com estruturas "normais" em cirurgia aberta (botão "Marcar restantes como normais")
    const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, id));
    await db.update(surgeriesTable).set({ dadosClinicos: { ...(row.dadosClinicos as any), mapaArtroscopico: [{ structure_code: "EL_RH", status: "normal" }] } }).where(eq(surgeriesTable.id, id));
    const rel = await api(`/api/surgeries/${id}/relatorio`, "GET");
    expect(rel.status).toBe(200);
    const { texto } = await json(rel);
    expect(texto).not.toContain("INVENTÁRIO ARTROSCÓPICO");
    expect(texto).not.toContain("Sem alterações");
    expect(texto).toContain("Via de acesso: anterior em incisão única.");
  });

  describe("avaliação pré-operatória (payload v2)", () => {
    const preop = {
      comum: { data_avaliacao: "2026-09-01", lado_dominante: "R", tabagismo: "nunca", diabetes: false, nivel_atividade: "recreativo" },
      patologias: [{ codigo: "SH_BICEPS", dados: {} }],
    };
    const fxPreop = {
      comum: { data_avaliacao: "2026-09-20", lado_dominante: "L", nivel_atividade: "sedentario" },
      patologias: [{ codigo: "SH_FX_PROX_HUM", dados: { neer_partes: 3, desvio_tuberosidade_maior_mm: 6, dobradica_medial_desviada_mm: 2, asa: 3, cognicao_preservada: true } }],
    };
    const fxBody = (avaliacaoPreop: unknown) =>
      body(
        { regiao: "shoulder", geral: { ...geral, preop_dx: ["SH_FX_PROX_HUM"], postop_dx: ["SH_FX_PROX_HUM"] }, procedimentos: [{ tipoCaso: "SH_FRACTURE", codigo: "SH_FX_PROX_HUM", dados: { descricao: "Osteossíntese com placa bloqueada." } }], avaliacaoPreop },
        { tipoCaso: "Fratura", tiposProcedimento: ["SH_FRACTURE"] },
      );
    let preopDraftId: number;

    it("rascunho grava o bloco pré-operatório com o schema do catálogo", async () => {
      const r = await api("/api/surgeries/draft", "POST", fxBody({ ...fxPreop, patologias: [{ ...fxPreop.patologias[0], dados: { neer_partes: 7 } }] }));
      expect(r.status).toBe(200);
      preopDraftId = (await json(r)).id;
      createdSurgeries.push(preopDraftId);
      const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, preopDraftId));
      expect((row.dadosClinicos as any).versao).toBe(2);
      expect((row.dadosClinicos as any).avaliacaoPreop.patologias[0]).toEqual({ codigo: "SH_FX_PROX_HUM", schema: "SH_FX_PROX_HUM.diagnosis.v1", dados: { neer_partes: 7 } });
    });

    it("rascunho recusa sub-bloco de patologia sem avaliação estruturada", async () => {
      const r = await api("/api/surgeries/draft", "POST", fxBody(preop), authA);
      expect(r.status).toBe(400);
      expect(await json(r)).toMatchObject({ code: "CLINICAL_DATA_INVALID", error: expect.stringMatching(/não tem avaliação pré-operatória/) });
    });

    it("finalizar com valor fora da faixa devolve a pendência no escopo pré-operatório", async () => {
      const bad = { ...fxPreop, comum: { ...fxPreop.comum, nivel_atividade: "elite" }, patologias: [{ codigo: "SH_FX_PROX_HUM", dados: { neer_partes: 5, desvio_tuberosidade_maior_mm: -1 } }] };
      const r = await api(`/api/surgeries/${preopDraftId}/finalize`, "POST", fxBody(bad));
      expect(r.status).toBe(422);
      const j = await json(r);
      expect(j.details.map((d: any) => d.scope)).toEqual(["avaliação pré-operatória", "avaliação pré-operatória: Fratura do úmero proximal"]);
      expect(j.details[1].issues.map((i: any) => i.field)).toEqual(expect.arrayContaining(["neer_partes", "desvio_tuberosidade_maior_mm"]));
      const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, preopDraftId));
      expect(row.status).toBe("rascunho");
    });

    it("finalizar válido grava o bloco, e o relatório não traz dados pré-operatórios", async () => {
      const r = await api(`/api/surgeries/${preopDraftId}/finalize`, "POST", fxBody(fxPreop));
      expect(r.status).toBe(200);
      const got = await json(await api(`/api/surgeries/${preopDraftId}`, "GET"));
      expect(got.status).toBe("completo");
      expect(got.dadosClinicos.avaliacaoPreop).toEqual({ comum: fxPreop.comum, patologias: [{ ...fxPreop.patologias[0], schema: "SH_FX_PROX_HUM.diagnosis.v1" }] });
      const rel = await json(await api(`/api/surgeries/${preopDraftId}/relatorio`, "GET"));
      expect(rel.texto).toContain("1. Fratura do úmero proximal\nOsteossíntese com placa bloqueada.");
      expect(rel.texto).not.toMatch(/Neer|pré-operatória|dominante|ASA/);
    });

    it("registro v1 já gravado (sem versão nem bloco) continua gerando relatório", async () => {
      const [row] = await db.select().from(surgeriesTable).where(eq(surgeriesTable.id, preopDraftId));
      const { avaliacaoPreop: _a, ...v1 } = row.dadosClinicos as any;
      await db.update(surgeriesTable).set({ dadosClinicos: { ...v1, versao: 1 } }).where(eq(surgeriesTable.id, preopDraftId));
      const rel = await api(`/api/surgeries/${preopDraftId}/relatorio`, "GET");
      expect(rel.status).toBe(200);
      expect((await json(rel)).texto).toContain("1. Fratura do úmero proximal");
    });

    it("criar cirurgia completa com bloco pré-operatório de bíceps distal", async () => {
      const avaliacaoPreop = { patologias: [{ codigo: "EL_DBR", dados: { tipo_rm: "completa", retracao_cm_rm: 3, hook_test: true, uso_anabolizantes: false } }] };
      const r = await api("/api/surgeries", "POST", elbowBody({ geral: elbowGeral, avaliacaoPreop }));
      expect(r.status).toBe(201);
      const id = (await json(r)).id;
      createdSurgeries.push(id);
      const got = await json(await api(`/api/surgeries/${id}`, "GET"));
      expect(got.dadosClinicos.avaliacaoPreop.patologias[0]).toMatchObject({ codigo: "EL_DBR", schema: "EL_DBR.diagnosis.v1", dados: avaliacaoPreop.patologias[0].dados });
    });
  });

  it("relatório de cirurgia sem dados de ombro responde 409", async () => {
    const [s] = await db.insert(surgeriesTable).values({ doctorId: doctorAId, patientId: patientAId }).returning();
    createdSurgeries.push(s.id);
    expect((await api(`/api/surgeries/${s.id}/relatorio`, "GET")).status).toBe(409);
  });
});

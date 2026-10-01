/**
 * Pré-preenchimento da interface × mapeamento do servidor: para cada algoritmo registrado e um payload
 * de exemplo, as entradas que os dois preenchem têm o mesmo valor. Se um caminho declarado (`origem.caminho`)
 * divergir do campo que o mapeador lê, este teste falha.
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_ALGORITHMS, algorithmKey, decisionRegistry, montarEntrada, type ClinicalPayload, type PerfilClinicoPaciente,
} from "@workspace/clinical/web";
import { buildEntrada, prefillFromRegistro } from "./logic";

type Payload = Pick<ClinicalPayload, "avaliacaoPreop">;
interface Amostra { payload: Payload; paciente?: PerfilClinicoPaciente }

const bloco = (codigo: string, schema: string, dados: Record<string, unknown>, paciente?: PerfilClinicoPaciente): Amostra => ({
  payload: { avaliacaoPreop: { comum: { data_avaliacao: "2026-03-10" }, patologias: [{ codigo, schema, dados }] } },
  ...(paciente ? { paciente } : {}),
});

/**
 * Payloads de exemplo por id de algoritmo (campos dos schemas de diagnóstico e PREOP_COMMON) e cadastro do paciente
 * (lado dominante, tabagismo, diabetes, nível de atividade).
 */
const AMOSTRAS: Record<string, Amostra> = {
  SH_INST_ANT: bloco("SH_INST_ANT", "SH_INST_ANT.diagnosis.v2", {
    episodes: "2_to_5", prior_surgery: "none", voluntary: false, sport_competitive: true, sport_contact_or_forced_overhead: false,
    hyperlaxity: false, n_luxacoes: 3, meses_desde_primeiro_episodio: 14, epilepsy: false, soft_tissue_lesions: ["bankart", "alpsa"],
    D_mm: 28, d_mm: 4.2, hsi_mm: 20,
  }),
  SH_RCT_DECISAO: bloco("SH_RCT_FULL", "SH_RCT.diagnosis.v1", {
    inicio: "degenerativo", semanas_desde_lesao: 30, tipo_rotura_rm: "completa", ellman_rm: 2, tendoes_rm: ["SSP", "ISP"],
    tamanho_ap_mm_rm: 32, retracao_patte_rm: 2, goutallier: { SSP: 2, ISP: 3, SSC: 1, TM: 0 }, tangent_sign: true, hamada: 2,
    distancia_acromioumeral_mm: 7.5, pseudoparalisia: false, elevacao_ativa_graus: 150, elevacao_passiva_graus: 170,
    tratamento_conservador_meses: 8, reparo_previo: false, deltoide_funcional: true,
  }, { tabagismo: "atual", diabetes: false, nivelAtividade: "recreativo" }),
  FX_UMERO_PROXIMAL: bloco("SH_FX_PROX_HUM", "SH_FX_PROX_HUM.diagnosis.v1", {
    neer_partes: 3, fratura_luxacao: "nenhuma", head_split: false, ao_ota: "11C2",
    extensao_metafisaria_posteromedial_mm: 6, dobradica_medial_desviada_mm: 5, deltoid_tuberosity_index: 1.3,
    cominuicao_calcar: true, espessura_cortical_combinada_mm: 4, fratura_exposta: false, lesao_neurovascular: false, politrauma: false,
    desvio_tuberosidade_maior_mm: 0, dias_desde_lesao: 4, asa: 2,
  }),
  EL_DBR_APOIO: bloco("EL_DBR", "EL_DBR.diagnosis.v1", {
    dias_desde_lesao_preop: 12, tipo_rm: "parcial", partial_pct_rm: 60, retracao_cm_rm: 2, lacerto_integro_rm: true,
    hook_test: false, ocupacao_demanda: "atleta", necessidade_forca_supinacao: true,
  }, { tabagismo: "ex_tabagista", diabetes: true, ladoDominante: "R", nivelAtividade: "sedentario" }),
};

describe("pré-preenchimento da interface × mapeamento do servidor", () => {
  it("há payload de exemplo para todo algoritmo registrado", () => {
    expect(DECISION_ALGORITHMS.map((d) => d.id).sort()).toEqual(Object.keys(AMOSTRAS).sort());
  });

  it.each(DECISION_ALGORITHMS.map((def) => ({ nome: algorithmKey(def), def })))("$nome: entradas preenchidas pelos dois concordam", ({ def }) => {
    const { payload, paciente } = AMOSTRAS[def.id];
    const ui = buildEntrada(def.entradas, prefillFromRegistro(def, { preop: payload.avaliacaoPreop, ...(paciente ? { paciente } : {}) }));
    expect(ui.errors).toEqual({});
    const mapear = decisionRegistry.get(def.id, def.versao)!.mapear;
    const srv = montarEntrada(def, mapear, { payload, ...(paciente ? { paciente } : {}), dataNascimento: "1975-01-20", dataReferencia: "2026-03-10", lado: "Direito" });

    const comuns = Object.keys(ui.entrada).filter((k) => k in srv.entrada);
    // O exemplo precisa exercitar de fato os caminhos declarados
    expect(comuns.length, `${def.id}: entradas em comum`).toBeGreaterThanOrEqual(4);
    for (const k of comuns) expect(ui.entrada[k], `${def.id}.${k}`).toEqual(srv.entrada[k]);
    // Toda entrada que a interface pré-preenche, o servidor também lê do registro
    expect(Object.keys(ui.entrada).filter((k) => !(k in srv.entrada))).toEqual([]);
  });

  it("campos do cadastro do paciente: a interface pré-preenche do paciente, com a mesma origem do servidor", () => {
    for (const id of ["SH_RCT_DECISAO", "EL_DBR_APOIO"]) {
      const def = DECISION_ALGORITHMS.find((d) => d.id === id)!;
      const { payload, paciente } = AMOSTRAS[id];
      const ui = prefillFromRegistro(def, { preop: payload.avaliacaoPreop, paciente });
      expect(ui.tabagismo, id).toBe(paciente!.tabagismo);
      expect(ui.diabetes, id).toBeDefined();
      const srv = montarEntrada(def, decisionRegistry.get(def.id, def.versao)!.mapear, { payload, paciente, lado: "Direito" });
      expect(srv.proveniencia.tabagismo, id).toEqual({ de: "paciente", caminho: "paciente.tabagismo", nota: "cadastro do paciente" });
      // Sem o cadastro, campos antigos do pré-op não são lidos por nenhum dos dois
      const legado = { avaliacaoPreop: { comum: { tabagismo: "atual", diabetes: true, nivel_atividade: "competitivo" }, patologias: [] } };
      expect(prefillFromRegistro(def, { preop: legado.avaliacaoPreop }).tabagismo, id).toBeUndefined();
      expect(montarEntrada(def, decisionRegistry.get(def.id, def.versao)!.mapear, { payload: legado }).entrada.tabagismo, id).toBeUndefined();
    }
  });
});

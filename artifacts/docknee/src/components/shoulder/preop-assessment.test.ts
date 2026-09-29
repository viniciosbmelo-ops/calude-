import { describe, expect, it } from "vitest";
import { buildPreopPayload, emptyPreopState, preopStateFromPayload, visiblePreopBlocks } from "./preop-assessment";

describe("avaliação pré-operatória: sub-blocos visíveis", () => {
  it("nenhum procedimento: só os dados comuns", () => {
    expect(visiblePreopBlocks([])).toEqual([]);
  });

  it("um sub-bloco por patologia com schema de diagnóstico, na ordem dos procedimentos", () => {
    expect(visiblePreopBlocks([{ codigo: "SH_RCT_FULL" }, { codigo: "SH_INST_ANT" }, { codigo: "SH_FX_PROX_HUM" }])).toEqual([
      { schema: "SH_RCT.diagnosis.v1", codigo: "SH_RCT_FULL" },
      { schema: "SH_INST_ANT.diagnosis.v2", codigo: "SH_INST_ANT" },
      { schema: "SH_FX_PROX_HUM.diagnosis.v1", codigo: "SH_FX_PROX_HUM" },
    ]);
    expect(visiblePreopBlocks([{ codigo: "EL_DBR" }])).toEqual([{ schema: "EL_DBR.diagnosis.v1", codigo: "EL_DBR" }]);
  });

  it("patologias sem avaliação estruturada e tipos de descrição livre não abrem sub-bloco", () => {
    expect(visiblePreopBlocks([{ codigo: "SH_INST_POST" }, { codigo: "SH_FX_CLAV" }, { codigo: "SH_BICEPS" }, { codigo: null }, { codigo: "EL_OA" }])).toEqual([]);
  });

  it("subtipos que compartilham o schema (manguito) abrem um único sub-bloco", () => {
    expect(visiblePreopBlocks([{ codigo: "SH_RCT_MASSIVE" }, { codigo: "SH_RCT_SUBSCAP" }])).toEqual([{ schema: "SH_RCT.diagnosis.v1", codigo: "SH_RCT_MASSIVE" }]);
  });
});

describe("avaliação pré-operatória: payload", () => {
  it("nada preenchido: bloco omitido (registro igual ao v1)", () => {
    expect(buildPreopPayload(emptyPreopState(), visiblePreopBlocks([{ codigo: "SH_RCT" }]))).toBeUndefined();
    expect(buildPreopPayload({ comum: { tabagismo: undefined }, bySchema: { "SH_RCT.diagnosis.v1": {} } }, visiblePreopBlocks([{ codigo: "SH_RCT" }]))).toBeUndefined();
  });

  it("sub-bloco oculto fica no estado, mas não é enviado", () => {
    const state = { comum: { diabetes: true }, bySchema: { "SH_RCT.diagnosis.v1": { hamada: 3 }, "SH_INST_ANT.diagnosis.v2": { n_luxacoes: 2 } } };
    expect(buildPreopPayload(state, visiblePreopBlocks([{ codigo: "SH_INST_ANT" }]))).toEqual({
      comum: { diabetes: true },
      patologias: [{ codigo: "SH_INST_ANT", schema: "SH_INST_ANT.diagnosis.v2", dados: { n_luxacoes: 2 } }],
    });
  });

  it("troca de subtipo mantém os dados e grava o código atual", () => {
    const state = { comum: {}, bySchema: { "SH_RCT.diagnosis.v1": { hamada: 2 } } };
    expect(buildPreopPayload(state, visiblePreopBlocks([{ codigo: "SH_RCT_FULL" }]))?.patologias).toEqual([
      { codigo: "SH_RCT_FULL", schema: "SH_RCT.diagnosis.v1", dados: { hamada: 2 } },
    ]);
  });

  it("ida e volta pelo payload gravado; v1 sem bloco dá estado vazio", () => {
    const blocks = visiblePreopBlocks([{ codigo: "SH_FX_PROX_HUM" }]);
    const sent = buildPreopPayload({ comum: { lado_dominante: "L" }, bySchema: { "SH_FX_PROX_HUM.diagnosis.v1": { neer_partes: 4 } } }, blocks);
    const state = preopStateFromPayload(JSON.parse(JSON.stringify(sent)));
    expect(buildPreopPayload(state, blocks)).toEqual(sent);
    expect(preopStateFromPayload(undefined)).toEqual(emptyPreopState());
    expect(preopStateFromPayload({ patologias: [{ codigo: "SH_STIFF", dados: { x: 1 } }, "lixo"] })).toEqual(emptyPreopState());
  });
});

import { describe, expect, it } from "vitest";
import type { EntradaDef, OpcaoResultado, ResultadoApoio, TraceItem } from "@workspace/clinical/web";
import { decisionSupportMessages } from "@/locales/decision-support";
import {
  BOOL_NAO, BOOL_SIM, CHOICE_OTHER, applicableAlgorithms, choiceLabel, buildChoicePayload, buildEntrada, collectControversies,
  describeApiError, emptyChoice, groupTrace, parseField, pathologyMatches, prefillFromRegistro, referenceHref, referenceIds,
  resolveCaminho, transitionsFrom, visibleInputs,
} from "./logic";

// Entradas FICTÍCIAS, só de teste (sem conteúdo clínico)
const NUM: EntradaDef = { id: "perda", rotulo: "Perda", def: { tipo: "numero", unidade: "%", min: 0, max: 60 }, origem: { de: "payload", caminho: "avaliacaoPreop[SH_INST_ANT].perda_pct" }, momento: "preop" };
const INT: EntradaDef = { id: "episodios", rotulo: "Episódios", def: { tipo: "numero", min: 0, max: 100, inteiro: true }, origem: { de: "manual" }, momento: "preop" };
const BOOL: EntradaDef = { id: "lesao", rotulo: "Lesão", def: { tipo: "booleano" }, origem: { de: "payload", caminho: "avaliacaoPreop.comum.tabagismo" }, momento: "preop" };
const ENUM: EntradaDef = { id: "grau", rotulo: "Grau", def: { tipo: "enum", valores: ["a", "b"] }, origem: { de: "intraop", caminho: "procedimentos[SH_RCT].dados.grau" }, momento: "intraop" };
const LISTA: EntradaDef = { id: "achados", rotulo: "Achados", def: { tipo: "lista", valores: ["x", "y", "z"] }, origem: { de: "manual" }, momento: "preop" };
const ALL = [NUM, INT, BOOL, ENUM, LISTA];

describe("formulário: ausente ≠ zero", () => {
  it("campos vazios ficam ausentes e não entram na entrada", () => {
    const r = buildEntrada(ALL, { perda: "", episodios: "   ", lesao: "", grau: "", achados: [] });
    expect(r.entrada).toEqual({});
    expect(r.errors).toEqual({});
    expect(r.missing).toEqual(["perda", "episodios", "lesao", "grau", "achados"]);
    expect(buildEntrada(ALL, {}).entrada).toEqual({});
  });

  it("zero digitado é enviado como 0; 'Não' como false", () => {
    const r = buildEntrada(ALL, { perda: "0", episodios: "0", lesao: BOOL_NAO });
    expect(r.entrada).toEqual({ perda: 0, episodios: 0, lesao: false });
    expect(r.missing).toEqual(["grau", "achados"]);
  });

  it("aceita vírgula decimal, enum e lista na ordem declarada", () => {
    const r = buildEntrada(ALL, { perda: "17,5", lesao: BOOL_SIM, grau: "b", achados: ["z", "x"] });
    expect(r.entrada).toEqual({ perda: 17.5, lesao: true, grau: "b", achados: ["x", "z"] });
  });

  it("valor implausível vira erro (não é enviado nem trocado por outro valor)", () => {
    const r = buildEntrada(ALL, { perda: "61", episodios: "2.5", grau: "abc" });
    expect(r.errors).toEqual({ perda: { code: "max", limit: 60 }, episodios: { code: "inteiro" } });
    expect(r.entrada).toEqual({});
    expect(parseField(NUM, "-1")).toEqual({ missing: false, error: { code: "min", limit: 0 } });
    expect(parseField(NUM, "abc")).toEqual({ missing: false, error: { code: "nan" } });
    expect(parseField(ENUM, "zzz")).toEqual({ missing: true });
  });

  it("no modo preop, entradas intraoperatórias não aparecem", () => {
    expect(visibleInputs({ entradas: ALL }, "preop").map((e) => e.id)).toEqual(["perda", "episodios", "lesao", "achados"]);
    expect(visibleInputs({ entradas: ALL }, "registro")).toHaveLength(5);
  });
});

describe("aplicabilidade e pré-preenchimento pelo registro", () => {
  it("casa patologia igual ou subtipo (parent do catálogo)", () => {
    expect(pathologyMatches("SH_RCT", "SH_RCT_FULL")).toBe(true);
    expect(pathologyMatches("SH_RCT_FULL", "SH_RCT")).toBe(true);
    expect(pathologyMatches("SH_INST_ANT", "SH_INST_POST")).toBe(false);
    const algos = [{ id: "A", patologias: ["SH_RCT"] }, { id: "B", patologias: ["SH_INST_ANT"] }, { id: "C", patologias: ["EL_DBR"] }];
    expect(applicableAlgorithms(algos, ["SH_RCT_MASSIVE", "SH_INST_ANT"]).map((a) => a.id)).toEqual(["A", "B"]);
    expect(applicableAlgorithms(algos, [])).toEqual([]);
  });

  it("resolve caminhos do registro e só pré-preenche valores válidos", () => {
    const ctx = {
      preop: { comum: { tabagismo: true }, patologias: [{ codigo: "SH_INST_ANT", schema: "SH_INST_ANT.diagnosis.v2", dados: { perda_pct: 0 } }] },
      procedimentos: [{ codigo: "SH_RCT_FULL", dados: { grau: "b" } }],
    };
    expect(resolveCaminho("avaliacaoPreop[SH_INST_ANT].perda_pct", ctx)).toBe(0);
    expect(resolveCaminho("avaliacaoPreop.comum.tabagismo", ctx)).toBe(true);
    expect(resolveCaminho("procedimentos[SH_RCT].dados.grau", ctx)).toBe("b");
    expect(resolveCaminho("avaliacaoPreop[EL_DBR].x", ctx)).toBeUndefined();
    expect(prefillFromRegistro({ entradas: ALL }, ctx)).toEqual({ perda: "0", lesao: BOOL_SIM, grau: "b" });
    // fora da faixa: não pré-preenche
    const fora = { preop: { comum: {}, patologias: [{ codigo: "SH_INST_ANT", schema: "s", dados: { perda_pct: 90 } }] } };
    expect(prefillFromRegistro({ entradas: ALL }, fora)).toEqual({});
  });
});

const opcao = (o: Partial<OpcaoResultado> & { opcao: string }): OpcaoResultado => ({
  rotulo: o.opcao, forca: "fraca", sentido: "favorece", motivos: [], referencias: [], controversias: [], ...o,
});

describe("resultado: funções puras de exibição", () => {
  it("links de referência: PubMed pelo PMID, senão DOI; ids como texto", () => {
    expect(referenceHref({ pmid: "123", doi: "10.1/x" })).toBe("https://pubmed.ncbi.nlm.nih.gov/123/");
    expect(referenceHref({ doi: "10.1/x" })).toBe("https://doi.org/10.1/x");
    expect(referenceHref({})).toBeUndefined();
    expect(referenceIds({ pmid: "123", doi: "10.1/x" })).toBe("PMID 123 · DOI 10.1/x");
  });

  it("controvérsias sem repetir a mesma regra entre opções", () => {
    const c = { regra: "R1", nota: "n", alternativas: [{ opcao: "a", rotulo: "A", argumento: "x", referencias: [] }, { opcao: "b", rotulo: "B", argumento: "y", referencias: [] }] };
    const list = collectControversies([opcao({ opcao: "a", forca: "controversa", controversias: [c] }), opcao({ opcao: "b", controversias: [c] })]);
    expect(list).toEqual([c]);
    expect(list[0].alternativas).toHaveLength(2);
  });

  it("trace agrupado: aplicadas, indeterminadas, fora de escopo, não aplicadas", () => {
    const item = (regra: string, resultado: TraceItem["resultado"]): TraceItem => ({ regra, resultado, valores: {}, faltando: [] });
    const g = groupTrace([item("A", "nao_disparou"), item("B", "disparou"), item("C", "indeterminada"), item("D", "disparou")]);
    expect(g.map((x) => [x.grupo, x.itens.map((i) => i.regra)])).toEqual([["disparou", ["B", "D"]], ["indeterminada", ["C"]], ["nao_disparou", ["A"]]]);
  });

  it("rótulo da escolha registrada: opção do resultado ou texto livre", () => {
    const res = { opcoes: [opcao({ opcao: "a", rotulo: "Opção A" })] } as Pick<ResultadoApoio, "opcoes">;
    expect(choiceLabel({ opcao: "a", outra: null }, res)).toBe("Opção A");
    expect(choiceLabel({ opcao: null, outra: "Outra coisa" }, res)).toBe("Outra coisa");
  });

  it("erros do servidor (409/422) mantêm status, mensagem e código", () => {
    expect(describeApiError({ status: 409, message: "HTTP 409", data: { error: "O hash difere.", code: "HASH_MISMATCH" } }))
      .toEqual({ status: 409, message: "O hash difere.", code: "HASH_MISMATCH" });
    expect(describeApiError(new Error("falhou"))).toEqual({ message: "falhou" });
  });

  it("transições de status oferecidas", () => {
    expect(transitionsFrom("rascunho")).toEqual(["revisado"]);
    expect(transitionsFrom("revisado")).toEqual(["rascunho", "ativo"]);
    expect(transitionsFrom("ativo")).toEqual(["aposentado"]);
    expect(transitionsFrom("aposentado")).toEqual([]);
  });
});

describe("escolha do cirurgião: payload", () => {
  const validas = ["a", "b"];
  it("nada pré-selecionado: sem seleção não envia", () => {
    expect(emptyChoice().selecao).toBeNull();
    expect(buildChoicePayload(emptyChoice(), validas)).toEqual({ ok: false, problem: "sem_selecao" });
  });

  it("opção do algoritmo, com justificativa só quando preenchida", () => {
    expect(buildChoicePayload({ selecao: "a", outra: "ignorado", justificativa: "  " }, validas)).toEqual({ ok: true, body: { opcao: "a" } });
    expect(buildChoicePayload({ selecao: "b", outra: "", justificativa: " Preferência do paciente " }, validas))
      .toEqual({ ok: true, body: { opcao: "b", justificativa: "Preferência do paciente" } });
    expect(buildChoicePayload({ selecao: "z", outra: "", justificativa: "" }, validas)).toEqual({ ok: false, problem: "opcao_desconhecida" });
  });

  it("'outra' exige texto e nunca envia opcao junto", () => {
    expect(buildChoicePayload({ selecao: CHOICE_OTHER, outra: "  ", justificativa: "" }, validas)).toEqual({ ok: false, problem: "outra_vazia" });
    expect(buildChoicePayload({ selecao: CHOICE_OTHER, outra: " Adiar ", justificativa: "j" }, validas)).toEqual({ ok: true, body: { outra: "Adiar", justificativa: "j" } });
    expect(buildChoicePayload({ selecao: CHOICE_OTHER, outra: "x".repeat(501), justificativa: "" }, validas)).toEqual({ ok: false, problem: "muito_longo" });
  });
});

describe("textos", () => {
  it("pt-BR e es com as mesmas chaves, sem texto vazio", () => {
    const pt = decisionSupportMessages["pt-BR"];
    const es = decisionSupportMessages.es;
    expect(Object.keys(es).sort()).toEqual(Object.keys(pt).sort());
    for (const v of [...Object.values(pt), ...Object.values(es)]) expect(v.trim()).not.toBe("");
    expect(pt.suggestionLabel).toBe("Sugestão");
  });
});

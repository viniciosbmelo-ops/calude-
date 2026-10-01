import { describe, expect, it } from "vitest";
import type { EntradaDef, ParametroResultado } from "@workspace/clinical/web";
import { decisionSupportMessages } from "@/locales/decision-support";
import {
  conflictLines, formatInputValue, parameterLines, provenanceKind, readExecutionMeta, usedInputLines,
} from "./logic";

// Entradas FICTÍCIAS, só de teste (sem conteúdo clínico)
const NUM: EntradaDef = { id: "perda", rotulo: "Perda", def: { tipo: "numero", unidade: "%", min: 0, max: 60 }, origem: { de: "payload", caminho: "avaliacaoPreop[X].perda" }, momento: "preop" };
const BOOL: EntradaDef = { id: "lesao", rotulo: "Lesão", def: { tipo: "booleano" }, origem: { de: "manual" }, momento: "preop" };
const LISTA: EntradaDef = { id: "achados", rotulo: "Achados", def: { tipo: "lista", valores: ["x", "y"] }, origem: { de: "manual" }, momento: "preop" };
const DEF = { entradas: [NUM, BOOL, LISTA] };
const L = { yes: "Sim", no: "Não" };

describe("proveniência: agrupamento exibido", () => {
  it("registro, derivado e manual (desconhecido cai em manual)", () => {
    expect(provenanceKind("payload")).toBe("registro");
    expect(provenanceKind("intraop")).toBe("registro");
    expect(provenanceKind("paciente")).toBe("registro");
    expect(provenanceKind("derivada")).toBe("derivado");
    expect(provenanceKind("manual")).toBe("manual");
    expect(provenanceKind("outra_coisa")).toBe("manual");
    expect(provenanceKind(undefined)).toBe("manual");
  });
});

describe("formatação de valores", () => {
  it("booleano, lista, número com unidade, ausente", () => {
    expect(formatInputValue(true, L)).toBe("Sim");
    expect(formatInputValue(false, L)).toBe("Não");
    expect(formatInputValue(0, L, "%")).toBe("0 %");
    expect(formatInputValue(["x", "y"], L)).toBe("x, y");
    expect(formatInputValue([], L)).toBe("—");
    expect(formatInputValue(undefined, L)).toBe("—");
    expect(formatInputValue(null, L)).toBe("—");
    expect(formatInputValue("a", L)).toBe("a");
  });
});

describe("conflitos com o registro salvo", () => {
  it("linhas na ordem da definição, com digitado, usado, origem e caminho", () => {
    const lines = conflictLines(
      [
        { entrada: "desconhecida", usado: 1, origemUsada: "paciente", descartado: 2, origemDescartada: "manual" },
        { entrada: "lesao", usado: true, origemUsada: "derivada", descartado: false, origemDescartada: "manual" },
        { entrada: "perda", usado: 20, origemUsada: "payload", descartado: 15, origemDescartada: "manual" },
      ],
      DEF, L, { perda: { de: "payload", caminho: "avaliacaoPreop[X].perda" } },
    );
    expect(lines).toEqual([
      { entrada: "perda", rotulo: "Perda", digitado: "15 %", usado: "20 %", origem: "payload", kind: "registro", caminho: "avaliacaoPreop[X].perda" },
      { entrada: "lesao", rotulo: "Lesão", digitado: "Não", usado: "Sim", origem: "derivada", kind: "derivado" },
      { entrada: "desconhecida", rotulo: "desconhecida", digitado: "2", usado: "1", origem: "paciente", kind: "registro" },
    ]);
  });

  it("sem conflitos ou sem definição", () => {
    expect(conflictLines(undefined, DEF, L)).toEqual([]);
    expect(conflictLines([], DEF, L)).toEqual([]);
    expect(conflictLines([{ entrada: "perda", usado: 1, origemUsada: "payload", descartado: 2, origemDescartada: "manual" }], undefined, L)[0])
      .toMatchObject({ rotulo: "perda", digitado: "2", usado: "1" });
  });
});

describe("dados usados", () => {
  it("ordem da definição, origem por entrada, marca de conflito", () => {
    const lines = usedInputLines(
      { zeta: "z", achados: ["y"], perda: 20, lesao: false },
      DEF, L,
      { perda: { de: "payload", caminho: "avaliacaoPreop[X].perda" }, lesao: { de: "manual" }, achados: { de: "derivada", nota: "calc" } },
      [{ entrada: "perda" }],
    );
    expect(lines.map((l) => l.id)).toEqual(["perda", "lesao", "achados", "zeta"]);
    expect(lines[0]).toEqual({ id: "perda", rotulo: "Perda", valor: "20 %", kind: "registro", caminho: "avaliacaoPreop[X].perda", emConflito: true });
    expect(lines[1]).toEqual({ id: "lesao", rotulo: "Lesão", valor: "Não", kind: "manual", emConflito: false });
    expect(lines[2]).toEqual({ id: "achados", rotulo: "Achados", valor: "y", kind: "derivado", nota: "calc", emConflito: false });
    // Sem proveniência registrada (execução antiga): sem tag
    expect(lines[3]).toEqual({ id: "zeta", rotulo: "zeta", valor: "z", emConflito: false });
  });

  it("entrada vazia → nenhuma linha", () => {
    expect(usedInputLines({}, DEF, L)).toEqual([]);
  });
});

describe("parâmetros usados", () => {
  const P = (over: Partial<ParametroResultado>): ParametroResultado => ({
    id: "lim", rotulo: "Limiar", valor: 10, origem: "padrao", status: "definido", nota: "n", referencias: ["R1"], ...over,
  });

  it("valor com unidade, origem e pendência de decisão do cirurgião", () => {
    expect(parameterLines([P({ unidade: "%" }), P({ id: "b", valor: 3, status: "pendente_decisao_cirurgiao", origem: "contexto" })])).toEqual([
      { id: "lim", rotulo: "Limiar", valor: "10 %", origem: "padrao", pendente: false, nota: "n", referencias: ["R1"] },
      { id: "b", rotulo: "Limiar", valor: "3", origem: "contexto", pendente: true, nota: "n", referencias: ["R1"] },
    ]);
  });

  it("lista vazia ou ausente (resultado antigo)", () => {
    expect(parameterLines([])).toEqual([]);
    expect(parameterLines(undefined)).toEqual([]);
  });
});

describe("metadados da execução", () => {
  it("lê proveniência, conflitos e parametrosIgnorados da resposta da avaliação", () => {
    const meta = readExecutionMeta({
      execucaoId: 1,
      proveniencia: { perda: { de: "payload", caminho: "c" }, ruim: { x: 1 }, lesao: { de: "manual", nota: 5 } },
      conflitos: [{ entrada: "perda", usado: 20, origemUsada: "payload", descartado: 15, origemDescartada: "manual" }, { lixo: true }],
      parametrosIgnorados: true,
    });
    expect(meta).toEqual({
      proveniencia: { perda: { de: "payload", caminho: "c" }, lesao: { de: "manual" } },
      conflitos: [{ entrada: "perda", usado: 20, origemUsada: "payload", descartado: 15, origemDescartada: "manual" }],
      parametrosIgnorados: true,
    });
  });

  it("linha sem esses campos: sem proveniência, sem conflitos, não ignorados", () => {
    expect(readExecutionMeta({ execucaoId: 1 })).toEqual({ conflitos: [], parametrosIgnorados: false });
    expect(readExecutionMeta(null)).toEqual({ conflitos: [], parametrosIgnorados: false });
    expect(readExecutionMeta({ parametrosIgnorados: "true" }).parametrosIgnorados).toBe(false);
  });
});

describe("textos de conflito, proveniência e parâmetros", () => {
  const keys = [
    "conflictsTitle", "conflictsBody", "conflictLine", "conflictTag", "usedTitle", "usedLegend",
    "prov_registro", "prov_manual", "prov_derivado", "src_payload", "src_intraop", "src_paciente", "src_derivada", "src_manual",
    "paramPending", "paramOrigin_padrao", "paramOrigin_contexto", "paramsIgnored",
  ] as const;

  it("existem em pt-BR e es, com os mesmos marcadores", () => {
    for (const k of keys) {
      const pt = decisionSupportMessages["pt-BR"][k];
      const es = decisionSupportMessages.es[k];
      expect(pt.trim()).not.toBe("");
      expect(es.trim()).not.toBe("");
      const marks = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(marks(es)).toEqual(marks(pt));
    }
    expect(decisionSupportMessages["pt-BR"].paramPending).toBe("pendente de decisão do cirurgião");
  });
});

/**
 * Exibição honesta do resultado: sentido líquido (favorece / alternativa de zona cinzenta / cautela),
 * rótulos legíveis de valores, números no idioma da tela e textos pt-BR/es.
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_ALGORITHMS, SENTIDO_ROTULO, TIPO_ESTUDO_ROTULO, evaluate,
  type EntradaDef, type MotivoOpcao, type OpcaoResultado, type ParametroResultado,
} from "@workspace/clinical/web";
import { decisionSupportMessages } from "@/locales/decision-support";
import {
  alternativeEvidence, criticalMissing, displayDirection, formatDecimal, formatInputValue, formatTraceValue, motiveTag, orderedMotives,
  parameterLines, usedInputLines, valueLabel,
} from "./logic";

const mot = (regra: string, efeito: MotivoOpcao["efeito"], forca: MotivoOpcao["forca"]): MotivoOpcao => ({ regra, texto: regra, efeito, forca });
const opcao = (o: Partial<OpcaoResultado> & { opcao: string }): OpcaoResultado => ({
  rotulo: o.opcao, forca: "fraca", sentido: "favorece", motivos: [], referencias: [], controversias: [], ...o,
});
const ZC = {
  regra: "ZC1", nota: "n",
  alternativas: [
    { opcao: "a", rotulo: "A", argumento: "Evidência de A.", referencias: ["R1"] },
    { opcao: "b", rotulo: "B", argumento: "Evidência de B.", referencias: ["R2"] },
  ],
};

describe("sentido exibido", () => {
  it("motor ≥1.2.0: usa o sentido entregue", () => {
    expect(displayDirection(opcao({ opcao: "a", sentido: "alternativa", forca: "controversa" }))).toBe("alternativa");
    expect(displayDirection(opcao({ opcao: "a", sentido: "desfavorece", forca: "forte" }))).toBe("desfavorece");
    expect(displayDirection(opcao({ opcao: "a", sentido: "favorece", forca: "moderada" }))).toBe("favorece");
  });

  it("resultado antigo (favorece + controversa): cautela ≥ favor vira cautela; senão alternativa", () => {
    const conflito = opcao({ opcao: "a", forca: "controversa", motivos: [mot("R.ZC", "favorece", "fraca"), mot("R.OFF", "desfavorece", "forte")] });
    expect(displayDirection(conflito)).toBe("desfavorece");
    const zona = opcao({ opcao: "a", forca: "controversa", motivos: [mot("ZC1", "favorece", "fraca")], controversias: [ZC] });
    expect(displayDirection(zona)).toBe("alternativa");
  });

  it("motivo vindo de zona cinzenta é 'alternativa' sem força; os demais mantêm efeito e força", () => {
    const o = opcao({ opcao: "a", controversias: [ZC] });
    expect(motiveTag(o, mot("ZC1", "favorece", "fraca"))).toEqual({ sentido: "alternativa" });
    expect(motiveTag(o, mot("R.OFF", "desfavorece", "forte"))).toEqual({ sentido: "desfavorece", forca: "forte" });
    expect(motiveTag(o, mot("R.X", "favorece", "moderada"))).toEqual({ sentido: "favorece", forca: "moderada" });
  });

  it("cartão de alternativa: sugestão de fora da zona rotulada pela origem, com força, nunca \"favorece\"", () => {
    const o = opcao({ opcao: "a", sentido: "alternativa", forca: "controversa", controversias: [ZC] });
    expect(motiveTag(o, mot("N5B", "favorece", "fraca"), "alternativa")).toEqual({ sentido: "fora_da_zona", forca: "fraca" });
    expect(motiveTag(o, mot("ZC1", "favorece", "fraca"), "alternativa")).toEqual({ sentido: "alternativa" });
    expect(motiveTag(o, mot("R.OFF", "desfavorece", "fraca"), "alternativa")).toEqual({ sentido: "desfavorece", forca: "fraca" });
    // ordem: zona cinzenta, depois fora da zona, depois cautela
    const ms = [mot("R.OFF", "desfavorece", "fraca"), mot("N5B", "favorece", "fraca"), mot("ZC1", "favorece", "fraca")];
    expect(orderedMotives(ms, "alternativa", o).map((m) => m.regra)).toEqual(["ZC1", "N5B", "R.OFF"]);
  });

  it.each([
    ["SH_RCT_DECISAO", { lesao_sintomatica_confirmada: true, tipo_rotura: "completa", hamada: 2, artrose_glenoumeral: "ausente", inicio: "degenerativo", falha_conservador: true, massiva: true, reparabilidade_estimada: "provavel_irreparavel", pseudoparalisia: false }, "tratamento_conservador", "N5B"],
    ["FX_UMERO_PROXIMAL", { fratura_exposta: false, lesao_neurovascular: false, fratura_patologica: false, politrauma: false, idade: 75, mecanismo_energia: "baixa", deslocada: true, neer_partes: 4, segmentos_deslocados: ["colo_cirurgico", "tuberosidade_maior"], fratura_luxacao: "nenhuma", head_split: false, ao_ota: "11C2", cirurgia_escolhida: true }, "artroplastia_reversa", "N8.S3.AO_C2_CIRURGIA"],
    ["EL_DBR_APOIO", { tipo_ruptura: "completa", dias_desde_lesao: 5, demanda_funcional: "baixa", prioridade_supinacao: "baixa", aceita_deficit_supinacao: true }, "nao_operatorio", "DBR.A1.NAO_OPERATORIO"],
    ["EL_DBR_APOIO", { tipo_ruptura: "parcial", pct_ruptura_parcial_rm: 70, demanda_funcional: "alta" }, "reparo_parcial", "DBR.C2.DEMANDA_ALTA"],
    ["SH_INST_ANT", { tipo_episodio: "recorrente", gbl_pct: 15, track_status: "off_track", isis_total: 5 }, null, null],
    ["SH_INST_ANT", { tipo_episodio: "primeiro_episodio", idade: 25, gbl_pct: 3, track_status: "off_track" }, null, null],
  ] as const)("%s (motor real): nenhum cartão de alternativa exibe \"favorece\" em seus motivos", (algo, entrada, opcaoMista, regraFora) => {
    const def = DECISION_ALGORITHMS.find((d) => d.id === algo)!;
    const r = evaluate(def, { ...entrada });
    for (const o of r.opcoes) {
      const sentido = displayDirection(o);
      if (sentido !== "alternativa") continue;
      for (const m of o.motivos) expect(motiveTag(o, m, sentido).sentido, `${o.opcao}/${m.regra}`).not.toBe("favorece");
    }
    if (!opcaoMista) return;
    const o = r.opcoes.find((x) => x.opcao === opcaoMista)!;
    expect(displayDirection(o)).toBe("alternativa");
    const m = o.motivos.find((x) => x.regra === regraFora)!;
    // a sugestão de fora da zona continua visível, com a força, rotulada pela origem
    expect(motiveTag(o, m, "alternativa")).toEqual({ sentido: "fora_da_zona", forca: m.forca });
    expect(orderedMotives(o.motivos, "alternativa", o)[0].regra).not.toBe(regraFora);
  });

  it("cautela que define a opção aparece primeiro nos motivos", () => {
    const ms = [mot("ZC1", "favorece", "fraca"), mot("R.OFF", "desfavorece", "forte"), mot("ZC2", "favorece", "fraca")];
    expect(orderedMotives(ms, "desfavorece").map((m) => m.regra)).toEqual(["R.OFF", "ZC1", "ZC2"]);
    expect(orderedMotives(ms, "alternativa").map((m) => m.regra)).toEqual(["ZC1", "ZC2", "R.OFF"]);
  });

  it("evidência da alternativa: só o argumento desta opção, com referências", () => {
    expect(alternativeEvidence(opcao({ opcao: "b", controversias: [ZC] }))).toEqual([{ regra: "ZC1", argumento: "Evidência de B.", referencias: ["R2"] }]);
  });

  it("instabilidade off-track (motor real): Bankart isolado como cautela forte; alternativas da ZC-B sem 'favorece'", () => {
    const def = DECISION_ALGORITHMS.find((d) => d.id === "SH_INST_ANT")!;
    const r = evaluate(def, { tipo_episodio: "recorrente", gbl_pct: 15, track_status: "off_track", isis_total: 5 });
    const bankart = r.opcoes.find((o) => o.opcao === "bankart_artro")!;
    expect(displayDirection(bankart)).toBe("desfavorece");
    expect(bankart.forca).toBe("forte");
    expect(orderedMotives(bankart.motivos, "desfavorece")[0].regra).toBe("N4.OFF_TRACK.BANKART_ISOLADO");
    expect(r.opcoes.filter((o) => displayDirection(o) === "favorece")).toEqual([]);
    const latarjet = r.opcoes.find((o) => o.opcao === "latarjet")!;
    expect(displayDirection(latarjet)).toBe("alternativa");
    expect(alternativeEvidence(latarjet).map((a) => a.regra)).toEqual(expect.arrayContaining(["N4.ZC_B", "N3.ZC_A", "N5.ZC_D"]));
  });
});

describe("rótulos de valores e números", () => {
  const ENUM: EntradaDef = { id: "track", rotulo: "Track", def: { tipo: "enum", valores: ["on_track", "off_track"], rotulos: { off_track: "Off-track" } }, origem: { de: "manual" }, momento: "preop" };
  const LISTA: EntradaDef = { id: "seg", rotulo: "Segmentos", def: { tipo: "lista", valores: ["colo_cirurgico", "x"], rotulos: { colo_cirurgico: "Colo cirúrgico" } }, origem: { de: "manual" }, momento: "preop" };
  const NUM: EntradaDef = { id: "d", rotulo: "Defeito", def: { tipo: "numero", unidade: "mm" }, origem: { de: "manual" }, momento: "preop" };
  const labels = { yes: "Sim", no: "Não", locale: "pt-BR" };

  it("rótulo do valor quando existe; senão o próprio valor", () => {
    expect(valueLabel("off_track", { off_track: "Off-track" })).toBe("Off-track");
    expect(valueLabel("on_track", { off_track: "Off-track" })).toBe("on_track");
  });

  it("número com vírgula decimal em pt-BR e es, sem separador de milhar", () => {
    expect(formatDecimal(3.9, "pt-BR")).toBe("3,9");
    expect(formatDecimal(1.44, "es")).toBe("1,44");
    expect(formatDecimal(3650, "pt-BR")).toBe("3650");
    expect(formatDecimal(3.9)).toBe("3.9");
  });

  it("Dados usados: enum e lista com rótulo, número no idioma com unidade", () => {
    const linhas = usedInputLines({ track: "off_track", seg: ["colo_cirurgico", "x"], d: 3.9 }, { entradas: [ENUM, LISTA, NUM] }, labels);
    expect(linhas.map((l) => l.valor)).toEqual(["Off-track", "Colo cirúrgico, x", "3,9 mm"]);
    expect(formatInputValue(1.44, { ...labels, locale: "es" })).toBe("1,44");
  });

  it("trace e limiares no idioma da tela", () => {
    expect(formatTraceValue(3.9, "pt-BR")).toBe("3,9");
    expect(formatTraceValue("off_track", "pt-BR", { off_track: "Off-track" })).toBe("Off-track");
    const p: ParametroResultado = { id: "x", rotulo: "Limiar", valor: 13.5, unidade: "%", origem: "padrao", status: "definido", nota: "", referencias: [] };
    expect(parameterLines([p], "pt-BR")[0].valor).toBe("13,5%");
  });

  it("percentual sem espaço em pt-BR e es (como \"65%\"); demais unidades com espaço", () => {
    expect(formatInputValue(15, labels, "%")).toBe("15%");
    expect(formatInputValue(13.5, { ...labels, locale: "es" }, "%")).toBe("13,5%");
    expect(formatInputValue(60, labels, "% da espessura")).toBe("60% da espessura");
    expect(formatInputValue(3.9, labels, "mm")).toBe("3,9 mm");
    const p: ParametroResultado = { id: "g", rotulo: "GBL", valor: 20, unidade: "%", origem: "padrao", status: "definido", nota: "", referencias: [] };
    expect(parameterLines([p], "es")[0].valor).toBe("20%");
    // texto das regras (motor): "GBL 15%", nunca "GBL 15 %"
    const def = DECISION_ALGORITHMS.find((d) => d.id === "SH_INST_ANT")!;
    const r = evaluate(def, { tipo_episodio: "recorrente", gbl_pct: 15, track_status: "off_track", isis_total: 5 });
    const textos = r.opcoes.flatMap((o) => o.motivos.map((m) => m.texto));
    expect(textos.join(" ")).toContain("GBL 15%");
    for (const t of textos) expect(t).not.toMatch(/\d %/);
    expect(usedInputLines(r.entrada, def, labels).find((l) => l.id === "gbl_pct")!.valor).toBe("15%");
  });

  it("todo valor de enum/lista dos algoritmos registrados tem rótulo legível (sem id interno na tela)", () => {
    for (const def of DECISION_ALGORITHMS) {
      for (const e of def.entradas) {
        if (e.def.tipo !== "enum" && e.def.tipo !== "lista") continue;
        for (const v of e.def.valores) expect(e.def.rotulos?.[v], `${def.id}/${e.id}/${v}`).toBeTruthy();
      }
    }
  });
});

describe("textos do apoio à decisão", () => {
  const pt = decisionSupportMessages["pt-BR"];
  const es = decisionSupportMessages.es;

  it("sentidos e tipos de estudo em pt-BR iguais ao vocabulário do núcleo; es com as mesmas chaves", () => {
    for (const [k, v] of Object.entries(SENTIDO_ROTULO)) expect(pt[`sentido_${k}` as keyof typeof pt], k).toBe(v);
    for (const [k, v] of Object.entries(TIPO_ESTUDO_ROTULO)) {
      expect(pt[`tipo_${k}` as keyof typeof pt], k).toBe(v);
      expect(es[`tipo_${k}` as keyof typeof es], k).toBeTruthy();
    }
    expect(pt.sentido_alternativa).toBe("Alternativa (zona cinzenta)");
    expect(pt.sentido_alternativa).not.toMatch(/favorece/i);
    expect(es.sentido_alternativa).not.toMatch(/favorece/i);
    // sugestão de fora da zona num cartão de alternativa: rotulada pela origem, sem "favorece"
    expect(pt.sentido_fora_da_zona).toBe("Também apoiado fora da zona cinzenta");
    expect(es.sentido_fora_da_zona).toBe("También respaldado fuera de la zona gris");
    for (const v of [pt.sentido_fora_da_zona, es.sentido_fora_da_zona]) expect(v).not.toMatch(/favorece/i);
  });

  it("dados que faltam: 'libera N regras' em pt-BR e es", () => {
    expect(pt.unlocksOne).toBe("libera 1 regra");
    expect(pt.unlocksMany).toBe("libera {n} regras");
    expect(es.unlocksOne).toBe("libera 1 regla");
    expect(es.unlocksMany).toBe("libera {n} reglas");
  });
});

describe("dado crítico ausente: aviso destacado", () => {
  const pt = decisionSupportMessages["pt-BR"] as Record<string, string>;
  const es = decisionSupportMessages.es as Record<string, string>;

  it("manguito: lesão completa sem reparabilidade estimada gera o aviso; com ela, não", () => {
    const def = DECISION_ALGORITHMS.find((d) => d.id === "SH_RCT_DECISAO")!;
    const base = { lesao_sintomatica_confirmada: true, tipo_rotura: "completa", hamada: 2, artrose_glenoumeral: "ausente" };
    const sem = criticalMissing(evaluate(def, base), def);
    expect(sem.map((c) => c.entrada)).toEqual(["reparabilidade_estimada"]);
    expect(sem[0].regras).toBeGreaterThan(0);
    expect(criticalMissing(evaluate(def, { ...base, reparabilidade_estimada: "provavel_reparavel" }), def)).toEqual([]);
    expect(pt.critical_reparabilidade_estimada).toBe("Informe a reparabilidade estimada para que as opções de reparo sejam avaliadas.");
    expect(es.critical_reparabilidade_estimada).toBe("Informe la reparabilidad estimada para que se evalúen las opciones de reparación.");
  });

  it("resultado gravado antes da marca: usa a definição; faltante que não desbloqueia regra não gera aviso", () => {
    const def = { entradas: [{ id: "x", rotulo: "X", def: { tipo: "booleano" }, origem: { de: "manual" }, momento: "preop", critica: true }] as EntradaDef[] };
    expect(criticalMissing({ faltantes: [{ entrada: "x", rotulo: "X", desbloqueia: ["R1"] }] }, def)).toEqual([{ entrada: "x", rotulo: "X", regras: 1 }]);
    expect(criticalMissing({ faltantes: [{ entrada: "x", rotulo: "X", desbloqueia: ["R1"] }] })).toEqual([]);
    expect(criticalMissing({ faltantes: [{ entrada: "x", rotulo: "X", desbloqueia: [], critica: true }] })).toEqual([]);
  });

  it("toda entrada crítica registrada tem texto próprio em pt-BR e es; textos só sugerem informar", () => {
    const criticas = DECISION_ALGORITHMS.flatMap((d) => d.entradas.filter((e) => e.critica).map((e) => e.id));
    expect(criticas.length).toBeGreaterThan(0);
    for (const id of criticas) {
      expect(pt[`critical_${id}`], id).toMatch(/^Informe /);
      expect(es[`critical_${id}`], id).toMatch(/^Informe /);
    }
    for (const k of ["criticalMissingTitle", "criticalMissingGeneric", "criticalMissingNote"]) {
      expect(pt[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
    }
    const ptCrit = Object.keys(pt).filter((k) => k.startsWith("critical")).sort();
    expect(Object.keys(es).filter((k) => k.startsWith("critical")).sort()).toEqual(ptCrit);
  });
});

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
  alternativeEvidence, displayDirection, formatDecimal, formatInputValue, formatTraceValue, motiveTag, orderedMotives,
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
    expect(parameterLines([p], "pt-BR")[0].valor).toBe("13,5 %");
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
  });

  it("dados que faltam: 'libera N regras' em pt-BR e es", () => {
    expect(pt.unlocksOne).toBe("libera 1 regra");
    expect(pt.unlocksMany).toBe("libera {n} regras");
    expect(es.unlocksOne).toBe("libera 1 regla");
    expect(es.unlocksMany).toBe("libera {n} reglas");
  });
});

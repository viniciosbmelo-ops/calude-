import { describe, expect, it } from "vitest";
import { IMPLANT_CATEGORIES as CATEGORY_KEYS } from "@workspace/clinical/web";
import { IMPLANT_CATEGORIES, canAddImplant, emptyImplantDraft, implantSummary } from "./implant-draft";

describe("implante: estado do formulário", () => {
  it("novo implante não vem pré-classificado como âncora", () => {
    expect(emptyImplantDraft().categoria).toBe("");
  });

  it("só adiciona com categoria escolhida explicitamente", () => {
    const d = { ...emptyImplantDraft(), fabricante: "Fab", modelo: "Botão cortical" };
    expect(canAddImplant(d)).toBe(false);
    expect(canAddImplant({ ...d, categoria: "button" })).toBe(true);
    expect(canAddImplant({ ...d, categoria: "cortical_button" })).toBe(false);
  });

  it("botão cortical é exibido como botão, não como âncora", () => {
    const s = implantSummary({ categoria: "button", fabricante: "Fab", modelo: "Botão cortical", quantidade: 1 });
    expect(s).toBe("Botão · sem lote");
    expect(s).not.toContain("Âncora");
  });

  it("categorias do editor são exatamente as aceitas pela API", () => {
    expect(IMPLANT_CATEGORIES.map(([k]) => k)).toEqual([...CATEGORY_KEYS]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { documentText } from "@/locales/document-locales";
import {
  generateXRayPDF,
  deriveDisplayedPostAmTf,
  getXRayPdfImageAcquisition,
  getXRayPdfBlockReason,
  hasUnsavedOsteotomySimulation,
  isCurrentXRayPdfGeneration,
  isOsteotomySelectionRequired,
  isValidOsteotomySelection,
  resolveXRayPdfImageDataUrl,
  resolveSelectedOsteotomyOption,
  selectXRayPdfImageSource,
} from "./xray-pdf";

describe("X-ray PDF localization", () => {
  const ONE_PIXEL_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("provides Spanish copy for every authored X-ray PDF label", () => {
    expect(documentText("es", "mechanicalAxis")).toBe("Eje mecánico (HKA)");
    expect(documentText("es", "imageQuality", { value: "Boa" })).toBe("Imagen: Boa");
    expect(documentText("es", "wblTarget", { value: "62%" })).toBe("Objetivo: 62%");
    expect(documentText("es", "estimatedWedge", { angle: 8, wedge: 10 })).toBe("Cuña (estimación): 8° · ~10 mm");
    expect(documentText("es", "observations")).toBe("Observaciones:");
    expect(documentText("es", "page", { current: 1, total: 2 })).toBe("Página 1 de 2");
    expect(documentText("es", "aiDisclaimer")).toContain("No sustituye");
  });

  it("uses the requested locale without changing the filename or entered values", () => {
    const { doc, filename } = generateXRayPDF(
      {
        qualidadeImagem: "Boa",
        tipoAnalise: "eixo_mecanico",
        ladoAvaliado: "direito",
        eixoMecanico: { graus: 4, desvio: "Varo" },
        observacoes: "Texto clínico informado pelo usuário",
      },
      "Paciente de prueba",
      undefined,
      undefined,
      "es",
    );

    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
    expect(filename).toMatch(/^docknee-rx-eixo_mecanico-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("requires an explicit osteotomy choice instead of exporting the Padrão option", () => {
    const analysis = {
      qualidadeImagem: "Boa",
      tipoAnalise: "completa",
      indicacaoOsteotomia: true,
      opcoesOsteotomia: [
        {
          id: "dfo",
          nome: "Default DFO option",
          nivel: "Femoral",
          correcao: 7,
          angulosPre: { HKA: 8, desvio: "Valgo", mLDFA: 80, aMPTA: 87 },
          angulosPos: { HKA: 1, mLDFA: 87, aMPTA: 87 },
          wblPre: 63,
          wblPos: 51,
          alertas: [],
          viavel: true,
          padrao: true,
        },
        {
          id: "hto",
          nome: "Chosen HTO option",
          nivel: "Tibial",
          correcao: 6,
          angulosPre: { HKA: 8, desvio: "Valgo", mLDFA: 87, aMPTA: 93 },
          angulosPos: { HKA: 1, mLDFA: 87, aMPTA: 87 },
          wblPre: 63,
          wblPos: 51,
          alertas: [],
          viavel: true,
        },
      ],
    };

    expect(isOsteotomySelectionRequired(analysis)).toBe(true);
    expect(isValidOsteotomySelection(analysis, null)).toBe(false);
    expect(() => generateXRayPDF(analysis)).toThrow(/explicitly selected/i);

    const { doc } = generateXRayPDF(analysis, undefined, undefined, 1);
    const pdfText = doc.output();
    expect(pdfText).toContain("Chosen HTO option");
    expect(pdfText).not.toContain("Default DFO option");
  });

  it("does not require a surgery choice when osteotomy is not indicated", () => {
    const analysis = {
      qualidadeImagem: "Boa",
      tipoAnalise: "eixo_mecanico",
      indicacaoOsteotomia: false,
      eixoMecanico: { graus: 1, desvio: "Neutro" },
      justificativa: "Sem indicação de osteotomia.",
    };

    expect(isOsteotomySelectionRequired(analysis)).toBe(false);
    expect(() => generateXRayPDF(analysis)).not.toThrow();
  });

  it("requires and renders the selected legacy option even without an indication flag", () => {
    const analysis = {
      qualidadeImagem: "Boa",
      tipoAnalise: "completa",
      indicacaoOsteotomia: false,
      opcoesOsteotomia: [{
        id: "legacy-hto",
        nome: "Legacy HTO option",
        nivel: "Tibial",
        correcao: 6,
        angulosPre: { HKA: 8, desvio: "Valgo", mLDFA: 87, aMPTA: 93 },
        angulosPos: { HKA: 1, mLDFA: 87, aMPTA: 87 },
        wblPre: 63,
        wblPos: 51,
        alertas: [],
        viavel: true,
      }],
    };

    expect(isOsteotomySelectionRequired(analysis)).toBe(true);
    const missingIndication = { ...analysis };
    delete missingIndication.indicacaoOsteotomia;
    expect(isOsteotomySelectionRequired(missingIndication)).toBe(true);
    expect(() => generateXRayPDF(analysis)).toThrow(/explicitly selected/i);
    const { doc } = generateXRayPDF(analysis, undefined, undefined, 0);
    const pdfText = doc.output();
    expect(pdfText).toContain("Legacy HTO option");
    expect(pdfText).toContain("OSTEOTOMIA SELECIONADA");
  });

  it("blocks an indicated plan with no selectable result instead of producing an incomplete PDF", () => {
    const analysis = {
      qualidadeImagem: "Boa",
      tipoAnalise: "osteotomia",
      indicacaoOsteotomia: true,
      opcoesOsteotomia: [],
    };

    expect(isOsteotomySelectionRequired(analysis)).toBe(true);
    expect(() => generateXRayPDF(analysis)).toThrow(/explicitly selected/i);
  });

  it("fails instead of silently omitting a supplied RX that cannot be decoded", () => {
    expect(() => generateXRayPDF(
      {
        qualidadeImagem: "Boa",
        tipoAnalise: "eixo_mecanico",
        eixoMecanico: { graus: 1, desvio: "Neutro" },
      },
      undefined,
      "data:image/jpeg;base64,not-an-image",
    )).toThrow(/X-ray image/i);
  });

  it("keeps the RX image in an image-only report when the result view is unmounted", () => {
    const { doc } = generateXRayPDF(
      {
        qualidadeImagem: "Boa",
        tipoAnalise: "completa",
        justificativa: "Imagem recebida.",
      },
      undefined,
      ONE_PIXEL_PNG,
    );

    const imageCollection = (doc.internal as unknown as {
      collections?: { addImage_images?: Record<string, unknown> };
    }).collections?.addImage_images;
    expect(Object.keys(imageCollection ?? {})).toHaveLength(1);
  });

  it("uses the selected File when a preview and saved image are unavailable", () => {
    const file = new File(["radiograph"], "hto.png", { type: "image/png" });
    expect(selectXRayPdfImageSource(null, null, file)).toEqual({ kind: "file", value: file });
    expect(selectXRayPdfImageSource("blob:preview", "/api/storage/objects/rx", file)).toEqual({
      kind: "preview",
      value: "blob:preview",
    });
    expect(selectXRayPdfImageSource(null, "/api/storage/objects/old-rx", file)).toEqual({
      kind: "file",
      value: file,
    });
    expect(getXRayPdfImageAcquisition({ kind: "file", value: file })).toBe("local");
    expect(getXRayPdfImageAcquisition({ kind: "preview", value: "blob:preview" })).toBe("local");
    expect(getXRayPdfImageAcquisition({ kind: "preview", value: "data:image/png;base64,abc" })).toBe("local");
    expect(getXRayPdfImageAcquisition({ kind: "saved", value: "/api/storage/objects/rx" })).toBe("remote");
  });

  it("keeps local File/blob sources away from fetch while remote sources use it", async () => {
    const file = new File(["radiograph"], "hto.png", { type: "image/png" });
    const readFile = vi.fn(async () => "data:image/png;base64,file");
    const fetchRemote = vi.fn(async (url: string) => `data:image/png;base64,${url}`);
    const readers = { readFile, fetchRemote };

    await expect(resolveXRayPdfImageDataUrl({ kind: "file", value: file }, readers))
      .resolves.toBe("data:image/png;base64,file");
    await expect(resolveXRayPdfImageDataUrl({ kind: "preview", value: "blob:preview" }, readers))
      .resolves.toBe("blob:preview");
    await expect(resolveXRayPdfImageDataUrl({ kind: "preview", value: "data:image/png;base64,local" }, readers))
      .resolves.toBe("data:image/png;base64,local");
    expect(fetchRemote).not.toHaveBeenCalled();

    await expect(resolveXRayPdfImageDataUrl({ kind: "saved", value: "/api/storage/objects/rx" }, readers))
      .resolves.toBe("data:image/png;base64,/api/storage/objects/rx");
    expect(fetchRemote).toHaveBeenCalledWith("/api/storage/objects/rx");
  });

  it("exposes actionable PDF block reasons without weakening the selection gate", () => {
    const indicated = { indicacaoOsteotomia: true, opcoesOsteotomia: [] };
    expect(getXRayPdfBlockReason(indicated, null, true)).toBe("osteotomy-options-unavailable");
    expect(getXRayPdfBlockReason({
      indicacaoOsteotomia: true,
      opcoesOsteotomia: [{ id: "hto" }],
    }, null, true)).toBe("osteotomy-selection-required");
    expect(getXRayPdfBlockReason({
      indicacaoOsteotomia: false,
    }, null, false)).toBe("xray-image-unavailable");
    expect(getXRayPdfBlockReason({
      indicacaoOsteotomia: false,
    }, null, true)).toBeNull();
  });

  it("accepts only the current asynchronous PDF generation", () => {
    expect(isCurrentXRayPdfGeneration(4, 4)).toBe(true);
    expect(isCurrentXRayPdfGeneration(5, 4)).toBe(false);
  });

  it("rejects a persisted index that no longer points to its persisted option id", () => {
    const analysis = {
      indicacaoOsteotomia: true,
      opcoesOsteotomia: [{ id: "hto" }, { id: "dfo" }],
    };
    expect(resolveSelectedOsteotomyOption(analysis, 0, "dfo")).toBeNull();
    expect(getXRayPdfBlockReason(analysis, null, true)).toBe("osteotomy-selection-required");
  });

  it("blocks an unsaved wedge simulation and allows the exact committed values", () => {
    const analysis = {
      indicacaoOsteotomia: true,
      opcoesOsteotomia: [{
        id: "hto",
        wedge_mm: 6.5,
      }],
    };
    expect(hasUnsavedOsteotomySimulation(analysis, 0, { dfoMm: 0, htoMm: 7 })).toBe(true);
    expect(getXRayPdfBlockReason(analysis, 0, true, true)).toBe("simulation-unsaved");
    expect(hasUnsavedOsteotomySimulation(analysis, 0, { dfoMm: 0, htoMm: 6.5 })).toBe(false);
    expect(hasUnsavedOsteotomySimulation(analysis, 0, null)).toBe(false);
    expect(getXRayPdfBlockReason(analysis, 0, true, false)).toBeNull();
  });

  it("keeps committed AmTF aligned with the existing displayed-HKA calculator", () => {
    expect(deriveDisplayedPostAmTf(1.5)).toBe(178.5);
    expect(deriveDisplayedPostAmTf(-4)).toBe(184);
  });

  it("does not invent a save requirement for a legacy angular-only option", () => {
    const analysis = {
      indicacaoOsteotomia: true,
      opcoesOsteotomia: [{
        id: "legacy-dfo",
        nome: "Legacy angular-only DFO",
        nivel: "Femoral",
        correcao: 7,
        angulosPre: { HKA: -8, mLDFA: 80, aMPTA: 87 },
        angulosPos: { HKA: -1, mLDFA: 87, aMPTA: 87 },
      }],
    };
    expect(hasUnsavedOsteotomySimulation(analysis, 0, null)).toBe(false);
    expect(getXRayPdfBlockReason(analysis, 0, true, false)).toBeNull();
  });

  it("exports a committed HTO snapshot with signed direction and no missing-angle zeroes", () => {
    const analysis = {
      qualidadeImagem: "Boa",
      tipoAnalise: "osteotomia",
      indicacaoOsteotomia: true,
      _selectedOsteotomiaIdx: 0,
      _selectedOsteotomiaId: "hto",
      opcoesOsteotomia: [{
        id: "hto",
        nome: "HTO saved simulation",
        nivel: "Tibial isolada",
        correcao: 5.5,
        wedge_mm: 8,
        angulosPre: { HKA: 8, desvio: "Varo", AmTF: 188, mLDFA: 91, aMPTA: 82 },
        angulosPos: { HKA: -1.7, desvio: "Varo", AmTF: 181.7 },
        wblPre: 63,
        wblPos: 61.8,
      }],
    };
    const { doc } = generateXRayPDF(analysis, undefined, undefined, 0);
    const pdfText = doc.output();
    expect(pdfText).toContain("5.5");
    expect(pdfText).toContain("8 mm");
    expect(pdfText).toContain("-1.7");
    expect(pdfText).toContain("181.7");
    expect(pdfText).toContain("Varo");
    expect(pdfText).toMatch(/\(--/);
    expect(pdfText).not.toContain("-6.3");
  });

  it("exports stored technique, side, measurements and JLCA adjustment without deriving AmTF", () => {
    const analysis = {
      qualidadeImagem: "Boa",
      tipoAnalise: "osteotomia",
      indicacaoOsteotomia: true,
      _selectedOsteotomiaIdx: 0,
      _selectedOsteotomiaId: "saved-hto",
      opcoesOsteotomia: [{
        id: "saved-hto",
        nome: "HTO physician adjustment",
        tecnica: "abertura medial tibial",
        lado: "direito",
        nivel: "Tibial isolada",
        correcao: 5.5,
        wedge_mm: 6.5,
        ajusteJLCA: 2.5,
        angulosPre: { HKA: 8, desvio: "Varo", AmTF: 222, AmLDF: 91, AmMPT: 82 },
        angulosPos: { HKA: 1, AmTF: 199, AmLDF: 87, AmMPT: 87 },
        wblPre: 63,
        wblPos: 62,
      }],
    };
    const { doc } = generateXRayPDF(analysis, undefined, undefined, 0);
    const pdfText = doc.output();
    expect(pdfText).toContain("abertura medial tibial");
    expect(pdfText).toContain("direito");
    expect(pdfText).toContain("222");
    expect(pdfText).toContain("199");
    expect(pdfText).toContain("2.5");
  });
});
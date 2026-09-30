import { describe, expect, it } from "vitest";
import {
  anatomicalSiteLabelsForResearch,
  applicationSitesForProductDetails,
  hasValidApplicationSitesExtension,
  synchronizeApplicationSiteLegacyFields,
} from "./regen-application-sites";

describe("regen application-site API boundary", () => {
  it("accepts a serialized repeatable array and preserves legacy-compatible rows", () => {
    const details = {
      locaisAplicacao: JSON.stringify([
        { localAplicacao: "Intra-articular", guia: "Ultrassom" },
        { localAplicacao: "Ligamento", guia: "Fluoroscopia" },
      ]),
      observacoes: "Sem alterações",
    };
    expect(hasValidApplicationSitesExtension(details)).toBe(true);
    expect(applicationSitesForProductDetails(details)).toHaveLength(2);
  });

  it("rejects malformed or incorrectly shaped serialized values", () => {
    expect(hasValidApplicationSitesExtension({ locaisAplicacao: "{bad" })).toBe(false);
    expect(hasValidApplicationSitesExtension({
      locaisAplicacao: JSON.stringify([{ localAplicacao: "Ligamento" }]),
    })).toBe(false);
    expect(hasValidApplicationSitesExtension({
      locaisAplicacao: JSON.stringify(["Ligamento"]),
    })).toBe(false);
  });

  it("falls back to legacy singular values", () => {
    expect(applicationSitesForProductDetails({
      localAplicacao: "Intra-articular",
      guia: "Artroscopia",
    })).toEqual([{ localAplicacao: "Intra-articular", guia: "Artroscopia" }]);
  });

  it("synchronizes singular compatibility fields to the first repeatable row", () => {
    expect(synchronizeApplicationSiteLegacyFields({
      locaisAplicacao: JSON.stringify([
        { localAplicacao: "Ligamento", guia: "Fluoroscopia" },
        { localAplicacao: "Ligamento", guia: "Ultrassom" },
      ]),
      localAplicacao: "Intra-articular",
      guia: "Artroscopia",
      observacoes: "Preservar",
    })).toMatchObject({
      localAplicacao: "Ligamento",
      guia: "Fluoroscopia",
      observacoes: "Preservar",
    });
  });
});

describe("anatomical structure fields", () => {
  const details = (rows: Record<string, unknown>[]) => ({ locaisAplicacao: JSON.stringify(rows) });

  it("keeps the free-text complement and validates its type", () => {
    const pd = details([{ localAplicacao: "", guia: "", estruturaAnatomica: "OUTRO", estruturaAnatomicaDetalhe: "ligamento anular" }]);
    expect(applicationSitesForProductDetails(pd)).toEqual([
      { localAplicacao: "", guia: "", estruturaAnatomica: "OUTRO", estruturaAnatomicaDetalhe: "ligamento anular" },
    ]);
    expect(hasValidApplicationSitesExtension(details([{ localAplicacao: "", guia: "", estruturaAnatomica: "OUTRO", estruturaAnatomicaDetalhe: 1 }]))).toBe(false);
  });

  it("research labels: catalog labels in the doctor's language, legacy aliases included, free text and unknown values never", () => {
    const pd = details([
      { localAplicacao: "", guia: "", estruturaAnatomica: "MAO_POLIA_A1" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "PUNHO" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "OUTRO", estruturaAnatomicaDetalhe: "Nome do paciente" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "Valor desconhecido" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "MAO_POLIA_A1" },
    ]);
    expect(anatomicalSiteLabelsForResearch(pd)).toBe("Polia A1 (dedo em gatilho); Punho; Outro (especificar)");
    expect(anatomicalSiteLabelsForResearch(pd, "es")).toBe("Polea A1 (dedo en gatillo); Muñeca; Otro (especificar)");
    expect(anatomicalSiteLabelsForResearch({})).toBe("");
    expect(anatomicalSiteLabelsForResearch(null)).toBe("");
  });
});

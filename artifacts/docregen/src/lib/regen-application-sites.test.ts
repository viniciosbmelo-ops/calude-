import { describe, expect, it } from "vitest";
import {
  APPLICATION_ANATOMICAL_SITE_GROUPS,
  anatomicalSiteDisplay,
  anatomicalSiteLabel,
  anatomicalSiteNeedsDetail,
  isOfferedAnatomicalSite,
  parseApplicationSites,
  syncApplicationSites,
} from "./regen-application-sites";

describe("regenerative application sites", () => {
  it("serializes multiple sites while mirroring the first site to legacy fields", () => {
    const result = syncApplicationSites(
      { observacoes: "Aplicar conforme avaliação" },
      [
        { localAplicacao: "Intra-articular", guia: "Ultrassom" },
        { localAplicacao: "Ligamento", guia: "Referência anatômica (às cegas)" },
      ],
    );

    expect(result.localAplicacao).toBe("Intra-articular");
    expect(result.guia).toBe("Ultrassom");
    expect(JSON.parse(result.locaisAplicacao)).toEqual([
      { localAplicacao: "Intra-articular", guia: "Ultrassom" },
      { localAplicacao: "Ligamento", guia: "Referência anatômica (às cegas)" },
    ]);
    expect(result.observacoes).toBe("Aplicar conforme avaliação");
    expect(parseApplicationSites(result)).toHaveLength(2);
  });

  it("keeps legacy singular cases readable", () => {
    expect(parseApplicationSites({
      localAplicacao: "Intra-articular",
      guia: "Artroscopia",
    })).toEqual([{ localAplicacao: "Intra-articular", guia: "Artroscopia" }]);
  });

  it("uses the legacy value when a malformed extension is present", () => {
    expect(parseApplicationSites({
      locaisAplicacao: "{not-json",
      localAplicacao: "Ligamento",
      guia: "Fluoroscopia",
    })).toEqual([{ localAplicacao: "Ligamento", guia: "Fluoroscopia" }]);
  });

  it("clears removed sites without dropping shared observations", () => {
    const result = syncApplicationSites(
      {
        locaisAplicacao: JSON.stringify([{ localAplicacao: "Intra-articular", guia: "Ultrassom" }]),
        localAplicacao: "Intra-articular",
        guia: "Ultrassom",
        observacoes: "Sem dados adicionais",
      },
      [],
    );

    expect(result.locaisAplicacao).toBeUndefined();
    expect(result.localAplicacao).toBe("");
    expect(result.guia).toBe("");
    expect(result.observacoes).toBe("Sem dados adicionais");
  });

  it("persists and reads back the optional anatomical structure per row", () => {
    const result = syncApplicationSites({}, [
      { localAplicacao: "Intra-articular", guia: "Ultrassom", estruturaAnatomica: " JOELHO " },
      { localAplicacao: "", guia: "", estruturaAnatomica: "TENDAO_AQUILES" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "" },
    ]);
    expect(JSON.parse(result.locaisAplicacao)).toEqual([
      { localAplicacao: "Intra-articular", guia: "Ultrassom", estruturaAnatomica: "JOELHO" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "TENDAO_AQUILES" },
    ]);
    expect(parseApplicationSites(result).map((site) => site.estruturaAnatomica)).toEqual(["JOELHO", "TENDAO_AQUILES"]);
    expect(anatomicalSiteLabel("TENDAO_AQUILES", "pt-BR")).toBe("Tendão de Aquiles");
    expect(anatomicalSiteLabel("TENDAO_AQUILES", "es")).toBe("Tendón de Aquiles");
    expect(anatomicalSiteLabel("Livre", "es")).toBe("Livre");
  });

  it("labels new codes and legacy aliases in pt-BR and es", () => {
    expect(anatomicalSiteLabel("MAO_POLIA_A1", "pt-BR")).toBe("Polia A1 (dedo em gatilho)");
    expect(anatomicalSiteLabel("MAO_POLIA_A1", "es")).toBe("Polea A1 (dedo en gatillo)");
    expect(anatomicalSiteLabel("COLUNA_FACETARIA_LOMBAR", "es")).toBe("Facetaria lumbar");
    expect(anatomicalSiteLabel("JOELHO", "pt-BR")).toBe("Joelho");
    expect(anatomicalSiteLabel("MENISCO", "es")).toBe("Menisco");
  });

  it("offers only the current catalog; legacy/unknown values are kept apart", () => {
    expect(isOfferedAnatomicalSite("")).toBe(true);
    expect(isOfferedAnatomicalSite("JOELHO_TIBIOFEMORAL")).toBe(true);
    expect(isOfferedAnatomicalSite("SACROILIACA")).toBe(true);
    expect(isOfferedAnatomicalSite("JOELHO")).toBe(false);
    expect(isOfferedAnatomicalSite("Texto antigo")).toBe(false);
    expect(APPLICATION_ANATOMICAL_SITE_GROUPS.map(({ group, sites }) => [group.code, sites.length])).toEqual([
      ["ombro", 6], ["cotovelo", 4], ["punho_mao", 6], ["quadril", 5], ["joelho", 11],
      ["pe_tornozelo", 6], ["coluna", 5], ["pelve", 1], ["outros", 2],
    ]);
  });

  it("keeps the free-text complement only for Músculo/Outro (especificar)", () => {
    expect(anatomicalSiteNeedsDetail("MUSCULO")).toBe(true);
    expect(anatomicalSiteNeedsDetail("OUTRO")).toBe(true);
    expect(anatomicalSiteNeedsDetail("MAO_POLIA_A1")).toBe(false);
    const result = syncApplicationSites({}, [
      { localAplicacao: "", guia: "", estruturaAnatomica: "MUSCULO", estruturaAnatomicaDetalhe: " reto femoral " },
      { localAplicacao: "", guia: "", estruturaAnatomica: "MAO_POLIA_A1", estruturaAnatomicaDetalhe: "stale" },
    ]);
    expect(JSON.parse(result.locaisAplicacao)).toEqual([
      { localAplicacao: "", guia: "", estruturaAnatomica: "MUSCULO", estruturaAnatomicaDetalhe: "reto femoral" },
      { localAplicacao: "", guia: "", estruturaAnatomica: "MAO_POLIA_A1" },
    ]);
    const [muscle, pulley] = parseApplicationSites(result);
    expect(anatomicalSiteDisplay(muscle, "pt-BR")).toBe("Músculo (especificar): reto femoral");
    expect(anatomicalSiteDisplay(pulley, "es")).toBe("Polea A1 (dedo en gatillo)");
    expect(anatomicalSiteDisplay({ localAplicacao: "Intra-articular", guia: "" }, "pt-BR")).toBe("");
  });
});

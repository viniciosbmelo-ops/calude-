import { describe, expect, it } from "vitest";
import {
  anatomicalSiteLabel,
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
});

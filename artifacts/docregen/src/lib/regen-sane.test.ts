import { describe, expect, it } from "vitest";
import { REGEN_CONDITION_CATALOG, LEGACY_REGEN_CONDITIONS } from "./regen-conditions";
import { SANE_REGIONS, saneDefForName, saneForCase, saneForCondition, saneLabel, saneQuestion } from "./regen-sane";
import { syncApplicationSites } from "./regen-application-sites";
import { APPLICATION_ANATOMICAL_SITES, LEGACY_APPLICATION_ANATOMICAL_SITES } from "@workspace/clinical/application-sites";
import { buildPromTimeline, normalizePromInstrument, promSeries, scheduleRowsForCase } from "./regen-case-detail";
import { assessChange, promDirection } from "./regen-knee-measures";
import { getRegenScales } from "@/locales/regen-questionnaire";
import { regenSaneMessages } from "@/locales/regen-sane";
// The API owns the follow-up schedule; both sides must agree on the region SANE.
import * as apiSane from "../../../docregen-api/src/lib/regen-sane";
import * as apiSchedule from "../../../docregen-api/src/lib/regen-followup-schedule";
import * as apiLabels from "../../../docregen-api/src/lib/regen-labels";

const EXPECTED_BY_REGION: Record<string, string | null> = {
  joelho: "SANE_JOELHO",
  ombro: "SANE_OMBRO",
  quadril: "SANE_QUADRIL",
  cotovelo: "SANE_COTOVELO",
  pe_tornozelo: "SANE_TORNOZELO_PE",
  punho_mao: "SANE_PUNHO_MAO",
  coluna_cervical: "SANE_COLUNA",
  coluna_toracica: "SANE_COLUNA",
  coluna_lombar: "SANE_COLUNA",
  outras: null,
};

describe("case SANE from the application sites (conditions without a region)", () => {
  const details = (...estruturas: string[]) =>
    syncApplicationSites({}, estruturas.map((estruturaAnatomica) => ({ localAplicacao: "Intra-articular", guia: "Ultrassom", estruturaAnatomica })));

  it("region-less conditions take the single site region; the condition region always wins", () => {
    expect(saneForCase("CONDRAL_FOCAL", details("JOELHO"))?.scale).toBe("SANE Joelho");
    expect(saneForCase("TENDINOPATIA", details("TENDAO_AQUILES"))?.scale).toBe("SANE Tornozelo e Pé");
    expect(saneForCase("CONDRAL_FOCAL", details("JOELHO", "OMBRO"))).toBeNull();
    expect(saneForCase("CONDRAL_FOCAL", {})).toBeNull();
    expect(saneForCase("CONDRAL_FOCAL", undefined)).toBeNull();
    expect(saneForCase("CONDRAL_FOCAL", details("OUTRO"))).toBeNull();
    expect(saneForCase("OA_OMBRO", details("JOELHO"))?.scale).toBe("SANE Ombro");
  });

  it("new catalog codes: Polia A1 → Punho e Mão, Facetária lombar → Coluna, Sacroilíaca → VAS only", () => {
    expect(saneForCase("TENDINOPATIA", details("MAO_POLIA_A1"))?.scale).toBe("SANE Punho e Mão");
    expect(saneForCase("CONDRAL_FOCAL", details("COLUNA_FACETARIA_LOMBAR"))?.scale).toBe("SANE Coluna");
    expect(saneForCase("CONDRAL_FOCAL", details("COLUNA_PERIDURAL"))?.scale).toBe("SANE Coluna");
    expect(saneForCase("CONDRAL_FOCAL", details("SACROILIACA"))).toBeNull();
    expect(saneForCase("CONDRAL_FOCAL", details("JOELHO_MENISCO_MEDIAL", "MENISCO"))?.scale).toBe("SANE Joelho");
  });

  it("agrees with the API for every region-less condition × anatomical site, and for the schedule", () => {
    const regionless = [...REGEN_CONDITION_CATALOG.filter((c) => c.region === "outras").map((c) => c.code), ...Object.keys(LEGACY_REGEN_CONDITIONS)];
    for (const code of regionless) {
      for (const site of [...APPLICATION_ANATOMICAL_SITES, ...LEGACY_APPLICATION_ANATOMICAL_SITES]) {
        const pd = details(site.code);
        const web = saneForCase(code, pd)?.code ?? null;
        expect(web, `${code}/${site.code}`).toBe(apiSane.saneForCase(code, pd)?.code ?? null);
        const webRows = scheduleRowsForCase(["PRP"], [], saneForCase(code, pd)?.scale ?? null).map((r) => [r.periodo, r.scales]);
        const apiRows = apiSchedule.regenFollowupScheduleFor(["PRP"], code, pd).map((r) => [r.periodo, r.scales]);
        expect(webRows, `${code}/${site.code}`).toEqual(apiRows);
      }
    }
  });
});

describe("condition → region SANE", () => {
  it("maps every catalog condition by its region (one SANE per case; 'outras' → VAS only)", () => {
    for (const c of REGEN_CONDITION_CATALOG) {
      expect(saneForCondition(c.code)?.code ?? null, c.code).toBe(EXPECTED_BY_REGION[c.region]);
    }
    expect(saneForCondition("OA_OMBRO")?.scale).toBe("SANE Ombro");
    expect(saneForCondition("HERNIA_DISCAL_CERVICAL")?.scale).toBe("SANE Coluna");
    expect(saneForCondition("FASCITE_PLANTAR")?.scale).toBe("SANE Tornozelo e Pé");
    expect(saneForCondition("SINDROME_TUNEL_CARPO")?.scale).toBe("SANE Punho e Mão");
    // Unknown / legacy codes: VAS only (same as the knee rule before).
    for (const code of [...Object.keys(LEGACY_REGEN_CONDITIONS), "NOPE", "", null, undefined]) {
      expect(saneForCondition(code), String(code)).toBeNull();
    }
  });

  it("agrees with the API for every condition and for the follow-up schedule", () => {
    for (const c of REGEN_CONDITION_CATALOG) {
      expect(saneForCondition(c.code)?.code ?? null, c.code).toBe(apiSane.saneForCondition(c.code)?.code ?? null);
      const web = scheduleRowsForCase(["PRP"], [], saneForCondition(c.code)?.scale ?? null).map((r) => [r.periodo, r.scales]);
      const api = apiSchedule.regenFollowupScheduleFor(["PRP"], c.code).map((r) => [r.periodo, r.scales]);
      expect(web, c.code).toEqual(api);
    }
  });
});

describe("labels and wording per region", () => {
  it("labels pt-BR / es (web and API presentation)", () => {
    const labels = SANE_REGIONS.map((d) => [saneLabel(d, "pt-BR"), saneLabel(d, "es")]);
    expect(labels).toEqual([
      ["SANE Ombro", "SANE Hombro"],
      ["SANE Joelho", "SANE Rodilla"],
      ["SANE Quadril", "SANE Cadera"],
      ["SANE Cotovelo", "SANE Codo"],
      ["SANE Tornozelo e Pé", "SANE Tobillo y Pie"],
      ["SANE Punho e Mão", "SANE Muñeca y Mano"],
      ["SANE Coluna", "SANE Columna"],
    ]);
    for (const d of SANE_REGIONS) {
      expect(apiLabels.regenScaleForLocale(d.scale, "es")).toBe(d.label.es);
      expect(apiLabels.regenScaleForLocale(d.code, "pt-BR")).toBe(d.label["pt-BR"]);
    }
  });

  it("patient questionnaire asks each region's SANE (0–100 slider, answer id 'sane') with correct articles", () => {
    const pt = getRegenScales("pt-BR");
    const es = getRegenScales("es");
    const q = (scales: typeof pt, name: string) => scales[name]!.questions[0]!;
    for (const d of SANE_REGIONS) {
      expect(q(pt, d.scale)).toEqual(expect.objectContaining({ id: "sane", type: "slider", min: 0, max: 100, step: 1 }));
      expect(q(es, d.scale).id).toBe("sane");
      expect(pt[d.scale]!.calcScore({ sane: 64 })).toBe(64);
    }
    expect(q(pt, "SANE Ombro").label).toBe("Em uma escala de 0 a 100, sendo 100 um ombro completamente normal, como você avalia seu ombro hoje?");
    expect(q(pt, "SANE Quadril").label).toBe("Em uma escala de 0 a 100, sendo 100 um quadril completamente normal, como você avalia seu quadril hoje?");
    expect(q(pt, "SANE Cotovelo").label).toBe("Em uma escala de 0 a 100, sendo 100 um cotovelo completamente normal, como você avalia seu cotovelo hoje?");
    expect(q(pt, "SANE Tornozelo e Pé").label).toBe("Em uma escala de 0 a 100, sendo 100 um tornozelo/pé completamente normal, como você avalia seu tornozelo/pé hoje?");
    expect(q(pt, "SANE Punho e Mão").label).toBe("Em uma escala de 0 a 100, sendo 100 um punho/uma mão completamente normal, como você avalia seu punho/sua mão hoje?");
    expect(q(pt, "SANE Coluna").label).toBe("Em uma escala de 0 a 100, sendo 100 uma coluna completamente normal, como você avalia sua coluna hoje?");
    expect(q(pt, "SANE Joelho").label).toBe("Em uma escala de 0 a 100, sendo 100 um joelho completamente normal, como você avalia seu joelho hoje?");
    expect(q(es, "SANE Ombro").label).toBe("En una escala de 0 a 100, donde 100 es un hombro completamente normal, ¿cómo evalúa su hombro hoy?");
    expect(q(es, "SANE Quadril").label).toContain("100 es una cadera completamente normal, ¿cómo evalúa su cadera hoy?");
    expect(q(es, "SANE Cotovelo").label).toContain("100 es un codo completamente normal, ¿cómo evalúa su codo hoy?");
    expect(q(es, "SANE Tornozelo e Pé").label).toContain("100 es un tobillo/pie completamente normal");
    expect(q(es, "SANE Punho e Mão").label).toContain("100 es una muñeca/mano completamente normal");
    expect(q(es, "SANE Coluna").label).toContain("100 es una columna completamente normal, ¿cómo evalúa su columna hoy?");
    expect(pt["SANE Coluna"]!.title).toBe("Avaliação da coluna (SANE)");
    expect(es["SANE Ombro"]!.title).toBe("Evaluación del hombro (SANE)");
    // Knee copy unchanged.
    expect(pt["SANE Joelho"]!.title).toBe("Avaliação do joelho (SANE)");
    expect(pt["SANE Joelho"]!.description).toBe("Uma única pergunta sobre como está o seu joelho hoje. Mova o controle deslizante de 0 a 100.");
    expect(es["SANE Joelho"]!.description).toBe("Una sola pregunta sobre cómo está su rodilla hoy. Mueva el control deslizante de 0 a 100.");
    // VAS stays region-neutral.
    expect(Object.keys(pt).sort()).toEqual(["VAS Dor", ...SANE_REGIONS.map((d) => d.scale)].sort());
  });

  it("clinician help text is the region question; spine carries the limited-validation note", () => {
    expect(saneQuestion(saneForCondition("OA_OMBRO")!, "es")).toContain("hombro");
    expect(SANE_REGIONS.filter((d) => d.limitedValidation).map((d) => d.scale)).toEqual(["SANE Coluna"]);
    expect(regenSaneMessages["pt-BR"].spineNote).toMatch(/validação limitada para a coluna/);
    expect(regenSaneMessages.es.spineNote).toMatch(/validación limitada para la columna/);
  });
});

describe("PROM series per region SANE", () => {
  it("normalizes both spellings to the follow-up name and keeps one series per SANE", () => {
    expect(normalizePromInstrument("SANE_OMBRO")).toBe("SANE Ombro");
    expect(normalizePromInstrument("SANE Hombro")).toBe("SANE Ombro");
    expect(normalizePromInstrument("sane-coluna")).toBe("SANE Coluna");
    expect(normalizePromInstrument("SANE_TORNOZELO_PE")).toBe("SANE Tornozelo e Pé");
    expect(normalizePromInstrument("SANE_JOELHO")).toBe("SANE Joelho");
    expect(normalizePromInstrument("SANE-joelho")).toBe("SANE Joelho");
    expect(normalizePromInstrument("WOMAC")).toBe("WOMAC");
    expect(saneDefForName("KOOS")).toBeNull();

    const points = buildPromTimeline(
      [
        { id: 1, instrument: "SANE_OMBRO", timepoint: "Pré-operatório / Basal", score: 40, answered_at: "2026-01-10T15:00:00Z" },
        { id: 2, instrument: "VAS", timepoint: "Pré-operatório / Basal", score: 7, answered_at: "2026-01-10T15:00:00Z" },
      ],
      [{ id: "n", periodo: "3 meses", days_after_procedure: 90, responses: [
        { nome_escala: "SANE Ombro", score: "75", completado_em: "2026-04-10T15:00:00Z" },
        { nome_escala: "VAS Dor", score: "3", completado_em: "2026-04-10T15:00:00Z" },
      ] }],
    );
    const series = promSeries(points);
    expect(series).toEqual(expect.arrayContaining([
      expect.objectContaining({ instrument: "SANE Ombro", values: [40, 75], delta: 35 }),
      expect.objectContaining({ instrument: "VAS", values: [7, 3], delta: -4 }),
    ]));
  });

  it("direction: every region SANE is higher = better; VAS lower = better", () => {
    for (const d of SANE_REGIONS) {
      expect(promDirection(d.scale), d.scale).toBe("higher");
      expect(assessChange(promDirection(d.scale), 20)).toBe("better");
      expect(assessChange(promDirection(d.scale), -20)).toBe("worse");
    }
    expect(promDirection("VAS")).toBe("lower");
  });
});

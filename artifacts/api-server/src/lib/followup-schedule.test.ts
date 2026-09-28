import { describe, expect, it } from "vitest";
import {
  buildNotificationsForSurgery,
  FOLLOWUP_SCHEDULE,
  filterSupportedFollowupScales,
  isSupportedFollowupScale,
  SUPPORTED_FOLLOWUP_SCALES,
  hasFractureProcedure,
  isHiddenFracturePreoperative,
  isPreoperativePeriod,
  resolveFollowupRegion,
} from "./followup-schedule";

describe("follow-up pré-operatório", () => {
  it("reconhece os períodos pré-operatórios usados nos dois módulos", () => {
    expect(isPreoperativePeriod("Pré-operatório")).toBe(true);
    expect(isPreoperativePeriod("Pré-op (Baseline)")).toBe(true);
    expect(isPreoperativePeriod("6 semanas")).toBe(false);
  });

  it("considera fratura de ombro ou cotovelo, inclusive combinada, como cirurgia de fratura", () => {
    expect(hasFractureProcedure(["SH_CUFF", "SH_FRACTURE"])).toBe(true);
    expect(hasFractureProcedure(["EL_FRACTURE"])).toBe(true);
    expect(hasFractureProcedure(["SH_CUFF"])).toBe(false);
  });

  it("centraliza a ocultação do histórico pré-op de fraturas sem ocultar pós-operatório", () => {
    expect(isHiddenFracturePreoperative(["SH_INSTABILITY", "SH_FRACTURE"], "Pré-op (Baseline)")).toBe(true);
    expect(isHiddenFracturePreoperative(["SH_FRACTURE"], "6 semanas")).toBe(false);
    expect(isHiddenFracturePreoperative(["SH_INSTABILITY"], "Pré-operatório")).toBe(false);
  });

  it("não cria pré-operatório em cirurgia combinada com fratura", () => {
    const notifications = buildNotificationsForSurgery(10, 20, "2026-09-01", ["SH_CUFF", "SH_FRACTURE"]);
    expect(notifications.some((row) => isPreoperativePeriod(row.periodo))).toBe(false);
    expect(notifications.some((row) => row.periodo === "6 semanas")).toBe(true);
  });

  it("fratura (ombro ou cotovelo) recebe VAS Dor + SANE nos 4 momentos pós-operatórios", () => {
    for (const tipo of ["SH_FRACTURE", "EL_FRACTURE"]) {
      const notifications = buildNotificationsForSurgery(10, 20, "2026-09-01", [tipo]);
      expect(notifications.map((row) => row.periodo)).toEqual(["6 semanas", "3 meses", "6 meses", "1 ano"]);
      for (const row of notifications) expect(row.scales).toEqual(["VAS Dor", "SANE"]);
    }
  });

  it("cria um único pré-operatório e envia VAS Dor + SANE em todos os momentos", () => {
    const notifications = buildNotificationsForSurgery(10, 20, "2026-09-01", ["SH_CUFF", "SH_BICEPS_SLAP"]);
    expect(notifications.filter((row) => isPreoperativePeriod(row.periodo))).toHaveLength(1);
    expect(notifications.map((row) => row.periodo)).toEqual([
      "Pré-operatório", "6 semanas", "3 meses", "6 meses", "1 ano",
    ]);
    for (const row of notifications) expect(row.scales).toEqual(["VAS Dor", "SANE"]);
    expect(notifications.find((row) => row.periodo === "6 semanas")?.scheduledDate).toBe("2026-10-13");
  });
});

describe("escalas suportadas no seguimento", () => {
  it("derivam do cronograma atual", () => {
    expect(SUPPORTED_FOLLOWUP_SCALES).toEqual(new Set(FOLLOWUP_SCHEDULE.flatMap((entry) => entry.scales)));
    expect(SUPPORTED_FOLLOWUP_SCALES).toEqual(new Set(["VAS Dor", "SANE"]));
    expect(isSupportedFollowupScale("VAS Dor")).toBe(true);
    expect(isSupportedFollowupScale("SANE")).toBe(true);
    expect(isSupportedFollowupScale("Lysholm")).toBe(false);
    // Licença pendente: não entram no cronograma do paciente.
    expect(isSupportedFollowupScale("ASES")).toBe(false);
    expect(isSupportedFollowupScale("MEPS")).toBe(false);
  });

  it("remove escalas do joelho de linhas antigas sem alterar a entrada", () => {
    const legacy = ["VAS Dor", "Lysholm", "IKDC", "VAS Dor"];
    expect(filterSupportedFollowupScales(legacy)).toEqual(["VAS Dor"]);
    expect(legacy).toEqual(["VAS Dor", "Lysholm", "IKDC", "VAS Dor"]);
    expect(filterSupportedFollowupScales(["KOOS"])).toEqual([]);
    expect(filterSupportedFollowupScales(null)).toEqual([]);
  });
});

describe("região da cirurgia para o texto do SANE", () => {
  it("usa surgeries.regiao e, sem ela, deduz pelo tipo de caso", () => {
    expect(resolveFollowupRegion("elbow", ["SH_CUFF"])).toBe("elbow");
    expect(resolveFollowupRegion("shoulder", null)).toBe("shoulder");
    expect(resolveFollowupRegion(null, ["EL_FRACTURE", "EL_ORTHOBIO"])).toBe("elbow");
    expect(resolveFollowupRegion(undefined, ["SH_CUFF"])).toBe("shoulder");
  });

  it("não adivinha quando a região é ambígua ou desconhecida", () => {
    expect(resolveFollowupRegion(null, ["SH_CUFF", "EL_FRACTURE"])).toBeNull();
    expect(resolveFollowupRegion("joelho", [])).toBeNull();
    expect(resolveFollowupRegion(null, ["LEGACY"])).toBeNull();
  });
});

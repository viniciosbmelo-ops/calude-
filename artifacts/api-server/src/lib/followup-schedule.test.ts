import { describe, expect, it } from "vitest";
import {
  buildNotificationsForSurgery,
  hasFractureProcedure,
  isHiddenFracturePreoperative,
  isPreoperativePeriod,
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

  it("cria um único pré-operatório e só envia a escala de dor", () => {
    const notifications = buildNotificationsForSurgery(10, 20, "2026-09-01", ["SH_CUFF", "SH_BICEPS_SLAP"]);
    expect(notifications.filter((row) => isPreoperativePeriod(row.periodo))).toHaveLength(1);
    expect(new Set(notifications.flatMap((row) => row.scales))).toEqual(new Set(["VAS Dor"]));
    expect(notifications.find((row) => row.periodo === "6 semanas")?.scheduledDate).toBe("2026-10-13");
  });
});

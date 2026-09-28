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

  it("considera procedimentos combinados com Fraturas como cirurgia de fratura", () => {
    expect(hasFractureProcedure(["Lesão Meniscal", "Fraturas"])).toBe(true);
    expect(hasFractureProcedure(["Lesão Meniscal"])).toBe(false);
  });

  it("centraliza a ocultação do histórico pré-op de Fraturas sem ocultar pós-operatório", () => {
    expect(isHiddenFracturePreoperative(
      ["Lesão Ligamentar", "Fraturas"],
      "Pré-op (Baseline)",
    )).toBe(true);
    expect(isHiddenFracturePreoperative(["Fraturas"], "6 semanas")).toBe(false);
    expect(isHiddenFracturePreoperative(["Lesão Ligamentar"], "Pré-operatório")).toBe(false);
  });

  it("não cria pré-operatório em cirurgia combinada com fratura", () => {
    const notifications = buildNotificationsForSurgery(
      10,
      20,
      [],
      "2026-09-01",
      ["Lesão Meniscal", "Fraturas"],
    );

    expect(notifications.some((row) => isPreoperativePeriod(row.periodo))).toBe(false);
    expect(notifications.some((row) => row.periodo === "6 semanas")).toBe(true);
  });

  it("cria um único pré-operatório para protocolos não fraturários combinados", () => {
    const notifications = buildNotificationsForSurgery(
      10,
      20,
      ["LCA"],
      "2026-09-01",
      ["Lesão Meniscal"],
    );

    expect(notifications.filter((row) => isPreoperativePeriod(row.periodo))).toHaveLength(1);
  });
});
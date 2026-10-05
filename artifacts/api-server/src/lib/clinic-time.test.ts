import { describe, expect, it } from "vitest";
import { addDays, ageOn, clinicDayBounds, clinicDayStart, clinicToday, monthRange, weekRange } from "./clinic-time";
import { clinicToday as reexported, CLINIC_TIME_ZONE } from "./followup-assessment";

// 2026-10-31 22:30 em São Paulo = 2026-11-01 01:30 UTC (já é domingo e novembro em UTC)
const EVENING_SP = new Date("2026-11-01T01:30:00Z");

describe("calendário da clínica (America/Sao_Paulo)", () => {
  it("às 22:30 em São Paulo, hoje ainda é o dia de São Paulo, não o dia UTC", () => {
    expect(EVENING_SP.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(clinicToday(EVENING_SP)).toBe("2026-10-31");
    expect(reexported(EVENING_SP)).toBe("2026-10-31");
    expect(CLINIC_TIME_ZONE).toBe("America/Sao_Paulo");
  });

  it("semana (domingo a sábado) e mês a partir do dia da clínica", () => {
    expect(weekRange(clinicToday(EVENING_SP))).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(monthRange(clinicToday(EVENING_SP))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(weekRange("2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("soma de dias sem fuso", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-05", 7)).toBe("2026-10-12");
  });

  it("limites do dia em São Paulo (UTC−3)", () => {
    expect(clinicDayStart("2026-10-31").toISOString()).toBe("2026-10-31T03:00:00.000Z");
    const { start, end } = clinicDayBounds("2026-10-31");
    expect(start.toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T02:59:59.999Z");
    expect(EVENING_SP >= start && EVENING_SP <= end).toBe(true);
  });

  it("idade em anos completos no dia da clínica", () => {
    expect(ageOn("1980-11-01", "2026-10-31")).toBe(45);
    expect(ageOn("1980-10-31", "2026-10-31")).toBe(46);
    expect(ageOn("sem data", "2026-10-31")).toBeNull();
  });
});

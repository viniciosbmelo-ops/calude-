import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatCalendarDate,
  formatPersonName,
  parseCalendarDate,
  safeFormatDate,
  toCalendarDateKey,
} from "./utils";

// The vitest project already runs DocRegen tests in America/Sao_Paulo; pin it
// here too so this file keeps proving the UTC-3 behaviour on its own.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Sao_Paulo"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("calendar dates in America/Sao_Paulo", () => {
  it("runs west of UTC (the preview bug needs a negative offset)", () => {
    expect(new Date(2026, 8, 29).getTimezoneOffset()).toBe(180);
    // The bug: midnight-UTC serialisation rendered through the local zone.
    expect(new Intl.DateTimeFormat("pt-BR").format(new Date("2026-09-29T00:00:00.000Z"))).toBe("28/09/2026");
  });

  it("renders 2026-09-29 as 29/09/2026 in both serialisations", () => {
    expect(formatCalendarDate("2026-09-29", "pt-BR")).toBe("29/09/2026");
    expect(formatCalendarDate("2026-09-29T00:00:00.000Z", "pt-BR")).toBe("29/09/2026");
    expect(formatCalendarDate("2026-09-29", "es")).toBe("29/09/2026");
  });

  it("parses the calendar day, never the UTC instant", () => {
    const d = parseCalendarDate("2026-09-29T00:00:00.000Z")!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 29]);
    expect(toCalendarDateKey("2026-09-29T00:00:00.000Z")).toBe("2026-09-29");
    expect(toCalendarDateKey("2026-09-29")).toBe("2026-09-29");
    expect(toCalendarDateKey(new Date(2026, 8, 29, 23, 30))).toBe("2026-09-29");
  });

  it("never throws and returns a fallback for invalid input", () => {
    // The follow-up central crash: "<full ISO>T00:00:00" is an invalid date.
    const broken = "2026-09-29T00:00:00.000ZT00:00:00";
    expect(() => new Intl.DateTimeFormat("pt-BR").format(new Date(broken))).toThrow();
    expect(safeFormatDate(broken, "pt-BR")).toBe("—");
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDate("")).toBe("—");
    expect(formatCalendarDate("not a date")).toBe("—");
    expect(formatCalendarDate("2026-02-30")).toBe("—");
    expect(safeFormatDate(undefined)).toBe("—");
    expect(safeFormatDate("2026-09-29", "pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("29/09/2026");
  });
});

describe("formatPersonName", () => {
  it("title-cases uppercase names keeping Portuguese particles lowercase", () => {
    expect(formatPersonName("PACIENTE FICTÍCIO ALFA")).toBe("Paciente Fictício Alfa");
    expect(formatPersonName("maria DA silva e souza")).toBe("Maria da Silva e Souza");
    expect(formatPersonName("  ANA-LUÍSA   D'ÁVILA ")).toBe("Ana-Luísa D'Ávila");
    expect(formatPersonName(null)).toBe("");
  });
});

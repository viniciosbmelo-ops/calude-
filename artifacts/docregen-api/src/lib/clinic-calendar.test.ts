import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localeDate } from "./locale";
import { clinicToday } from "./regen-followup-schedule";

/**
 * Server in UTC (as in production), clock at 23:30 in Brasília on 29/09/2026
 * = 02:30 UTC on 30/09/2026: "today" and document issue dates must still be
 * the clinic's 29/09/2026.
 */
const originalTz = process.env.TZ;

beforeAll(() => { process.env.TZ = "UTC"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T23:30:00-03:00"));
});
afterEach(() => { vi.useRealTimers(); });

describe("DocRegen clinic calendar at 23:30 BRT (02:30 UTC next day)", () => {
  it("today is 2026-09-29, not the UTC day", () => {
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(clinicToday()).toBe("2026-09-29");
  });

  it("a document issued now shows 29/09/2026", () => {
    expect(localeDate(new Date(), "pt-BR")).toBe("29/09/2026");
    expect(localeDate(new Date(), "es")).toBe("29/9/2026");
    expect(localeDate("2026-09-29", "pt-BR")).toBe("29/09/2026");
  });

  it("a procedure at 23:30 BRT is dated that day", () => {
    expect(localeDate("2026-09-30T02:30:00.000Z", "pt-BR")).toBe("29/09/2026");
  });
});

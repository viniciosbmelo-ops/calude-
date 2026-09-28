import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDateOnly, parseDateOnly, toDisplayDate } from "./utils";

// Node re-reads TZ when it is assigned, so this pins the offset the preview hit
// (UTC-3): `new Date("2026-09-28")` is 2026-09-27 21:00 local there.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Sao_Paulo"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("date-only helpers (America/Sao_Paulo)", () => {
  it("reproduces the UTC-midnight shift that the helper avoids", () => {
    expect(new Date("2026-09-28").getDate()).toBe(27);
    expect(new Date().getTimezoneOffset()).toBe(180);
  });

  it("parseDateOnly returns the local calendar date", () => {
    const d = parseDateOnly("2026-09-28")!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 28]);
    expect(d.getHours()).toBe(0);
  });

  it("parseDateOnly rejects timestamps, invalid calendar days and empty input", () => {
    expect(parseDateOnly("2026-09-28T10:00:00Z")).toBeNull();
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("28/09/2026")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
  });

  it("toDisplayDate keeps date-only strings on their day and leaves timestamps untouched", () => {
    expect(toDisplayDate("2026-09-28").getDate()).toBe(28);
    expect(toDisplayDate("2026-01-01").getFullYear()).toBe(2026);
    const ts = "2026-09-28T02:00:00.000Z";
    expect(toDisplayDate(ts).getTime()).toBe(new Date(ts).getTime());
    const now = new Date();
    expect(toDisplayDate(now)).toBe(now);
  });

  it("formatDateOnly renders dd/mm/yyyy in pt-BR and es", () => {
    expect(formatDateOnly("2026-09-28", "pt-BR")).toBe("28/09/2026");
    expect(formatDateOnly("2026-09-28", "es")).toBe("28/09/2026");
    expect(formatDateOnly("2026-01-01", "pt-BR")).toBe("01/01/2026");
  });

  it("formatDateOnly uses the fallback for empty or invalid values", () => {
    expect(formatDateOnly(null, "pt-BR", undefined, "—")).toBe("—");
    expect(formatDateOnly("", "pt-BR", undefined, "—")).toBe("—");
    expect(formatDateOnly("not-a-date", "pt-BR", undefined, "—")).toBe("—");
  });
});

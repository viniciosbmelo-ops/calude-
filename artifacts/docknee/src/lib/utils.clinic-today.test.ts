import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDate } from "./utils";
import { documentDate } from "@/locales/document-locales";

// Browser in Brazil at 23:30 on 29/09/2026 (= 02:30 UTC on 30/09): file names
// and document issue dates must use the local day, never the UTC one.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Sao_Paulo"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T02:30:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("DocKnee 'today' at 23:30 in Brasília", () => {
  it("is 2026-09-29 (the UTC day is already the 30th)", () => {
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(formatLocalDate()).toBe("2026-09-29");
  });

  it("a document issued now shows 29/09/2026", () => {
    expect(documentDate("pt-BR", new Date(), { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("29/09/2026");
  });
});

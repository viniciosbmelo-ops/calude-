import { describe, expect, it } from "vitest";
import { isCompletedSurgery, summarizeDashboardSurgeries } from "./reports";

describe("dashboard surgery totals", () => {
  it("does not count drafts as completed surgeries", () => {
    expect(isCompletedSurgery({ status: "rascunho" })).toBe(false);
    expect(isCompletedSurgery({ status: "completo" })).toBe(true);
    expect(isCompletedSurgery({ status: null })).toBe(true);
  });

  it("excludes drafts from the total and the case-type distribution", () => {
    const summary = summarizeDashboardSurgeries([
      { status: "completo", tiposProcedimento: ["SH_CUFF", "SH_BICEPS_SLAP"] },
      { status: "completo", tiposProcedimento: ["SH_CUFF"] },
      { status: "completo", tiposProcedimento: ["SH_CUFF", "SH_CUFF"] },
      { status: "rascunho", tiposProcedimento: ["SH_BICEPS_SLAP"] },
    ]);
    expect(summary.totalSurgeries).toBe(3);
    expect(Object.fromEntries(summary.surgeriesByType.map((row) => [row.tipo, row.count]))).toEqual({
      SH_CUFF: 3,
      SH_BICEPS_SLAP: 1,
    });
  });
});

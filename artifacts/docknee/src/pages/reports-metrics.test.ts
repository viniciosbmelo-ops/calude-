import { describe, expect, it } from "vitest";
import { excludeDraftRows, summarizeReportCaseTypes, summarizeReportRows } from "./reports";
import { reportingDashboardMessages } from "@/locales/reporting-dashboard";

const row = (
  surgeryId: number,
  tiposProcedimento: string[],
  extra: { id?: number | null; respondida?: boolean; surgeryStatus?: string } = {},
) => ({
  id: extra.id ?? null,
  surgeryId,
  respondida: extra.respondida ?? false,
  tiposProcedimento,
  surgeryStatus: extra.surgeryStatus ?? "completo",
});

describe("reports page metrics", () => {
  // 5 cirurgias realizadas + 1 rascunho, como nos dados de teste.
  const rows = [
    row(1, ["SH_CUFF", "SH_INSTABILITY"]),
    row(2, ["SH_CUFF"], { id: 10, respondida: true }),
    row(2, ["SH_CUFF"], { id: 11, respondida: false }),
    row(3, ["SH_CUFF", "SH_CUFF"]),
    row(4, ["SH_INSTABILITY", "SH_ARTHROPLASTY"]),
    row(5, ["SH_ARTHROPLASTY"]),
    row(6, ["SH_CUFF", "SH_ARTHROPLASTY"], { surgeryStatus: "rascunho" }),
  ];

  it("drops draft surgeries from the rows", () => {
    expect(excludeDraftRows(rows).map((r) => r.surgeryId)).not.toContain(6);
  });

  it("counts surgeries, recorded follow-ups and answered assessments separately", () => {
    expect(summarizeReportRows(rows)).toEqual({ surgeries: 5, recordedFollowups: 2, answeredAssessments: 1 });
  });

  it("uses completed surgeries as the case-type percentage base, one count per surgery", () => {
    const summary = summarizeReportCaseTypes(rows);
    expect(summary.surgeries).toBe(5);
    expect(Object.fromEntries(summary.byType.map((t) => [t.key, [t.count, t.percent]]))).toEqual({
      SH_CUFF: [3, 60],
      SH_INSTABILITY: [2, 40],
      SH_ARTHROPLASTY: [2, 40],
    });
  });

  it("keeps pt-BR and es report messages at parity", () => {
    expect(Object.keys(reportingDashboardMessages.es).sort()).toEqual(Object.keys(reportingDashboardMessages["pt-BR"]).sort());
  });
});

import { describe, expect, it } from "vitest";
import {
  reportCatalogLabel,
  reportCatalogOptions,
  reportFollowupPeriodLabel,
  reportScaleLabels,
} from "@/locales/reporting-catalogs";

describe("reporting catalog labels", () => {
  it("changes controlled Portuguese labels for Spanish", () => {
    expect(reportCatalogLabel("es", "Instabilidade residual")).toBe("Inestabilidad residual");
    expect(reportCatalogLabel("es", "Pré-operatório")).toBe("Preoperatorio");
    expect(reportCatalogLabel("es", "Direito")).toBe("Derecho");
  });

  it("keeps the canonical value used by controls and leaves free text intact", () => {
    expect(reportCatalogOptions("es", ["Recreacional"])).toEqual([
      { value: "Recreacional", label: "Recreativo" },
    ]);
    expect(reportCatalogLabel("es", "Hospital São Lucas")).toBe("Hospital São Lucas");
  });

  it("maps classic and regenerative follow-up periods and scales for presentation", () => {
    expect(reportFollowupPeriodLabel("es", "preop")).toBe("Preoperatorio");
    expect(reportFollowupPeriodLabel("es", "1 mês")).toBe("1 mes");
    expect(reportFollowupPeriodLabel("es", "Pré-op (Baseline)")).toBe("Preoperatorio (basal)");
    expect(reportScaleLabels("es", ["VAS Dor", "Escala livre"])).toEqual([
      "VAS Dolor", "Escala livre",
    ]);
  });

});
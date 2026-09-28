import { describe, expect, it } from "vitest";
import {
  reportCatalogLabel,
  reportCatalogOptions,
  reportFollowupPeriodLabel,
  reportLesionLabels,
  reportScaleLabels,
} from "@/locales/reporting-catalogs";

describe("reporting catalog labels", () => {
  it("changes controlled Portuguese labels for Spanish", () => {
    expect(reportCatalogLabel("es", "Tendão Patelar (BTB)")).toBe("Tendón patelar (BTB)");
    expect(reportCatalogLabel("es", "Pré-operatório")).toBe("Preoperatorio");
    expect(reportCatalogLabel("es", "Direito")).toBe("Derecho");
  });

  it("keeps the canonical value used by controls and leaves free text intact", () => {
    expect(reportCatalogOptions("es", ["Meniscectomia parcial"])).toEqual([
      { value: "Meniscectomia parcial", label: "Meniscectomía parcial" },
    ]);
    expect(reportCatalogLabel("es", "Hospital São Lucas")).toBe("Hospital São Lucas");
  });

  it("maps classic and regenerative follow-up periods and scales for presentation", () => {
    expect(reportFollowupPeriodLabel("es", "preop")).toBe("Preoperatorio");
    expect(reportFollowupPeriodLabel("es", "1 mês")).toBe("1 mes");
    expect(reportFollowupPeriodLabel("es", "Pré-op (Baseline)")).toBe("Preoperatorio (basal)");
    expect(reportScaleLabels("es", ["IKDC", "VAS Dor", "Escala livre"])).toEqual([
      "IKDC", "VAS Dolor", "Escala livre",
    ]);
  });

  it("maps controlled lesion arrays while retaining unknown and free-text values", () => {
    expect(reportLesionLabels("es", [
      "Menisco medial",
      "Lesão osteocondral",
      "Descrição livre",
    ])).toEqual([
      "Menisco medial",
      "Lesión osteocondral",
      "Descrição livre",
    ]);
  });
});
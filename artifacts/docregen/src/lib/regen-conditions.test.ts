import { describe, expect, it } from "vitest";
import {
  LEGACY_REGEN_CONDITIONS,
  REGEN_CONDITION_CATALOG,
  kellgrenLawrenceGrade,
  regenConditionLabel,
  regenConditionRegion,
} from "./regen-conditions";
import { conditionCodeLabel } from "./dashboard-metrics";
// The API owns validation and seeding; both catalogs must stay identical.
import * as api from "../../../docregen-api/src/lib/regen-conditions";

describe("DocRegen conditions catalog", () => {
  it("matches the API catalog exactly (codes, names, regions, grades)", () => {
    expect(REGEN_CONDITION_CATALOG).toEqual(api.REGEN_CONDITION_CATALOG);
    for (const [code, entry] of Object.entries(LEGACY_REGEN_CONDITIONS)) {
      expect(api.LEGACY_REGEN_CONDITIONS[code]).toEqual({ name: entry.name, es: entry.es });
    }
    expect(Object.keys(api.LEGACY_REGEN_CONDITIONS).sort()).toEqual(Object.keys(LEGACY_REGEN_CONDITIONS).sort());
  });

  it("has knee conditions in the Joelho group, with KL-graded osteoarthritis", () => {
    const knee = REGEN_CONDITION_CATALOG.filter((c) => c.region === "joelho").map((c) => c.code);
    expect(knee).toEqual([
      "OA_JOELHO_KL1", "OA_JOELHO_KL2", "OA_JOELHO_KL3", "OA_JOELHO_KL4",
      "LESAO_MENISCAL_DEGENERATIVA", "TENDINOPATIA_PATELAR", "CONDROPATIA_PATELAR",
    ]);
    expect([1, 2, 3, 4].map((g) => kellgrenLawrenceGrade(`OA_JOELHO_KL${g}`))).toEqual([1, 2, 3, 4]);
    expect(kellgrenLawrenceGrade("OA_QUADRIL")).toBeNull();
    expect(regenConditionLabel("OA_JOELHO_KL3")).toBe("Osteoartrite de Joelho — Kellgren-Lawrence III");
    expect(regenConditionLabel("OA_JOELHO_KL3", "es")).toBe("Osteoartritis de rodilla — Kellgren-Lawrence III");
    expect(regenConditionRegion("TENDINOPATIA_PATELAR")).toBe("joelho");
    expect(regenConditionRegion("knee_oa")).toBe("joelho");
  });

  it("keeps codes unique", () => {
    const codes = REGEN_CONDITION_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never shows raw codes", () => {
    expect(regenConditionLabel("CONDRAL_FOCAL")).toBe("Lesão Condral Focal");
    expect(regenConditionLabel("OA_QUADRIL")).toBe("Osteoartrite de Quadril");
    expect(conditionCodeLabel("OA_QUADRIL")).toBe("Osteoartrite de Quadril");
    expect(conditionCodeLabel("OA_QUADRIL", "es")).toBe("Osteoartritis de cadera");
    expect(regenConditionLabel("knee_oa")).toBe("Osteoartrose de Joelho");
    expect(regenConditionLabel("SOME_NEW_CODE")).toBe("Some new code");
    expect(regenConditionLabel("CUSTOM", "pt-BR", "Dor Anterior no Joelho")).toBe("Dor Anterior no Joelho");
    expect(regenConditionLabel("Texto Livre Digitado")).toBe("Texto Livre Digitado");
    expect(regenConditionLabel(null)).toBe("");
  });
});

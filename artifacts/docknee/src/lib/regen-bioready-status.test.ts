import { describe, expect, it } from "vitest";
import { computeBioReadyScore, getBioReadyClinicalStatus } from "./regen-bioready";

describe("getBioReadyClinicalStatus", () => {
  it("groups excellent and good grades as fit", () => {
    expect(getBioReadyClinicalStatus("excellent").status).toBe("fit");
    expect(getBioReadyClinicalStatus("good").status).toBe("fit");
  });

  it("maps optimize to reassess and defer to not fit", () => {
    expect(getBioReadyClinicalStatus("optimize").status).toBe("reassess");
    expect(getBioReadyClinicalStatus("defer").status).toBe("not_fit");
  });
});
describe("computeBioReadyScore lab detail", () => {
  const labsDetail = (labFlagCount: number) =>
    computeBioReadyScore({ labFlagCount } as Parameters<typeof computeBioReadyScore>[0])
      .factors.find((f) => f.id === "labs")?.detail;

  it("uses singular and plural instead of \"(s)\"", () => {
    expect(labsDetail(1)).toContain("1 analito alterado");
    expect(labsDetail(2)).toContain("2 analitos alterados");
    expect(labsDetail(2)).not.toMatch(/\(s\)/);
  });
});

import { describe, expect, it } from "vitest";
import { getBioReadyClinicalStatus } from "./regen-bioready";

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
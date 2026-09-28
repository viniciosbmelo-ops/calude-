import { describe, expect, it } from "vitest";
import { diaphysealMeasurementCacheSuffix } from "./xray.js";

describe("diaphysealMeasurementCacheSuffix", () => {
  it("distinguishes every marked diaphyseal measurement deterministically", () => {
    const original = diaphysealMeasurementCacheSuffix({
      eixoAnatomico: "6.5",
      amaFemoral: "9.1",
      divergenciaTibial: "3.2",
    });

    expect(original).toBe(":eixoAnatomico6.5:amaFemoral9.1:divergenciaTibial3.2");
    expect(diaphysealMeasurementCacheSuffix({
      eixoAnatomico: "6.50",
      amaFemoral: 9.1,
      divergenciaTibial: 3.2,
    })).toBe(original);
    expect(diaphysealMeasurementCacheSuffix({
      eixoAnatomico: "6.5",
      amaFemoral: "9.2",
      divergenciaTibial: "3.2",
    })).not.toBe(original);
    expect(diaphysealMeasurementCacheSuffix({
      eixoAnatomico: "6.6",
      amaFemoral: "9.1",
      divergenciaTibial: "3.2",
    })).not.toBe(original);
    expect(diaphysealMeasurementCacheSuffix({
      eixoAnatomico: "6.5",
      amaFemoral: "9.1",
      divergenciaTibial: "3.3",
    })).not.toBe(original);
    expect(diaphysealMeasurementCacheSuffix({
      eixoAnatomico: 0,
    })).toBe(":eixoAnatomico0");
  });
});
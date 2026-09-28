import { describe, expect, it } from "vitest";
import { classifyPTS } from "./pts-classification";

describe("PTS classification thresholds", () => {
  it.each([
    [10, "normal"],
    [11, "normal"],
    [11.1, "borderline"],
    [12, "borderline"],
    [15, "borderline"],
    [15.1, "pathological"],
  ] as const)("classifies %s° as %s", (value, expected) => {
    expect(classifyPTS(value)).toBe(expected);
  });

  it("uses the measured method-B value without a hidden correction", () => {
    expect(classifyPTS(10)).toBe("normal");
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "10", {}])(
    "does not classify invalid value %s as normal",
    (value) => {
      expect(classifyPTS(value)).toBeNull();
    },
  );
});
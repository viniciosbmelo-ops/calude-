import { describe, expect, it } from "vitest";
import { shouldShowRuleCodes } from "./logic";

describe("shouldShowRuleCodes", () => {
  it("hides internal rule codes from a non-admin outside review runs", () => {
    expect(shouldShowRuleCodes({ isAdmin: false, modo: "preop" })).toBe(false);
    expect(shouldShowRuleCodes({ isAdmin: false, modo: "registro" })).toBe(false);
    expect(shouldShowRuleCodes({ modo: "preop" })).toBe(false);
    expect(shouldShowRuleCodes({ isAdmin: null, modo: null })).toBe(false);
    expect(shouldShowRuleCodes({})).toBe(false);
  });

  it("shows them to admins in any mode", () => {
    expect(shouldShowRuleCodes({ isAdmin: true, modo: "preop" })).toBe(true);
    expect(shouldShowRuleCodes({ isAdmin: true, modo: "registro" })).toBe(true);
    expect(shouldShowRuleCodes({ isAdmin: true })).toBe(true);
  });

  it("shows them in review runs for anyone", () => {
    expect(shouldShowRuleCodes({ isAdmin: false, modo: "revisao" })).toBe(true);
    expect(shouldShowRuleCodes({ modo: "revisao" })).toBe(true);
  });
});

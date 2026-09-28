import { describe, expect, it } from "vitest";
import { canonicalNavigationFeature, sanitisePath } from "./analytics";

describe("navigation click server canonicalization", () => {
  it("derives the feature from the sanitized route, not client input", () => {
    const sanitized = sanitisePath("/surgeries/123?patient=456");
    expect(sanitized).toBe("/surgeries/:id");
    expect(canonicalNavigationFeature(sanitized)).toBe("surgery");
    expect(canonicalNavigationFeature(sanitisePath("/surgeries"))).toBe("surgeries");
  });

  it("rejects unknown or dynamic destinations before click ranking", () => {
    expect(canonicalNavigationFeature(sanitisePath("/future/private-record"))).toBeNull();
    expect(canonicalNavigationFeature("/other")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createTemporaryAccessExpiration, hasActiveTemporaryAccess } from "./temporaryAccess";

describe("temporary doctor access", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("creates an expiration exactly 30 days ahead", () => {
    expect(createTemporaryAccessExpiration(now).toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it("accepts a future expiration", () => {
    expect(hasActiveTemporaryAccess("2026-09-03T12:00:00.000Z", now)).toBe(true);
  });

  it("rejects an expired or invalid expiration", () => {
    expect(hasActiveTemporaryAccess("2026-09-01T12:00:00.000Z", now)).toBe(false);
    expect(hasActiveTemporaryAccess("invalid", now)).toBe(false);
    expect(hasActiveTemporaryAccess(null, now)).toBe(false);
  });
});
import { describe, expect, it } from "vitest";
import {
  classifyVisitPath,
  describeAccessGeography,
  normalizeClientIp,
  resolveAccessGeography,
} from "./accessGeography";

describe("access geography", () => {
  it("separates public site pages from platform pages", () => {
    expect(classifyVisitPath("/")).toBe("site");
    expect(classifyVisitPath("/register")).toBe("site");
    expect(classifyVisitPath("/dashboard")).toBe("platform");
    expect(classifyVisitPath(null)).toBe("platform");
  });

  it("normalizes IPv4-mapped addresses and rejects invalid values", () => {
    expect(normalizeClientIp("::ffff:200.137.0.1")).toBe("200.137.0.1");
    expect(normalizeClientIp("[2001:4860:4860::8888]")).toBe("2001:4860:4860::8888");
    expect(normalizeClientIp("not-an-ip")).toBeNull();
  });

  it("keeps only the Brazilian UF for Brazilian accesses", () => {
    expect(resolveAccessGeography("200.137.0.1", () => ({ country: "BR", region: "RN" })))
      .toEqual({ countryCode: "BR", regionCode: "RN" });

    expect(resolveAccessGeography("200.137.0.1", () => ({ country: "BR", region: "invalid" })))
      .toEqual({ countryCode: "BR", regionCode: null });
  });

  it("keeps only the country for foreign accesses", () => {
    expect(resolveAccessGeography("8.8.8.8", () => ({ country: "US", region: "CA" })))
      .toEqual({ countryCode: "US", regionCode: null });
  });

  it("falls back safely when lookup is unavailable", () => {
    expect(resolveAccessGeography("127.0.0.1", () => null))
      .toEqual({ countryCode: null, regionCode: null });
    expect(resolveAccessGeography("8.8.8.8", () => { throw new Error("lookup failed"); }))
      .toEqual({ countryCode: null, regionCode: null });
  });

  it("formats Brazilian states, foreign countries and unknown locations", () => {
    expect(describeAccessGeography("BR", "ES"))
      .toEqual({ kind: "state", code: "ES", label: "Espírito Santo (ES)" });
    expect(describeAccessGeography("US", null))
      .toEqual({ kind: "country", code: "US", label: "Estados Unidos" });
    expect(describeAccessGeography(null, null))
      .toEqual({ kind: "unknown", code: null, label: "Localização desconhecida" });
  });
});
import { describe, expect, it } from "vitest";
import {
  appBasePath,
  appBrandName,
  appServesPath,
  buildAppLink,
  buildRequestAppLink,
  resolveClientApp,
} from "./app-links";

const ORIGIN = "https://app.example.test";

function headers(value?: string | string[]) {
  return { headers: value === undefined ? {} : { "x-app": value } };
}

describe("resolveClientApp", () => {
  it("defaults to docknee when the header is absent", () => {
    expect(resolveClientApp(headers())).toBe("docknee");
    expect(resolveClientApp(undefined)).toBe("docknee");
    expect(resolveClientApp(null)).toBe("docknee");
  });

  it("accepts docregen case-insensitively", () => {
    expect(resolveClientApp(headers("docregen"))).toBe("docregen");
    expect(resolveClientApp(headers("  DocRegen "))).toBe("docregen");
    expect(resolveClientApp(headers(["docregen", "docknee"]))).toBe("docregen");
  });

  it("maps anything outside the allowlist to the default app", () => {
    for (const value of [
      "",
      "docregen2",
      "/docregen",
      "https://evil.example",
      "//evil.example",
      "docregen/../evil",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      expect(resolveClientApp(headers(value))).toBe("docknee");
    }
  });
});

describe("buildAppLink", () => {
  it("keeps the historical root link for the default app", () => {
    expect(buildAppLink(ORIGIN, "/pre-consulta/abc")).toBe(`${ORIGIN}/pre-consulta/abc`);
    expect(buildAppLink(ORIGIN, "/patient/regen/abc", "docknee")).toBe(`${ORIGIN}/patient/regen/abc`);
    expect(buildAppLink(ORIGIN, "/patient/abc", "docknee")).toBe(`${ORIGIN}/patient/abc`);
    expect(buildAppLink(ORIGIN, "/redefinir-senha?token=t", "docknee")).toBe(`${ORIGIN}/redefinir-senha?token=t`);
  });

  it("prefixes /docregen for pages DocRegen serves", () => {
    expect(buildAppLink(ORIGIN, "/pre-consulta/abc", "docregen")).toBe(`${ORIGIN}/docregen/pre-consulta/abc`);
    expect(buildAppLink(ORIGIN, "/patient/regen/abc", "docregen")).toBe(`${ORIGIN}/docregen/patient/regen/abc`);
    expect(buildAppLink(ORIGIN, "/orientacoes-paciente?token=x", "docregen"))
      .toBe(`${ORIGIN}/docregen/orientacoes-paciente?token=x`);
    expect(buildAppLink(ORIGIN, "/redefinir-senha?token=t", "docregen")).toBe(`${ORIGIN}/docregen/redefinir-senha?token=t`);
    expect(buildAppLink(ORIGIN, "/sucesso?session_id={CHECKOUT_SESSION_ID}", "docregen"))
      .toBe(`${ORIGIN}/docregen/sucesso?session_id={CHECKOUT_SESSION_ID}`);
    expect(buildAppLink(ORIGIN, "/assinatura-cancelada", "docregen")).toBe(`${ORIGIN}/docregen/assinatura-cancelada`);
  });

  it("falls back to the root app for pages DocRegen does not have", () => {
    // Surgical follow-up questionnaire and physio invites only exist in DocKnee.
    expect(buildAppLink(ORIGIN, "/patient/abc", "docregen")).toBe(`${ORIGIN}/patient/abc`);
    expect(buildAppLink(ORIGIN, "/fisio/convite/abc", "docregen")).toBe(`${ORIGIN}/fisio/convite/abc`);
    expect(buildAppLink(ORIGIN, "/pre-consultation/abc", "docregen")).toBe(`${ORIGIN}/pre-consultation/abc`);
  });

  it("rejects paths that could escape the trusted origin", () => {
    expect(() => buildAppLink(ORIGIN, "https://evil.example/x", "docregen")).toThrow();
    expect(() => buildAppLink(ORIGIN, "//evil.example/x", "docregen")).toThrow();
    expect(() => buildAppLink(ORIGIN, "pre-consulta/abc", "docknee")).toThrow();
  });

  it("resolves the app from the request header", () => {
    expect(buildRequestAppLink(headers("docregen"), ORIGIN, "/pre-consulta/t")).toBe(`${ORIGIN}/docregen/pre-consulta/t`);
    expect(buildRequestAppLink(headers(), ORIGIN, "/pre-consulta/t")).toBe(`${ORIGIN}/pre-consulta/t`);
    expect(buildRequestAppLink(headers("https://evil.example"), ORIGIN, "/pre-consulta/t")).toBe(`${ORIGIN}/pre-consulta/t`);
  });
});

describe("app metadata", () => {
  it("exposes fixed base paths and brand names", () => {
    expect(appBasePath("docknee")).toBe("");
    expect(appBasePath("docregen")).toBe("/docregen");
    expect(appBrandName("docknee")).toBe("DocSholder");
    expect(appBrandName("docregen")).toBe("DocRegen");
  });

  it("matches DocRegen routes by pathname only", () => {
    expect(appServesPath("docregen", "/orientacoes-paciente?token=x")).toBe(true);
    expect(appServesPath("docregen", "/orientacoes-paciente-extra")).toBe(false);
    expect(appServesPath("docregen", "/secretary/login")).toBe(true);
    expect(appServesPath("docknee", "/pre-consulta/abc")).toBe(false);
  });
});

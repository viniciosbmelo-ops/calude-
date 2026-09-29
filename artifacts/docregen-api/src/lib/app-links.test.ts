import { describe, expect, it } from "vitest";
import {
  APP_BRAND_NAME,
  DEFAULT_FRONTEND_BASE_PATH,
  buildAppLink,
  frontendBasePath,
} from "./app-links";

const ORIGIN = "https://app.example.test";
const DEFAULT_ENV: NodeJS.ProcessEnv = {};

describe("frontendBasePath", () => {
  it("defaults to /docregen", () => {
    expect(DEFAULT_FRONTEND_BASE_PATH).toBe("/docregen");
    expect(frontendBasePath(DEFAULT_ENV)).toBe("/docregen");
  });

  it("accepts an explicit plain path or an empty value (own domain root)", () => {
    expect(frontendBasePath({ DOCREGEN_FRONTEND_BASE_PATH: "/regen/" })).toBe("/regen");
    expect(frontendBasePath({ DOCREGEN_FRONTEND_BASE_PATH: "" })).toBe("");
  });

  it("rejects anything that is not a plain path", () => {
    for (const value of ["https://evil.example", "//evil.example", "docregen", "/../x", "/a b"]) {
      expect(() => frontendBasePath({ DOCREGEN_FRONTEND_BASE_PATH: value })).toThrow();
    }
  });
});

describe("buildAppLink", () => {
  it("always points to the DocRegen frontend (no calling-app flag)", () => {
    expect(buildAppLink(ORIGIN, "/pre-consulta/abc", DEFAULT_ENV)).toBe(`${ORIGIN}/docregen/pre-consulta/abc`);
    expect(buildAppLink(ORIGIN, "/patient/regen/abc", DEFAULT_ENV)).toBe(`${ORIGIN}/docregen/patient/regen/abc`);
    expect(buildAppLink(ORIGIN, "/orientacoes-paciente?token=x", DEFAULT_ENV))
      .toBe(`${ORIGIN}/docregen/orientacoes-paciente?token=x`);
    expect(buildAppLink(ORIGIN, "/redefinir-senha?token=t", DEFAULT_ENV)).toBe(`${ORIGIN}/docregen/redefinir-senha?token=t`);
    expect(buildAppLink(ORIGIN, "/sucesso?session_id={CHECKOUT_SESSION_ID}", DEFAULT_ENV))
      .toBe(`${ORIGIN}/docregen/sucesso?session_id={CHECKOUT_SESSION_ID}`);
    expect(buildAppLink(ORIGIN, "/assinatura-cancelada", DEFAULT_ENV)).toBe(`${ORIGIN}/docregen/assinatura-cancelada`);
  });

  it("uses the configured base path when DocRegen moves to its own domain", () => {
    expect(buildAppLink(ORIGIN, "/pre-consulta/abc", { DOCREGEN_FRONTEND_BASE_PATH: "" }))
      .toBe(`${ORIGIN}/pre-consulta/abc`);
  });

  it("rejects paths that could escape the trusted origin", () => {
    expect(() => buildAppLink(ORIGIN, "https://evil.example/x", DEFAULT_ENV)).toThrow();
    expect(() => buildAppLink(ORIGIN, "//evil.example/x", DEFAULT_ENV)).toThrow();
    expect(() => buildAppLink(ORIGIN, "pre-consulta/abc", DEFAULT_ENV)).toThrow();
  });
});

describe("branding", () => {
  it("is always DocRegen", () => {
    expect(APP_BRAND_NAME).toBe("DocRegen");
  });
});

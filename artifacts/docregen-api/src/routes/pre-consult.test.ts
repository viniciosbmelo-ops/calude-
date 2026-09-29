import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPatientSessionToken,
  verifyPatientSessionToken,
} from "../lib/patient-session";
import {
  PRE_CONSULT_QUESTIONS,
  PreConsultAnswersSchema,
} from "./pre-consult";
import { isValidCpf, normalizeCpf } from "@workspace/docregen-api-zod";

describe("CPF validation", () => {
  it("accepts valid formatted CPFs and rejects repeated or invalid check digits", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("000.000.000-00")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });
});

describe("pre-consult questionnaire validation", () => {
  it("builds a complete empty draft from defaults", () => {
    const result = PreConsultAnswersSchema.parse({});

    expect(result.intensidadeDor).toBeNull();
    expect(result.pioraSintomas).toEqual([]);
    expect(result.tratamentosPrevios).toEqual([]);
    expect(result.ortobiologicos).toEqual([]);
    expect(result.examesPossui).toEqual([]);
    expect(result.objetivoTratamento).toBe("");
    expect(Object.keys(result)).toHaveLength(30);
  });

  it("defines exactly 25 questions while covering all structured storage keys", () => {
    const parsed = PreConsultAnswersSchema.parse({});
    const answerKeys = PRE_CONSULT_QUESTIONS.flatMap((question) => question.answerKeys);

    expect(PRE_CONSULT_QUESTIONS.map((question) => question.number)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    expect(new Set(answerKeys).size).toBe(answerKeys.length);
    expect([...answerKeys].sort()).toEqual(Object.keys(parsed).sort());
    expect(Object.keys(parsed)).toHaveLength(30);
  });

  it("accepts only the stable codes used by the public form", () => {
    const result = PreConsultAnswersSchema.parse({
      inicioSintomasTipo: "atividade_fisica",
      intensidadeDor: 8,
      pioraSintomas: ["caminhar", "escadas", "noite", "outro"],
      tratamentosPrevios: [
        "fisioterapia",
        "acido_hialuronico",
        "prp",
        "bma",
        "gordura_microfragmentada",
      ],
      ortobiologicos: ["prp", "bma", "gordura_microfragmentada"],
      examesPossui: ["radiografia", "ressonancia", "laboratoriais"],
      objetivoTratamento: "retornar_esporte",
    });

    expect(result.intensidadeDor).toBe(8);
    expect(result.tratamentosPrevios).toContain("gordura_microfragmentada");
  });

  it("rejects translated labels, invalid pain scores and extra fields", () => {
    expect(() => PreConsultAnswersSchema.parse({
      pioraSintomas: ["Caminhar"],
    })).toThrow();
    expect(() => PreConsultAnswersSchema.parse({
      intensidadeDor: 11,
    })).toThrow();
    expect(() => PreConsultAnswersSchema.parse({
      campoNaoVersionado: "não permitido",
    })).toThrow();
  });
});

describe("pre-consult patient session", () => {
  beforeEach(() => {
    process.env["DOCREGEN_SESSION_SECRET"] = "pre-consult-test-secret-with-32-characters";
  });

  it("issues and verifies a token-bound pre-consult session", () => {
    const cookie = buildPatientSessionToken("preconsult", "opaque-link-token");
    expect(verifyPatientSessionToken(cookie)).toEqual({
      tokenType: "preconsult",
      linkToken: "opaque-link-token",
    });
  });

  it("rejects a tampered pre-consult session", () => {
    const cookie = buildPatientSessionToken("preconsult", "opaque-link-token");
    const [payload, mac] = cookie.split(".");
    expect(
      verifyPatientSessionToken(`${payload}.${mac!.slice(0, -3)}abc`),
    ).toBeNull();
  });
});
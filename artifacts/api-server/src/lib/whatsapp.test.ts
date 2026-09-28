import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFollowupMessage, sanitizeWhatsAppError, sendWhatsAppText } from "./whatsapp";

const params = {
  patientName: "María da Silva",
  periodo: "3 meses",
  scales: ["IKDC", "KOOS"],
  link: "https://example.com/patient/token",
  doctorName: "García",
};

describe("buildFollowupMessage", () => {
  it("keeps the Portuguese message as the default", () => {
    const text = buildFollowupMessage(params);

    expect(text).toContain("Olá, *María da Silva*!");
    expect(text).toContain("de *3 meses* após a sua cirurgia do joelho");
    expect(text).toContain("IKDC, KOOS");
    expect(text).toContain(params.link);
    expect(text).toContain("Dr(a). García");
  });

  it("localizes Spanish editorial text and known controlled labels", () => {
    const text = buildFollowupMessage({
      ...params,
      periodo: "1 mês",
      scales: ["VAS Dor", "IKDC", "Escala personalizada"],
      locale: "es",
    });

    expect(text).toContain("¡Hola, *María da Silva*!");
    expect(text).toContain("de *1 mes* después de su cirugía de rodilla");
    expect(text).toContain("EVA Dolor, IKDC, Escala personalizada");
    expect(text).toContain(params.link);
    expect(text).toContain("Dr(a). García");
    expect(text).not.toContain("Acesse pelo link");
  });

  it("preserves unknown period and scale free text in Spanish", () => {
    const text = buildFollowupMessage({
      ...params,
      periodo: "retorno personalizado",
      scales: ["Escala livre"],
      locale: "es",
    });

    expect(text).toContain("de *retorno personalizado* después de su cirugía de rodilla");
    expect(text).toContain("Escala livre");
  });

  it("uses Portuguese when no locale is supplied", () => {
    expect(buildFollowupMessage(params)).toBe(
      buildFollowupMessage({ ...params, locale: "pt-BR" }),
    );
  });
});

describe("sendWhatsAppText provider failures", () => {
  const originalEnvironment = {
    evolutionUrl: process.env["EVOLUTION_API_URL"],
    evolutionKey: process.env["EVOLUTION_API_KEY"],
    metaPhone: process.env["WHATSAPP_PHONE_NUMBER_ID"],
    metaToken: process.env["WHATSAPP_ACCESS_TOKEN"],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries({
      EVOLUTION_API_URL: originalEnvironment.evolutionUrl,
      EVOLUTION_API_KEY: originalEnvironment.evolutionKey,
      WHATSAPP_PHONE_NUMBER_ID: originalEnvironment.metaPhone,
      WHATSAPP_ACCESS_TOKEN: originalEnvironment.metaToken,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns a controlled error when the provider network call throws", async () => {
    process.env["EVOLUTION_API_URL"] = "https://evolution.invalid";
    process.env["EVOLUTION_API_KEY"] = "test-key";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "meta-phone";
    process.env["WHATSAPP_ACCESS_TOKEN"] = "meta-token";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsAppText("11999991234", "Teste")).resolves.toMatchObject({
      ok: false,
      provider: "evolution",
      error: expect.stringContaining("indisponível"),
      deliveryUncertain: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a controlled error for an invalid provider response", async () => {
    process.env["EVOLUTION_API_URL"] = "https://evolution.invalid";
    process.env["EVOLUTION_API_KEY"] = "test-key";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "meta-phone";
    process.env["WHATSAPP_ACCESS_TOKEN"] = "meta-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("invalid json")),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsAppText("11999991234", "Teste")).resolves.toMatchObject({
      ok: false,
      provider: "evolution",
      error: expect.stringContaining("resposta inválida"),
      deliveryUncertain: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves an ambiguous Meta result after an explicit Evolution rejection", async () => {
    process.env["EVOLUTION_API_URL"] = "https://evolution.invalid";
    process.env["EVOLUTION_API_KEY"] = "test-key";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "meta-phone";
    process.env["WHATSAPP_ACCESS_TOKEN"] = "meta-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ message: "Evolution rejected" }),
      })
      .mockRejectedValueOnce(new TypeError("Meta response lost"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsAppText("11999991234", "Teste")).resolves.toMatchObject({
      ok: false,
      provider: "meta",
      deliveryUncertain: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back after an ambiguous Evolution server failure", async () => {
    process.env["EVOLUTION_API_URL"] = "https://evolution.invalid";
    process.env["EVOLUTION_API_KEY"] = "test-key";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "meta-phone";
    process.env["WHATSAPP_ACCESS_TOKEN"] = "meta-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ message: "provider failure" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWhatsAppText("11999991234", "Teste")).resolves.toMatchObject({
      ok: false,
      provider: "evolution",
      deliveryUncertain: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the persisted idempotency key to the provider", async () => {
    process.env["EVOLUTION_API_URL"] = "https://evolution.invalid";
    process.env["EVOLUTION_API_KEY"] = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ key: { id: "provider-id" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppText("11999991234", "Teste", {
      idempotencyKey: "rehab-red-flag:42",
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "Idempotency-Key": "rehab-red-flag:42" }),
    });
  });
});

describe("sanitizeWhatsAppError", () => {
  it("redacts provider URLs, credentials, phones and line breaks", () => {
    const sanitized = sanitizeWhatsAppError(
      "Bearer secret-token\napi_key=topsecret https://provider.test/private +55 11 99999-1234",
    );
    expect(sanitized).not.toContain("secret-token");
    expect(sanitized).not.toContain("topsecret");
    expect(sanitized).not.toContain("provider.test");
    expect(sanitized).not.toContain("99999");
    expect(sanitized).not.toContain("\n");
  });
});
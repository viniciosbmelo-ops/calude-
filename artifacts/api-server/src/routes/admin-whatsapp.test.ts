import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  evolutionWebhookIsAuthorized,
  parseEvolutionWebhookMessage,
  evolutionWebhookInstanceIsAuthorized,
} from "./admin-whatsapp";
import { normalizeWhatsAppPhone } from "../lib/whatsapp";

describe("WhatsApp CRM webhook helpers", () => {
  const previousWebhookSecret = process.env["EVOLUTION_WEBHOOK_SECRET"];
  const previousApiKey = process.env["EVOLUTION_API_KEY"];

  afterEach(() => {
    if (previousWebhookSecret === undefined) delete process.env["EVOLUTION_WEBHOOK_SECRET"];
    else process.env["EVOLUTION_WEBHOOK_SECRET"] = previousWebhookSecret;
    if (previousApiKey === undefined) delete process.env["EVOLUTION_API_KEY"];
    else process.env["EVOLUTION_API_KEY"] = previousApiKey;
  });

  it("normalizes Brazilian local and formatted phones", () => {
    expect(normalizeWhatsAppPhone("(11) 99999-1234")).toBe("5511999991234");
    expect(normalizeWhatsAppPhone("+55 11 99999-1234")).toBe("5511999991234");
  });

  it("extracts inbound Evolution text messages", () => {
    expect(parseEvolutionWebhookMessage({
      event: "messages.upsert",
      data: {
        key: {
          id: "message-123",
          remoteJid: "5511999991234@s.whatsapp.net",
          fromMe: false,
        },
        pushName: "Paciente Teste",
        message: {
          extendedTextMessage: { text: "Preciso remarcar minha consulta" },
        },
      },
    })).toEqual({
      phone: "5511999991234",
      pushName: "Paciente Teste",
      providerMessageId: "message-123",
      content: {
        text: "Preciso remarcar minha consulta",
        type: "text",
      },
    });
  });

  it("uses a deterministic canonical fingerprint when Evolution omits an id", () => {
    const payload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "5511999991234@s.whatsapp.net",
          fromMe: false,
          participant: "5511999991234@s.whatsapp.net",
        },
        messageTimestamp: 1710000000,
        message: { conversation: "Mensagem sem id" },
      },
    };
    const first = parseEvolutionWebhookMessage(payload);
    const second = parseEvolutionWebhookMessage(structuredClone(payload));
    expect(first?.providerMessageId).toMatch(/^evolution-message:[a-f0-9]{64}$/);
    expect(second?.providerMessageId).toBe(first?.providerMessageId);
  });

  it("accepts legacy webhooks without instance and rejects another configured instance", () => {
    const previousInstance = process.env["EVOLUTION_INSTANCE"];
    process.env["EVOLUTION_INSTANCE"] = "test-instance";
    try {
      expect(evolutionWebhookInstanceIsAuthorized({
        event: "messages.upsert",
        data: { key: { id: "legacy" } },
      })).toBe(true);
      expect(evolutionWebhookInstanceIsAuthorized({
        instance: "test-instance",
        event: "messages.upsert",
        data: { key: { id: "bound" } },
      })).toBe(true);
      expect(evolutionWebhookInstanceIsAuthorized({
        instance: "other-instance",
        event: "messages.upsert",
        data: { key: { id: "wrong" } },
      })).toBe(false);
    } finally {
      if (previousInstance === undefined) delete process.env["EVOLUTION_INSTANCE"];
      else process.env["EVOLUTION_INSTANCE"] = previousInstance;
    }
  });

  it("ignores group and outbound events", () => {
    const base = {
      event: "messages.upsert",
      data: {
        key: { id: "message-1", remoteJid: "5511999991234@s.whatsapp.net", fromMe: false },
        message: { conversation: "Olá" },
      },
    };
    expect(parseEvolutionWebhookMessage({
      ...base,
      data: { ...base.data, key: { ...base.data.key, remoteJid: "1203630@g.us" } },
    })).toBeNull();
    expect(parseEvolutionWebhookMessage({
      ...base,
      data: { ...base.data, key: { ...base.data.key, fromMe: true } },
    })).toBeNull();
  });

  it("ignores authenticated payloads from other Evolution events", () => {
    expect(parseEvolutionWebhookMessage({
      event: "contacts.update",
      data: {
        key: { id: "message-1", remoteJid: "5511999991234@s.whatsapp.net", fromMe: false },
        message: { conversation: "Não deve entrar no CRM" },
      },
    })).toBeNull();
  });

  it("requires a matching webhook credential", () => {
    process.env["EVOLUTION_WEBHOOK_SECRET"] = "webhook-secret";
    delete process.env["EVOLUTION_API_KEY"];
    const request = (headers: Record<string, string>) => ({
      get: (name: string) => headers[name.toLowerCase()],
    }) as Request;

    expect(evolutionWebhookIsAuthorized(request({ "x-webhook-secret": "webhook-secret" }))).toBe(true);
    expect(evolutionWebhookIsAuthorized(request({ "x-webhook-secret": "wrong" }))).toBe(false);
    expect(evolutionWebhookIsAuthorized(request({}))).toBe(false);
  });
});
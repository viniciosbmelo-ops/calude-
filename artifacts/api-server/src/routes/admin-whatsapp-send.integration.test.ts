import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  whatsappContactsTable,
  whatsappConversationsTable,
  whatsappMessagesTable,
} from "@workspace/db";

const sendWhatsAppTextMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/whatsapp", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/whatsapp")>();
  return { ...original, sendWhatsAppText: sendWhatsAppTextMock };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import whatsappRouter from "./admin-whatsapp";

describe("WhatsApp CRM outbound route", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;
  let contactId: number;
  let conversationId: number;
  let contactPhone: string;

  beforeEach(async () => {
    sendWhatsAppTextMock.mockReset();
    const suffix = `${process.pid}${Date.now()}`.slice(-12);
    contactPhone = `5511${suffix}`;
    const [contact] = await db.insert(whatsappContactsTable).values({
      phoneE164: contactPhone,
      displayName: "Teste de falha do provedor",
    }).returning();
    contactId = contact.id;
    const [conversation] = await db.insert(whatsappConversationsTable).values({
      contactId,
      status: "new",
    }).returning();
    conversationId = conversation.id;

    app = express();
    app.use(express.json());
    app.use("/api", whatsappRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    await db.delete(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.conversationId, conversationId));
    await db.delete(whatsappConversationsTable)
      .where(eq(whatsappConversationsTable.id, conversationId));
    await db.delete(whatsappContactsTable)
      .where(eq(whatsappContactsTable.id, contactId));
  });

  it("keeps a thrown provider call pending and never retries the ambiguous send", async () => {
    const requestId = `outbound-${process.pid}-${Date.now()}`;
    const body = JSON.stringify({ text: "Mensagem clínica de teste", requestId });
    sendWhatsAppTextMock.mockRejectedValueOnce(new TypeError("network down"));

    const failedResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(failedResponse.status).toBe(202);

    const [pendingMessage] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    expect(pendingMessage.status).toBe("pending");

    sendWhatsAppTextMock.mockResolvedValueOnce({
      ok: true,
      messageId: "provider-message-test",
      provider: "evolution",
    });
    const retryResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(retryResponse.status).toBe(200);

    const [sameMessage] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    expect(sameMessage.status).toBe("pending");
    expect(sameMessage.providerMessageId).toBeNull();
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a provider-reported uncertain delivery pending and blocks retry", async () => {
    const requestId = `outbound-uncertain-${process.pid}-${Date.now()}`;
    const body = JSON.stringify({ text: "Mensagem com entrega incerta", requestId });
    sendWhatsAppTextMock.mockResolvedValueOnce({
      ok: false,
      error: "Meta indisponível no momento.",
      provider: "meta",
      deliveryUncertain: true,
    });

    const pendingResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(pendingResponse.status).toBe(202);
    const [pendingMessage] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    expect(pendingMessage.status).toBe("pending");

    const retryResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(retryResponse.status).toBe(200);
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
  });

  it("keeps provider success without a message ID pending and blocks retry", async () => {
    const requestId = `outbound-no-id-${process.pid}-${Date.now()}`;
    const body = JSON.stringify({ text: "Aceite sem identificador", requestId });
    sendWhatsAppTextMock.mockResolvedValueOnce({
      ok: true,
      provider: "evolution",
    });

    const pendingResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(pendingResponse.status).toBe(202);
    const [pendingMessage] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    expect(pendingMessage.status).toBe("pending");

    const retryResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(retryResponse.status).toBe(200);
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
  });

  it("retries only after an explicit provider rejection", async () => {
    const requestId = `outbound-rejected-${process.pid}-${Date.now()}`;
    const body = JSON.stringify({ text: "Mensagem rejeitada de teste", requestId });
    sendWhatsAppTextMock.mockResolvedValueOnce({
      ok: false,
      error: "Evolution HTTP 400",
      provider: "evolution",
    });

    const failedResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(failedResponse.status).toBe(502);
    const [failedMessage] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    expect(failedMessage.status).toBe("failed");

    sendWhatsAppTextMock.mockResolvedValueOnce({
      ok: true,
      messageId: "provider-message-after-retry",
      provider: "evolution",
    });
    const retryResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/messages`,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    );
    expect(retryResponse.status).toBe(200);
    const [sentMessage] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    expect(sentMessage.status).toBe("sent");
    expect(sentMessage.providerMessageId).toBe("provider-message-after-retry");
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(2);
  });

  it("requires the detail cursor and preserves inbound messages after that cursor", async () => {
    const [firstInbound] = await db.insert(whatsappMessagesTable).values({
      conversationId,
      providerMessageId: `inbound-first-${process.pid}-${Date.now()}`,
      direction: "inbound",
      status: "received",
      messageType: "text",
      content: "Primeira mensagem",
    }).returning();
    await db.update(whatsappConversationsTable)
      .set({ unreadCount: 1 })
      .where(eq(whatsappConversationsTable.id, conversationId));

    const detailResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as { readThroughMessageId: number };
    expect(detail.readThroughMessageId).toBe(firstInbound.id);

    const [secondInbound] = await db.insert(whatsappMessagesTable).values({
      conversationId,
      providerMessageId: `inbound-second-${process.pid}-${Date.now()}`,
      direction: "inbound",
      status: "received",
      messageType: "text",
      content: "Mensagem que chegou depois da leitura",
    }).returning();
    expect(secondInbound.id).toBeGreaterThan(firstInbound.id);
    await db.update(whatsappConversationsTable)
      .set({ unreadCount: 2 })
      .where(eq(whatsappConversationsTable.id, conversationId));

    const missingCursorResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/read`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(missingCursorResponse.status).toBe(400);

    const readResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readThroughMessageId: detail.readThroughMessageId }),
      },
    );
    expect(readResponse.status).toBe(200);

    const [conversation] = await db.select()
      .from(whatsappConversationsTable)
      .where(eq(whatsappConversationsTable.id, conversationId));
    expect(conversation.unreadCount).toBe(1);

    // A newer reader may clear the second message first. A stale reader with
    // the older cursor must not increase the aggregate back to one.
    const newestReadResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readThroughMessageId: secondInbound.id }),
      },
    );
    expect(newestReadResponse.status).toBe(200);
    const staleReadResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}/read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readThroughMessageId: firstInbound.id }),
      },
    );
    expect(staleReadResponse.status).toBe(200);
    const [afterReversedReaders] = await db.select()
      .from(whatsappConversationsTable)
      .where(eq(whatsappConversationsTable.id, conversationId));
    expect(afterReversedReaders.unreadCount).toBe(0);
  });

  it("scopes counts to the same search, status, and unread filters as the list", async () => {
    const phone = `5512${String(process.pid).slice(-4)}${String(Date.now()).slice(-6)}`;
    const [otherContact] = await db.insert(whatsappContactsTable).values({
      phoneE164: phone,
      displayName: "Contato filtrado",
    }).returning();
    const [otherConversation] = await db.insert(whatsappConversationsTable).values({
      contactId: otherContact.id,
      status: "waiting",
      unreadCount: 1,
      lastMessagePreview: "Mensagem filtrada",
    }).returning();
    try {
      const response = await fetch(
        `${baseUrl}/api/admin/whatsapp/conversations?search=Contato%20filtrado&status=waiting&unreadOnly=true`,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as {
        conversations: Array<{ id: number }>;
        counts: { all: number; waiting: number; unread: number; new: number; in_progress: number; closed: number };
      };
      expect(body.conversations.map((item) => item.id)).toEqual([otherConversation.id]);
      expect(body.counts).toMatchObject({
        all: 1,
        waiting: 1,
        unread: 1,
        new: 0,
        in_progress: 0,
        closed: 0,
      });
    } finally {
      await db.delete(whatsappConversationsTable)
        .where(eq(whatsappConversationsTable.id, otherConversation.id));
      await db.delete(whatsappContactsTable)
        .where(eq(whatsappContactsTable.id, otherContact.id));
    }
  });

  it("preserves an explicit no-patient manual link across inbound matching", async () => {
    const patchResponse = await fetch(
      `${baseUrl}/api/admin/whatsapp/conversations/${conversationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId: null }),
      },
    );
    expect(patchResponse.status).toBe(200);

    const previousSecret = process.env["EVOLUTION_WEBHOOK_SECRET"];
    process.env["EVOLUTION_WEBHOOK_SECRET"] = "test-webhook-secret";
    try {
      const webhookResponse = await fetch(`${baseUrl}/api/webhooks/evolution`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          event: "messages.upsert",
          data: {
            key: {
              id: `manual-link-${process.pid}-${Date.now()}`,
              remoteJid: `${contactPhone}@s.whatsapp.net`,
              fromMe: false,
            },
            message: { conversation: "Não associar automaticamente" },
          },
        }),
      });
      expect(webhookResponse.status).toBe(201);
    } finally {
      if (previousSecret === undefined) delete process.env["EVOLUTION_WEBHOOK_SECRET"];
      else process.env["EVOLUTION_WEBHOOK_SECRET"] = previousSecret;
    }

    const [conversation] = await db.select({
      patientId: whatsappConversationsTable.patientId,
      patientLinkSource: whatsappConversationsTable.patientLinkSource,
    }).from(whatsappConversationsTable)
      .where(eq(whatsappConversationsTable.id, conversationId));
    expect(conversation).toEqual({ patientId: null, patientLinkSource: "manual" });
  });

});
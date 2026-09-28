import { describe, expect, it } from "vitest";
import {
  canApplyWhatsappSendCompletion,
  getRecoverableWhatsappSends,
  getWhatsappMessageStatusPresentation,
  shouldClearWhatsappDraft,
  type Conversation,
  type Message,
} from "../pages/admin/types";
import {
  getWhatsappPollingInterval,
  mergeWhatsappConversationPreview,
  type WhatsappConversationsResponse,
} from "../pages/admin/queries";

describe("WhatsApp CRM send state", () => {
  it("keeps a newer draft when an earlier request completes late", () => {
    expect(shouldClearWhatsappDraft("mensagem nova", "mensagem enviada")).toBe(false);
    expect(canApplyWhatsappSendCompletion("request-new", "request-old")).toBe(false);
    expect(canApplyWhatsappSendCompletion("request-old", "request-old")).toBe(true);
  });

  it("keeps the submitted draft clear decision deterministic", () => {
    expect(shouldClearWhatsappDraft("mesma mensagem", "mesma mensagem")).toBe(true);
    expect(shouldClearWhatsappDraft(undefined, "mesma mensagem")).toBe(false);
  });

  it("does not collapse provider delivery states into a single check", () => {
    const labels = ["sending", "pending", "failed", "sent", "delivered", "read"]
      .map((status) => getWhatsappMessageStatusPresentation(status).label);

    expect(labels).toEqual(["Enviando", "Incerto", "Falhou", "Enviada", "Entregue", "Lida"]);
    expect(getWhatsappMessageStatusPresentation("pending").description).toContain("Não tente enviar novamente");
  });

  it("stops CRM polling while the document is hidden", () => {
    expect(getWhatsappPollingInterval(15_000)).toBe(15_000);
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { visibilityState: "hidden" },
    });
    try {
      expect(getWhatsappPollingInterval(15_000)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  });

  it("recovers a durable pending key after a detail remount", () => {
    const messages: Message[] = [{
      id: 44,
      direction: "outbound",
      content: "Mensagem ambígua",
      status: "pending",
      messageType: "text",
      createdAt: "2026-09-14T12:00:00.000Z",
      sentByName: null,
      clientRequestId: "request-that-must-be-reused",
    }, {
      id: 45,
      direction: "outbound",
      content: "Mensagem recusada",
      status: "failed",
      messageType: "text",
      createdAt: "2026-09-14T12:01:00.000Z",
      sentByName: null,
      clientRequestId: "request-that-can-be-retried-explicitly",
    }];

    expect(getRecoverableWhatsappSends(messages)).toEqual([{
      text: "Mensagem ambígua",
      requestId: "request-that-must-be-reused",
      status: "uncertain",
    }, {
      text: "Mensagem recusada",
      requestId: "request-that-can-be-retried-explicitly",
      status: "failed",
    }]);
  });

  it("patches the selected row preview without changing filtered list shape", () => {
    const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
      id: 7,
      phone: "5511999999999",
      displayName: "Contato",
      profileName: null,
      patientId: null,
      patientName: null,
      status: "new",
      unreadCount: 1,
      lastMessagePreview: "mensagem antiga",
      lastMessageAt: "2026-09-14T11:00:00.000Z",
      tags: [],
      assignedTo: null,
      assignedName: null,
      createdAt: "2026-09-14T10:00:00.000Z",
      ...overrides,
    });
    const current: WhatsappConversationsResponse = {
      conversations: [conversation()],
      counts: { all: 1, new: 1, in_progress: 0, waiting: 0, closed: 0, unread: 1 },
    };

    const updated = mergeWhatsappConversationPreview(current, conversation({
      lastMessagePreview: "nova mensagem recebida",
      lastMessageAt: "2026-09-14T11:05:00.000Z",
    }));

    expect(updated?.conversations).toHaveLength(1);
    expect(updated?.conversations[0].lastMessagePreview).toBe("nova mensagem recebida");
    expect(updated?.counts).toEqual(current.counts);
    expect(mergeWhatsappConversationPreview(updated, conversation())).toBe(updated);
  });
});
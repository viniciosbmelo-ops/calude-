import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  doctorsTable,
  patientsTable,
  whatsappContactsTable,
  whatsappConversationsTable,
  whatsappMessagesTable,
  whatsappWebhookEventsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { normalizeWhatsAppPhone, sendWhatsAppText } from "../lib/whatsapp";

const router: IRouter = Router();
const VALID_STATUSES = ["new", "in_progress", "waiting", "closed"] as const;
type ConversationStatus = (typeof VALID_STATUSES)[number];

function parseId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function cleanText(value: unknown, maxLength = 4000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function canonicalFingerprint(parts: readonly unknown[]): string {
  const canonical = parts
    .map((part) => {
      if (typeof part === "number" && Number.isFinite(part)) return String(part);
      if (typeof part === "string") return part.normalize("NFC");
      if (typeof part === "boolean") return part ? "true" : "false";
      return "";
    })
    .map((part) => `${part.length}:${part}`)
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalProviderTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function normalizedEvolutionEvent(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[_-]/g, ".") : "";
}

const DEFAULT_EVOLUTION_INSTANCE = "docknee-clinica-1";

function configuredEvolutionInstance(): string {
  return process.env["EVOLUTION_INSTANCE"]?.trim() || DEFAULT_EVOLUTION_INSTANCE;
}

function payloadEvolutionInstance(payload: Record<string, unknown>): string | null {
  const rootInstance = payload.instance;
  if (typeof rootInstance === "string" && rootInstance.trim()) return rootInstance.trim();
  const rawData = payload.data;
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    const dataInstance = (rawData as Record<string, unknown>).instance;
    if (typeof dataInstance === "string" && dataInstance.trim()) return dataInstance.trim();
  }
  return null;
}

export function evolutionWebhookInstanceIsAuthorized(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const supplied = payloadEvolutionInstance(payload as Record<string, unknown>);
  // Older Evolution payloads omitted instance. Keep accepting those while
  // binding any supplied provenance to the configured account.
  return supplied === null || supplied === configuredEvolutionInstance();
}

function providerInstance(payload: Record<string, unknown>): string {
  return payloadEvolutionInstance(payload) ?? configuredEvolutionInstance();
}

function messageFingerprint(
  instance: string,
  phone: string,
  content: { text: string; type: string },
  messageData: Record<string, unknown>,
  keyData: Record<string, unknown>,
): string {
  return `evolution-message:${canonicalFingerprint([
    "messages.upsert",
    instance,
    phone,
    content.type,
    content.text,
    canonicalProviderTimestamp(messageData.messageTimestamp),
    typeof keyData.remoteJid === "string" ? keyData.remoteJid.trim().toLowerCase() : "",
    typeof keyData.participant === "string" ? keyData.participant.trim().toLowerCase() : "",
  ])}`;
}

function webhookEventId(
  payload: Record<string, unknown>,
  message: { providerMessageId: string } | null,
): string {
  const event = normalizedEvolutionEvent(payload.event) || "unknown";
  const instance = providerInstance(payload);
  if (message) return `evolution-message-event:${instance}:${event}:${message.providerMessageId}`;
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : {};
  const key = data.key && typeof data.key === "object" ? data.key as Record<string, unknown> : {};
  return `evolution-event:${canonicalFingerprint([
    instance,
    event,
    typeof key.id === "string" ? key.id : "",
    typeof key.remoteJid === "string" ? key.remoteJid.trim().toLowerCase() : "",
    key.fromMe === true,
    canonicalProviderTimestamp(data.messageTimestamp),
  ])}`;
}

function conversationPayload(row: {
  conversation: typeof whatsappConversationsTable.$inferSelect;
  contact: typeof whatsappContactsTable.$inferSelect;
  patientName: string | null;
  assignedName: string | null;
}) {
  return {
    id: row.conversation.id,
    phone: row.contact.phoneE164,
    displayName: row.contact.displayName,
    profileName: row.contact.profileName,
    patientId: row.conversation.patientId,
    patientName: row.patientName,
    status: row.conversation.status,
    unreadCount: row.conversation.unreadCount,
    lastMessagePreview: row.conversation.lastMessagePreview,
    lastMessageAt: row.conversation.lastMessageAt,
    tags: row.conversation.tags,
    assignedTo: row.conversation.assignedTo,
    assignedName: row.assignedName,
    createdAt: row.conversation.createdAt,
  };
}

async function getConversationRow(id: number) {
  const [row] = await db
    .select({
      conversation: whatsappConversationsTable,
      contact: whatsappContactsTable,
      patientName: patientsTable.nome,
      assignedName: doctorsTable.nome,
    })
    .from(whatsappConversationsTable)
    .innerJoin(whatsappContactsTable, eq(whatsappContactsTable.id, whatsappConversationsTable.contactId))
    .leftJoin(patientsTable, eq(patientsTable.id, whatsappConversationsTable.patientId))
    .leftJoin(doctorsTable, eq(doctorsTable.id, whatsappConversationsTable.assignedTo))
    .where(eq(whatsappConversationsTable.id, id));
  return row;
}

export function evolutionWebhookIsAuthorized(req: Request): boolean {
  const configured = process.env["EVOLUTION_WEBHOOK_SECRET"] ?? process.env["EVOLUTION_API_KEY"];
  if (!configured) return false;
  const provided =
    req.get("x-webhook-secret") ??
    req.get("x-api-key") ??
    req.get("apikey") ??
    req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getWebhookText(data: Record<string, unknown>): { text: string; type: string } | null {
  const message = data.message;
  if (!message || typeof message !== "object") return null;
  const value = message as Record<string, unknown>;
  const conversation = value.conversation;
  if (typeof conversation === "string" && conversation.trim()) {
    return { text: conversation.trim(), type: "text" };
  }
  const extended = value.extendedTextMessage;
  if (extended && typeof extended === "object") {
    const text = (extended as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) return { text: text.trim(), type: "text" };
  }
  return null;
}

export function parseEvolutionWebhookMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const event = normalizedEvolutionEvent(root.event);
  if (event !== "messages.upsert") return null;
  const data = root.data;
  if (!data || typeof data !== "object") return null;
  const messageData = data as Record<string, unknown>;
  const key = messageData.key;
  if (!key || typeof key !== "object") return null;
  const messageKey = key as Record<string, unknown>;
  const remoteJid = typeof messageKey.remoteJid === "string" ? messageKey.remoteJid : "";
  if (!remoteJid || remoteJid.endsWith("@g.us") || messageKey.fromMe === true) return null;
  const phone = normalizeWhatsAppPhone(remoteJid.split("@")[0] ?? "");
  if (!phone) return null;
  const content = getWebhookText(messageData);
  if (!content) return null;
  const providerMessageId =
    typeof messageKey.id === "string" && messageKey.id.trim().length > 0
      ? messageKey.id.trim()
      : messageFingerprint(providerInstance(root), phone, content, messageData, messageKey);
  const pushName = typeof messageData.pushName === "string" ? messageData.pushName.trim() : null;
  return { phone, content, providerMessageId, pushName };
}

router.get("/admin/whatsapp/conversations", requireAdmin, async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" && VALID_STATUSES.includes(req.query.status as ConversationStatus)
    ? (req.query.status as ConversationStatus)
    : null;
  const unreadOnly = req.query.unreadOnly === "true";

  const filters = [];
  if (status) filters.push(eq(whatsappConversationsTable.status, status));
  if (unreadOnly) filters.push(sql`${whatsappConversationsTable.unreadCount} > 0`);
  if (search) {
    filters.push(or(
      ilike(whatsappContactsTable.phoneE164, `%${search}%`),
      ilike(whatsappContactsTable.displayName, `%${search}%`),
      ilike(whatsappContactsTable.profileName, `%${search}%`),
      ilike(patientsTable.nome, `%${search}%`),
      ilike(whatsappConversationsTable.lastMessagePreview, `%${search}%`),
    ));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const rows = await db
    .select({
      conversation: whatsappConversationsTable,
      contact: whatsappContactsTable,
      patientName: patientsTable.nome,
      assignedName: doctorsTable.nome,
    })
    .from(whatsappConversationsTable)
    .innerJoin(whatsappContactsTable, eq(whatsappContactsTable.id, whatsappConversationsTable.contactId))
    .leftJoin(patientsTable, eq(patientsTable.id, whatsappConversationsTable.patientId))
    .leftJoin(doctorsTable, eq(doctorsTable.id, whatsappConversationsTable.assignedTo))
    .where(where)
    .orderBy(desc(whatsappConversationsTable.lastMessageAt))
    .limit(200);

  const countRows = await db
    .select({
      all: sql<number>`count(*)::int`,
      new: sql<number>`count(*) filter (where ${whatsappConversationsTable.status} = 'new')::int`,
      in_progress: sql<number>`count(*) filter (where ${whatsappConversationsTable.status} = 'in_progress')::int`,
      waiting: sql<number>`count(*) filter (where ${whatsappConversationsTable.status} = 'waiting')::int`,
      closed: sql<number>`count(*) filter (where ${whatsappConversationsTable.status} = 'closed')::int`,
      unread: sql<number>`count(*) filter (where ${whatsappConversationsTable.unreadCount} > 0)::int`,
    })
    .from(whatsappConversationsTable)
    .innerJoin(whatsappContactsTable, eq(whatsappContactsTable.id, whatsappConversationsTable.contactId))
    .leftJoin(patientsTable, eq(patientsTable.id, whatsappConversationsTable.patientId))
    .leftJoin(doctorsTable, eq(doctorsTable.id, whatsappConversationsTable.assignedTo))
    .where(where);

  const count = countRows[0] ?? { all: 0, new: 0, in_progress: 0, waiting: 0, closed: 0, unread: 0 };
  res.json({
    conversations: rows.map((row) => conversationPayload(row)),
    counts: count,
  });
});

router.get("/admin/whatsapp/conversations/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "ID da conversa inválido." });
    return;
  }
  const row = await getConversationRow(id);
  if (!row) {
    res.status(404).json({ error: "Conversa não encontrada." });
    return;
  }
  const messages = await db
    .select({
      id: whatsappMessagesTable.id,
      direction: whatsappMessagesTable.direction,
      content: whatsappMessagesTable.content,
      status: whatsappMessagesTable.status,
      messageType: whatsappMessagesTable.messageType,
      createdAt: whatsappMessagesTable.createdAt,
      clientRequestId: whatsappMessagesTable.clientRequestId,
      sentByName: doctorsTable.nome,
    })
    .from(whatsappMessagesTable)
    .leftJoin(doctorsTable, eq(doctorsTable.id, whatsappMessagesTable.sentBy))
    .where(eq(whatsappMessagesTable.conversationId, id))
    .orderBy(asc(whatsappMessagesTable.createdAt), asc(whatsappMessagesTable.id));
  const readThroughMessageId =
    [...messages].reverse().find((message) => message.direction === "inbound")?.id ?? null;
  res.json({ conversation: conversationPayload(row), messages, readThroughMessageId });
});

router.get("/admin/whatsapp/assignees", requireAdmin, async (_req, res): Promise<void> => {
  const assignees = await db
    .select({ id: doctorsTable.id, name: doctorsTable.nome })
    .from(doctorsTable)
    .where(eq(doctorsTable.isAdmin, true))
    .orderBy(asc(doctorsTable.nome));
  res.json(assignees.map((item) => ({ ...item, role: "Administrador" })));
});

router.patch("/admin/whatsapp/conversations/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "ID da conversa inválido." });
    return;
  }
  const data = req.body as Record<string, unknown>;
  const update: Partial<typeof whatsappConversationsTable.$inferInsert> = {};
  if (data.status !== undefined) {
    if (typeof data.status !== "string" || !VALID_STATUSES.includes(data.status as ConversationStatus)) {
      res.status(400).json({ error: "Status inválido." });
      return;
    }
    update.status = data.status;
  }
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string" || tag.length > 40) || data.tags.length > 20) {
      res.status(400).json({ error: "Tags inválidas." });
      return;
    }
    update.tags = data.tags.map((tag) => tag.trim()).filter(Boolean);
  }
  if (data.assignedTo !== undefined) {
    const assignedTo = data.assignedTo;
    if (assignedTo !== null && (typeof assignedTo !== "number" || !Number.isSafeInteger(assignedTo) || assignedTo <= 0)) {
      res.status(400).json({ error: "Responsável inválido." });
      return;
    }
    if (assignedTo !== null) {
      const [assignee] = await db.select({ id: doctorsTable.id }).from(doctorsTable)
        .where(and(eq(doctorsTable.id, assignedTo), eq(doctorsTable.isAdmin, true)));
      if (!assignee) {
        res.status(400).json({ error: "Responsável não encontrado." });
        return;
      }
    }
    update.assignedTo = assignedTo;
  }
  if (data.patientId !== undefined) {
    const patientId = data.patientId;
    if (patientId !== null && (typeof patientId !== "number" || !Number.isSafeInteger(patientId) || patientId <= 0)) {
      res.status(400).json({ error: "Paciente inválido." });
      return;
    }
    if (patientId !== null) {
      const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
        .where(eq(patientsTable.id, patientId));
      if (!patient) {
        res.status(400).json({ error: "Paciente não encontrado." });
        return;
      }
    }
    update.patientId = patientId;
    update.patientLinkSource = "manual";
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Nenhuma alteração informada." });
    return;
  }
  const [updated] = await db.update(whatsappConversationsTable).set(update).where(eq(whatsappConversationsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Conversa não encontrada." });
    return;
  }
  const row = await getConversationRow(id);
  res.json(conversationPayload(row!));
});

router.post("/admin/whatsapp/conversations/:id/read", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "ID da conversa inválido." });
    return;
  }
  const body = req.body as Record<string, unknown> | undefined;
  const readThroughMessageId = body?.readThroughMessageId;
  if (
    typeof readThroughMessageId !== "number" ||
    !Number.isSafeInteger(readThroughMessageId) ||
    readThroughMessageId <= 0
  ) {
    res.status(400).json({
      error: "Informe readThroughMessageId retornado pelo detalhe da conversa.",
      code: "READ_CURSOR_REQUIRED",
    });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Lock the conversation before counting. A webhook that races this read
    // either commits before the count (and is included) or increments after
    // the lock is released, so a new inbound can never be erased.
    const [current] = await tx
      .select({ id: whatsappConversationsTable.id })
      .from(whatsappConversationsTable)
      .where(eq(whatsappConversationsTable.id, id))
      .for("update");
    if (!current) return { kind: "missing" as const };

    const [marker] = await tx
      .select({ id: whatsappMessagesTable.id })
      .from(whatsappMessagesTable)
      .where(and(
        eq(whatsappMessagesTable.id, readThroughMessageId),
        eq(whatsappMessagesTable.conversationId, id),
        eq(whatsappMessagesTable.direction, "inbound"),
      ));
    if (!marker) return { kind: "invalid_cursor" as const };

    const [updated] = await tx
      .update(whatsappConversationsTable)
      .set({
        // A stale reader may arrive after a newer reader. Never increase the
        // aggregate unread count while acknowledging an older cursor.
        unreadCount: sql`LEAST(
          ${whatsappConversationsTable.unreadCount},
          (
            SELECT count(*)::int
              FROM ${whatsappMessagesTable}
             WHERE ${whatsappMessagesTable.conversationId} = ${id}
               AND ${whatsappMessagesTable.direction} = 'inbound'
               AND ${whatsappMessagesTable.id} > ${marker.id}
          )
        )`,
      })
      .where(eq(whatsappConversationsTable.id, id))
      .returning();
    return updated ? { kind: "updated" as const, conversation: updated } : { kind: "missing" as const };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "Conversa não encontrada." });
    return;
  }
  if (result.kind === "invalid_cursor") {
    res.status(409).json({
      error: "O cursor de leitura não pertence a uma mensagem recebida desta conversa.",
      code: "READ_CURSOR_INVALID",
    });
    return;
  }
  const row = await getConversationRow(id);
  res.json(conversationPayload(row!));
});

router.post("/admin/whatsapp/conversations/:id/messages", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const body = req.body as Record<string, unknown>;
  const text = cleanText(body?.text);
  const requestId = cleanText(body?.requestId, 100);
  if (id === null || !text || !requestId || requestId.length < 16) {
    res.status(400).json({ error: "Informe uma mensagem válida." });
    return;
  }
  const row = await getConversationRow(id);
  if (!row) {
    res.status(404).json({ error: "Conversa não encontrada." });
    return;
  }
  const [created] = await db.insert(whatsappMessagesTable).values({
      conversationId: id,
      clientRequestId: requestId,
      direction: "outbound",
      status: "sending",
      messageType: "text",
      content: text,
      sentBy: req.doctorId ?? null,
    }).onConflictDoNothing({ target: whatsappMessagesTable.clientRequestId }).returning();

  let message = created;
  if (!message) {
    const [existing] = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.clientRequestId, requestId));
    if (!existing || existing.conversationId !== id || existing.content !== text) {
      res.status(409).json({ error: "Chave de envio já utilizada em outra mensagem." });
      return;
    }
    if (existing.status !== "failed") {
      res.json({
        id: existing.id,
        direction: existing.direction,
        content: existing.content,
        status: existing.status,
        messageType: existing.messageType,
        createdAt: existing.createdAt,
        clientRequestId: existing.clientRequestId,
        sentByName: null,
      });
      return;
    }
    const [claimed] = await db.update(whatsappMessagesTable).set({ status: "sending" })
      .where(and(eq(whatsappMessagesTable.id, existing.id), eq(whatsappMessagesTable.status, "failed")))
      .returning();
    if (!claimed) {
      res.status(409).json({ error: "Mensagem já está sendo reenviada." });
      return;
    }
    message = claimed;
  }

  let result;
  try {
    result = await sendWhatsAppText(row.contact.phoneE164, text, {
      idempotencyKey: `admin-whatsapp-message:${message.id}`,
    });
  } catch {
    const [pendingMessage] = await db.update(whatsappMessagesTable).set({ status: "pending" })
      .where(eq(whatsappMessagesTable.id, message.id)).returning();
    res.status(202).json({
      id: pendingMessage.id,
      direction: pendingMessage.direction,
      content: pendingMessage.content,
      status: pendingMessage.status,
      messageType: pendingMessage.messageType,
      createdAt: pendingMessage.createdAt,
      clientRequestId: pendingMessage.clientRequestId,
      sentByName: null,
    });
    return;
  }
  if (!result.ok && result.deliveryUncertain) {
    const [pendingMessage] = await db.update(whatsappMessagesTable).set({ status: "pending" })
      .where(eq(whatsappMessagesTable.id, message.id)).returning();
    res.status(202).json({
      id: pendingMessage.id,
      direction: pendingMessage.direction,
      content: pendingMessage.content,
      status: pendingMessage.status,
      messageType: pendingMessage.messageType,
      createdAt: pendingMessage.createdAt,
      clientRequestId: pendingMessage.clientRequestId,
      sentByName: null,
    });
    return;
  }
  if (!result.ok) {
    await db.update(whatsappMessagesTable).set({ status: "failed" })
      .where(eq(whatsappMessagesTable.id, message.id));
    res.status(502).json({ error: result.error ?? "Não foi possível enviar a mensagem." });
    return;
  }
  const finalStatus = result.messageId ? "sent" : "pending";
  const [savedMessage] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(whatsappMessagesTable).set({
      providerMessageId: result.messageId ?? null,
        status: finalStatus,
    }).where(eq(whatsappMessagesTable.id, message.id)).returning();
    await tx.update(whatsappConversationsTable).set({
      lastMessagePreview: text.slice(0, 240),
      lastMessageAt: new Date(),
      status: "waiting",
      updatedAt: new Date(),
    }).where(eq(whatsappConversationsTable.id, id));
    return [saved];
  });
  res.status(savedMessage.status === "pending" ? 202 : created ? 201 : 200).json({
    id: savedMessage.id,
    direction: savedMessage.direction,
    content: savedMessage.content,
    status: savedMessage.status,
    messageType: savedMessage.messageType,
    createdAt: savedMessage.createdAt,
    clientRequestId: savedMessage.clientRequestId,
    sentByName: null,
  });
});

router.post("/webhooks/evolution", async (req, res): Promise<void> => {
  if (!evolutionWebhookIsAuthorized(req)) {
    res.status(401).json({ error: "Webhook não autorizado." });
    return;
  }
  const payload = req.body as Record<string, unknown>;
  if (!evolutionWebhookInstanceIsAuthorized(payload)) {
    res.status(403).json({ error: "Instância Evolution não autorizada." });
    return;
  }
  const eventName = typeof payload?.event === "string" ? payload.event : "unknown";
  const data = parseEvolutionWebhookMessage(payload);
  const providerEventId = webhookEventId(payload, data);

  const outcome = await db.transaction(async (tx) => {
    const insertedEvent = await tx.insert(whatsappWebhookEventsTable).values({
      providerEventId,
      eventName,
      processedAt: null,
    }).onConflictDoNothing({ target: whatsappWebhookEventsTable.providerEventId }).returning({ id: whatsappWebhookEventsTable.id });
    if (insertedEvent.length === 0) return { kind: "duplicate" as const };
    if (!data) {
      await tx.update(whatsappWebhookEventsTable).set({ processedAt: new Date() })
        .where(eq(whatsappWebhookEventsTable.providerEventId, providerEventId));
      return { kind: "ignored" as const };
    }

    const normalizedPatientPhone = sql<string>`
      CASE
        WHEN left(regexp_replace(coalesce(${patientsTable.telefone}, ''), '\D', '', 'g'), 2) = '55'
          THEN regexp_replace(coalesce(${patientsTable.telefone}, ''), '\D', '', 'g')
        WHEN length(regexp_replace(coalesce(${patientsTable.telefone}, ''), '\D', '', 'g')) IN (10, 11)
          THEN '55' || regexp_replace(coalesce(${patientsTable.telefone}, ''), '\D', '', 'g')
        ELSE regexp_replace(coalesce(${patientsTable.telefone}, ''), '\D', '', 'g')
      END
    `;
    const matchingPatients = await tx.select({ id: patientsTable.id }).from(patientsTable)
      .where(sql`${normalizedPatientPhone} = ${data.phone}`)
      .limit(2);
    const matchedPatientId = matchingPatients.length === 1 ? matchingPatients[0].id : null;

    const [contact] = await tx.insert(whatsappContactsTable).values({
      phoneE164: data.phone,
      displayName: data.pushName,
      profileName: data.pushName,
      patientId: matchedPatientId,
    }).onConflictDoUpdate({
      target: whatsappContactsTable.phoneE164,
      set: {
        displayName: data.pushName ?? undefined,
        profileName: data.pushName ?? undefined,
        // Conversation-level manual links are authoritative. Keep the
        // contact association stable rather than overwriting a prior manual
        // or explicit no-patient choice during automatic matching.
        updatedAt: new Date(),
      },
    }).returning();
    if (!contact) throw new Error("Não foi possível criar o contato do WhatsApp.");

    const [conversation] = await tx.insert(whatsappConversationsTable).values({
      contactId: contact.id,
      provider: "evolution",
      patientId: matchedPatientId,
      patientLinkSource: matchedPatientId === null ? null : "auto",
      lastMessagePreview: data.content.text.slice(0, 240),
      lastMessageAt: new Date(),
      status: "new",
    }).onConflictDoUpdate({
      target: [whatsappConversationsTable.provider, whatsappConversationsTable.contactId],
      set: {
        lastMessagePreview: data.content.text.slice(0, 240),
        lastMessageAt: new Date(),
        patientId: sql`CASE
          WHEN ${whatsappConversationsTable.patientLinkSource} = 'manual'
            THEN ${whatsappConversationsTable.patientId}
          ELSE ${matchedPatientId}
        END`,
        patientLinkSource: matchedPatientId === null
          ? sql`CASE
              WHEN ${whatsappConversationsTable.patientLinkSource} = 'manual'
                THEN 'manual'
              ELSE NULL
            END`
          : sql`CASE
              WHEN ${whatsappConversationsTable.patientLinkSource} = 'manual'
                THEN 'manual'
              ELSE 'auto'
            END`,
        updatedAt: new Date(),
      },
    }).returning();
    if (!conversation) throw new Error("Não foi possível criar a conversa do WhatsApp.");

    const [message] = await tx.insert(whatsappMessagesTable).values({
      conversationId: conversation.id,
      providerMessageId: data.providerMessageId,
      direction: "inbound",
      status: "received",
      messageType: data.content.type,
      content: data.content.text,
    }).onConflictDoNothing({ target: whatsappMessagesTable.providerMessageId }).returning();

    if (message) {
      await tx.update(whatsappConversationsTable).set({
        unreadCount: sql`${whatsappConversationsTable.unreadCount} + 1`,
        status: "new",
        updatedAt: new Date(),
      }).where(eq(whatsappConversationsTable.id, conversation.id));
    }
    await tx.update(whatsappWebhookEventsTable).set({ processedAt: new Date() })
      .where(eq(whatsappWebhookEventsTable.providerEventId, providerEventId));
    return { kind: message ? "created" as const : "duplicate" as const };
  });

  if (outcome.kind === "duplicate") {
    res.json({ ok: true, duplicate: true });
    return;
  }
  if (outcome.kind === "ignored") {
    res.json({ ok: true, ignored: true });
    return;
  }
  res.status(201).json({ ok: true, messageId: data?.providerMessageId });
});

export default router;
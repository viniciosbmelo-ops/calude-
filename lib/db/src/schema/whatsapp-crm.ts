import {
  integer,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";

export const whatsappContactsTable = pgTable(
  "whatsapp_contacts",
  {
    id: serial("id").primaryKey(),
    phoneE164: text("phone_e164").notNull(),
    displayName: text("display_name"),
    profileName: text("profile_name"),
    patientId: integer("patient_id").references(() => patientsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("whatsapp_contacts_phone_e164_unique").on(table.phoneE164)],
);

export const whatsappConversationsTable = pgTable(
  "whatsapp_conversations",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => whatsappContactsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("evolution"),
    providerConversationId: text("provider_conversation_id"),
    patientId: integer("patient_id").references(() => patientsTable.id, { onDelete: "set null" }),
    patientLinkSource: text("patient_link_source"),
    status: text("status").notNull().default("new"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    tags: text("tags").array().notNull().default([]),
    assignedTo: integer("assigned_to").references(() => doctorsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("whatsapp_conversations_provider_contact_unique").on(table.provider, table.contactId),
    index("whatsapp_conversations_last_message_idx").on(table.lastMessageAt),
    index("whatsapp_conversations_status_idx").on(table.status),
  ],
);

export const whatsappMessagesTable = pgTable(
  "whatsapp_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => whatsappConversationsTable.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id"),
    clientRequestId: text("client_request_id"),
    direction: text("direction").notNull(),
    status: text("status").notNull().default("received"),
    messageType: text("message_type").notNull().default("text"),
    content: text("content").notNull(),
    sentBy: integer("sent_by").references(() => doctorsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_messages_provider_message_unique").on(table.providerMessageId),
    uniqueIndex("whatsapp_messages_client_request_unique").on(table.clientRequestId),
    index("whatsapp_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const whatsappWebhookEventsTable = pgTable(
  "whatsapp_webhook_events",
  {
    id: serial("id").primaryKey(),
    providerEventId: text("provider_event_id").notNull(),
    eventName: text("event_name").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("whatsapp_webhook_events_provider_id_unique").on(table.providerEventId)],
);

export const insertWhatsappContactSchema = createInsertSchema(whatsappContactsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertWhatsappConversationSchema = createInsertSchema(whatsappConversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessagesTable).omit({
  id: true,
  createdAt: true,
});
export const insertWhatsappWebhookEventSchema = createInsertSchema(whatsappWebhookEventsTable).omit({
  id: true,
  createdAt: true,
});

export type WhatsappContact = typeof whatsappContactsTable.$inferSelect;
export type InsertWhatsappContact = z.infer<typeof insertWhatsappContactSchema>;
export type WhatsappConversation = typeof whatsappConversationsTable.$inferSelect;
export type InsertWhatsappConversation = z.infer<typeof insertWhatsappConversationSchema>;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappWebhookEvent = typeof whatsappWebhookEventsTable.$inferSelect;
export type InsertWhatsappWebhookEvent = z.infer<typeof insertWhatsappWebhookEventSchema>;
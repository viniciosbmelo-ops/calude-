import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  integer,
  real,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { surgeriesTable } from "./surgeries";
import { patientsTable } from "./patients";

export const followupTable = pgTable("followup", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  tempo: text("tempo").notNull(),
  dataAvaliacao: text("data_avaliacao"),
  ikdc: real("ikdc"),
  koosSintomas: real("koos_sintomas"),
  koosDor: real("koos_dor"),
  koosFuncao: real("koos_funcao"),
  koosEsporte: real("koos_esporte"),
  koosQualidade: real("koos_qualidade"),
  lysholm: integer("lysholm"),
  tegner: integer("tegner"),
  kujala: integer("kujala"),
  vasDor: integer("vas_dor"),
  aclRsi: real("acl_rsi"),
  marx: integer("marx"),
  womac: real("womac"),
  koos12: real("koos12"),
  admFlexao: integer("adm_flexao"),
  admExtensao: integer("adm_extensao"),
  complicacoes: text("complicacoes").array(),
  retornoEsporte: boolean("retorno_esporte"),
  nivelRetorno: text("nivel_retorno"),
  falha: boolean("falha"),
  falhaType: text("falha_type"),
  observacoes: text("observacoes"),
  token: text("token").unique(),
  escalasEnviadas: text("escalas_enviadas").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const scaleResponsesTable = pgTable(
  "scale_responses",
  {
    id: serial("id").primaryKey(),
    followupId: integer("followup_id")
      .notNull()
      .references(() => followupTable.id, { onDelete: "cascade" }),
    nomeEscala: text("nome_escala").notNull(),
    respostas: text("respostas").notNull(),
    score: real("score"),
    completadoEm: timestamp("completado_em", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("scale_responses_followup_id_nome_escala_unique").on(
      t.followupId,
      t.nomeEscala,
    ),
  ],
);

export const scheduledNotificationsTable = pgTable("scheduled_notifications", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  periodo: text("periodo").notNull(),
  daysAfterSurgery: integer("days_after_surgery"),
  scheduledDate: text("scheduled_date"),
  scales: text("scales").array().notNull().default([]),
  // status: pending | processing | sent | failed | no_phone
  status: text("status").notNull().default("pending"),
  followupId: integer("followup_id").references(() => followupTable.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  whatsappMessageId: text("whatsapp_message_id"),
  notes: text("notes"),
  // Retry / backoff fields
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Persists Stripe webhook event IDs for idempotent deduplication.
 * A unique constraint on stripe_event_id prevents double-processing.
 */
export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: serial("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("stripe_webhook_events_event_id_unique").on(t.stripeEventId),
]);

export const insertFollowupSchema = createInsertSchema(followupTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFollowup = z.infer<typeof insertFollowupSchema>;
export type Followup = typeof followupTable.$inferSelect;
export type ScaleResponse = typeof scaleResponsesTable.$inferSelect;
export type ScheduledNotification = typeof scheduledNotificationsTable.$inferSelect;
export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;

import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const adminContactMessages = pgTable("admin_contact_messages", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id"),
  nome: text("nome"),
  email: text("email"),
  celular: text("celular"),
  crm: text("crm"),
  mensagem: text("mensagem").notNull(),
  lida: boolean("lida").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resposta: text("resposta"),
  respondidaEm: timestamp("respondida_em", { withTimezone: true }),
  respostaLida: boolean("resposta_lida").notNull().default(false),
  // ── Support ticket metadata ──────────────────────────────────────────────────
  /** 'open' | 'in_progress' | 'resolved' | 'closed' */
  ticketStatus: text("ticket_status"),
  /** 'low' | 'medium' | 'high' | 'critical' */
  ticketPriority: text("ticket_priority"),
  /** Comma-separated tags for categorization. */
  ticketTags: text("ticket_tags"),
  /** Admin doctor ID who owns this ticket. */
  assignedTo: integer("assigned_to"),
  /** When the first admin response was sent. */
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  /** When the ticket was resolved. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** SLA deadline timestamp. */
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
});

export type AdminContactMessage = typeof adminContactMessages.$inferSelect;

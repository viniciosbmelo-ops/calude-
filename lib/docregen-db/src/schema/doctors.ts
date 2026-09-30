import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const doctorsTable = pgTable("doctors", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  crm: text("crm"),
  crmEstado: text("crm_estado"),
  telefone: text("telefone"),
  cpf: text("cpf"),
  estrangeiro: boolean("estrangeiro").notNull().default(false),
  paisOrigem: text("pais_origem"),
  dataNascimento: text("data_nascimento"),
  endereco: text("endereco"),
  cidade: text("cidade"),
  estado: text("estado"),
  cep: text("cep"),
  especialidade: text("especialidade"),
  idioma: text("idioma").notNull().default("pt-BR"),
  whatsappBusiness: text("whatsapp_business"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  isAdmin: boolean("is_admin").notNull().default(false),
  isFree: boolean("is_free").notNull().default(false),
  temporaryAccessExpiresAt: timestamp("temporary_access_expires_at", { withTimezone: true }),
  aprovado: boolean("aprovado").notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(0),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  // Updated only after a successful authentication; separate from clinical activity.
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /**
   * AES-256-GCM encrypted TOTP secret.
   * Null means 2FA has not been set up (or has been disabled).
   * Format: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
   */
  totpSecretEnc: text("totp_secret_enc"),
  /** Whether TOTP 2FA is currently active (setup confirmed). */
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  /**
   * JSON array of bcrypt-hashed recovery codes.
   * Each element is a bcrypt hash; once used the element becomes null.
   * Null when TOTP is not enabled.
   */
  totpRecoveryCodesHash: text("totp_recovery_codes_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // E-mails are stored lowercase; this index also rejects legacy mixed-case
  // duplicates ("A@x" vs "a@x") that could shadow an account at login.
  uniqueIndex("doctors_email_lower_unique").on(sql`lower(${t.email})`),
]);

export const insertDoctorSchema = createInsertSchema(doctorsTable).omit({
  id: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDoctor = z.infer<typeof insertDoctorSchema>;
export type Doctor = typeof doctorsTable.$inferSelect;

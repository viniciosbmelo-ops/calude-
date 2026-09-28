import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id")
    .notNull()
    .references(() => doctorsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
  index("password_reset_tokens_doctor_id_idx").on(table.doctorId),
  index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
]);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
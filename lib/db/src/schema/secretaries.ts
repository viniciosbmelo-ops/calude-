import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";

export const secretariesTable = pgTable("secretaries", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSecretarySchema = createInsertSchema(secretariesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSecretary = z.infer<typeof insertSecretarySchema>;
export type Secretary = typeof secretariesTable.$inferSelect;

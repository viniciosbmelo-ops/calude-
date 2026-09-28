import { pgTable, text, serial, timestamp, boolean, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  cnpj: text("cnpj"),
  responsavelNome: text("responsavel_nome").notNull(),
  responsavelCpf: text("responsavel_cpf").notNull(),
  responsavelCrm: text("responsavel_crm").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const doctorServicesTable = pgTable("doctor_services", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("doctor_service_unique").on(t.doctorId, t.serviceId),
]);

export const doctorLocationsTable = pgTable("doctor_locations", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
export type DoctorService = typeof doctorServicesTable.$inferSelect;
export type DoctorLocation = typeof doctorLocationsTable.$inferSelect;

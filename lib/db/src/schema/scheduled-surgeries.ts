import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";

export const scheduledSurgeriesTable = pgTable("scheduled_surgeries", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  hora: text("hora").notNull(),
  tipoCirurgia: text("tipo_cirurgia").notNull(),
  hospital: text("hospital"),
  planoSaude: text("plano_saude"),
  codigosCbhpm: text("codigos_cbhpm"),
  materiais: text("materiais"),
  destinatarios: text("destinatarios"),
  status: text("status").notNull().default("agendado"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const doctorSurgeryConfigTable = pgTable("doctor_surgery_config", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().unique().references(() => doctorsTable.id, { onDelete: "cascade" }),
  hospitais: text("hospitais").notNull().default("[]"),
  planosSaude: text("planos_saude").notNull().default("[]"),
  materiais: text("materiais").notNull().default("[]"),
  fornecedores: text("fornecedores").notNull().default("[]"),
  destinatarios: text("destinatarios").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertScheduledSurgerySchema = createInsertSchema(scheduledSurgeriesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertScheduledSurgery = z.infer<typeof insertScheduledSurgerySchema>;
export type ScheduledSurgery = typeof scheduledSurgeriesTable.$inferSelect;
export type DoctorSurgeryConfig = typeof doctorSurgeryConfigTable.$inferSelect;

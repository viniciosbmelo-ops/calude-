import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { doctorsTable } from "./doctors";

export const surgeriesTable = pgTable("surgeries", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  dataCirurgia: text("data_cirurgia"),
  hospital: text("hospital"),
  lado: text("lado"),
  tipoCaso: text("tipo_caso"),
  diagnostico: text("diagnostico"),
  tiposProcedimento: text("tipos_procedimento").array().notNull().default([]),
  procedimentoRealizado: text("procedimento_realizado"),
  observacoes: text("observacoes"),
  // DocSholder: região (shoulder | elbow) e dados clínicos de ombro/cotovelo.
  // Formato e validação em @workspace/clinical (surgery/payload.ts).
  regiao: text("regiao"),
  dadosClinicos: jsonb("dados_clinicos"),
  status: text("status").notNull().default("completo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSurgerySchema = createInsertSchema(surgeriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSurgery = z.infer<typeof insertSurgerySchema>;
export type Surgery = typeof surgeriesTable.$inferSelect;

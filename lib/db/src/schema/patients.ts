import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";

export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  cpf: text("cpf"),
  dataNascimento: text("data_nascimento"),
  email: text("email"),
  sexo: text("sexo"),
  telefone: text("telefone"),
  lado: text("lado"),
  nivelAtividade: text("nivel_atividade"),
  esportePivot: boolean("esporte_pivot").notNull().default(false),
  beightonScore: integer("beighton_score"),
  anamnese: text("anamnese"),
  laudos: text("laudos"),
  planoSaude: text("plano_saude"),
  numeroCarteirinha: text("numero_carteirinha"),
  indicadoPor: text("indicado_por"),
  pais: text("pais"),
  endereco: text("endereco"),
  cidade: text("cidade"),
  estado: text("estado"),
  cep: text("cep"),
  numeroRegistro: text("numero_registro").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;

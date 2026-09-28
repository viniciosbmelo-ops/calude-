import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
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
  alinhamento: text("alinhamento"),
  grauAlinhamento: text("grau_alinhamento"),
  rxAnaliseJson: text("rx_analise_json"),
  rxImageUrl: text("rx_image_url"),
  slopeTibialJson: text("slope_tibial_json"),
  tiposProcedimento: text("tipos_procedimento").array().notNull().default([]),
  ligamentosAcometidos: text("ligamentos_acometidos").array().notNull().default([]),
  enxerto: text("enxerto"),
  diametroEnxerto: text("diametro_enxerto"),
  tunelFemoral: text("tunel_femoral"),
  fixacaoFemoral: text("fixacao_femoral"),
  fixacaoTibial: text("fixacao_tibial"),
  flipCutter: text("flip_cutter"),
  internalBrace: text("internal_brace"),
  tipoLca: text("tipo_lca"),
  localizacaoLesaoLca: text("localizacao_lesao_lca"),
  fixacaoReparoLca: text("fixacao_reparo_lca"),
  preservacaoRemanescente: text("preservacao_remanescente"),
  reforco: text("reforco"),
  procedimentoRealizado: text("procedimento_realizado"),
  procedimentosDetalhados: text("procedimentos_detalhados"),
  observacoes: text("observacoes"),
  // Túneis pediátricos (esqueleto imaturo)
  tunelFemoralPediatrico: text("tunel_femoral_pediatrico"),
  tunelTibialPediatrico: text("tunel_tibial_pediatrico"),
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

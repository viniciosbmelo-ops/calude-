/**
 * Apoio à decisão: trilha de auditoria e governança. Tabelas SÓ DE INSERÇÃO.
 *
 * - `apoio_decisao_execucoes`: cada avaliação feita no servidor (entrada, proveniência, resultado).
 * - `apoio_decisao_escolhas`: a escolha do cirurgião diante de uma execução (a mais recente vale).
 * - `apoio_decisao_status`: histórico de status por algoritmo@versão, travado pelo hash do conteúdo
 *   (a linha mais recente vale; sem linha = rascunho).
 *
 * FKs com nome curto e explícito: o nome automático de drizzle pode passar de 63 caracteres e
 * fazer o `push` derrubar e recriar a FK a cada execução.
 */
import { pgTable, serial, integer, text, jsonb, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";
import { surgeriesTable } from "./surgeries";

export const apoioDecisaoExecucoesTable = pgTable("apoio_decisao_execucoes", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  patientId: integer("patient_id"),
  surgeryId: integer("surgery_id"),
  algoritmoId: text("algoritmo_id").notNull(),
  algoritmoVersao: text("algoritmo_versao").notNull(),
  algoritmoHash: text("algoritmo_hash").notNull(),
  /** Status da versão no momento da avaliação: rascunho | revisado | ativo | aposentado. */
  statusNoMomento: text("status_no_momento").notNull(),
  motorVersao: text("motor_versao").notNull(),
  /** preop | registro | revisao (revisão = avaliação de versão não ativa por admin). */
  modo: text("modo").notNull(),
  entrada: jsonb("entrada").notNull(),
  proveniencia: jsonb("proveniencia").notNull(),
  /** Resultado completo, sempre recalculado no servidor. */
  resultado: jsonb("resultado").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "ade_doctor_fk", columns: [t.doctorId], foreignColumns: [doctorsTable.id] }).onDelete("cascade"),
  foreignKey({ name: "ade_patient_fk", columns: [t.patientId], foreignColumns: [patientsTable.id] }).onDelete("cascade"),
  foreignKey({ name: "ade_surgery_fk", columns: [t.surgeryId], foreignColumns: [surgeriesTable.id] }).onDelete("cascade"),
  index("ade_doctor_idx").on(t.doctorId),
  index("ade_patient_idx").on(t.patientId),
  index("ade_surgery_idx").on(t.surgeryId),
  index("ade_algoritmo_idx").on(t.algoritmoId, t.algoritmoVersao),
]);

export const apoioDecisaoEscolhasTable = pgTable("apoio_decisao_escolhas", {
  id: serial("id").primaryKey(),
  execucaoId: integer("execucao_id").notNull(),
  doctorId: integer("doctor_id").notNull(),
  /** Id de uma opção do algoritmo; nulo quando o cirurgião escolheu "outra". */
  opcao: text("opcao"),
  /** Texto livre quando a escolha não é uma opção do algoritmo. */
  outra: text("outra"),
  /** concorda | diverge | sem_sugestao — calculada no servidor. */
  concordancia: text("concordancia").notNull(),
  justificativa: text("justificativa"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "ade_escolha_exec_fk", columns: [t.execucaoId], foreignColumns: [apoioDecisaoExecucoesTable.id] }).onDelete("cascade"),
  foreignKey({ name: "ade_escolha_doctor_fk", columns: [t.doctorId], foreignColumns: [doctorsTable.id] }).onDelete("cascade"),
  index("ade_escolha_exec_idx").on(t.execucaoId),
]);

export const apoioDecisaoStatusTable = pgTable("apoio_decisao_status", {
  id: serial("id").primaryKey(),
  algoritmoId: text("algoritmo_id").notNull(),
  algoritmoVersao: text("algoritmo_versao").notNull(),
  algoritmoHash: text("algoritmo_hash").notNull(),
  /** rascunho | revisado | ativo | aposentado */
  status: text("status").notNull(),
  /** Quem mudou (admin). O histórico sobrevive à remoção do médico: o autor vira nulo. */
  doctorId: integer("doctor_id"),
  nota: text("nota"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "ads_doctor_fk", columns: [t.doctorId], foreignColumns: [doctorsTable.id] }).onDelete("set null"),
  index("ads_algoritmo_idx").on(t.algoritmoId, t.algoritmoVersao, t.id),
]);

export type ApoioDecisaoExecucao = typeof apoioDecisaoExecucoesTable.$inferSelect;
export type ApoioDecisaoEscolha = typeof apoioDecisaoEscolhasTable.$inferSelect;
export type ApoioDecisaoStatus = typeof apoioDecisaoStatusTable.$inferSelect;

import { pgTable, serial, text, integer, timestamp, foreignKey } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";
import { doctorsTable } from "./doctors";
import { preConsultQuestionnairesTable } from "./pre-consult";

export const patientAttachmentsTable = pgTable("patient_attachments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  preConsultQuestionnaireId: integer("pre_consult_questionnaire_id"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type").notNull(),
  objectPath: text("object_path").notNull(),
  category: text("category"),
  descricao: text("descricao"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Explicit name: the auto-generated one exceeds Postgres' 63-char limit,
  // which made drizzle-kit push drop/re-add this FK on every run.
  foreignKey({
    name: "patient_attachments_pre_consult_questionnaire_id_fk",
    columns: [t.preConsultQuestionnaireId],
    foreignColumns: [preConsultQuestionnairesTable.id],
  }).onDelete("cascade"),
]);

export type PatientAttachment = typeof patientAttachmentsTable.$inferSelect;
export type InsertPatientAttachment = typeof patientAttachmentsTable.$inferInsert;

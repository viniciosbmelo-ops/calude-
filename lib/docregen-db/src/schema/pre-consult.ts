import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";

export const preConsultQuestionnairesTable = pgTable(
  "pre_consult_questionnaires",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    doctorId: integer("doctor_id")
      .notNull()
      .references(() => doctorsTable.id, { onDelete: "cascade" }),
    questionnaireVersion: integer("questionnaire_version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    draftAnswers: jsonb("draft_answers")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    patientAnswers: jsonb("patient_answers").$type<Record<string, unknown>>(),
    currentAnswers: jsonb("current_answers").$type<Record<string, unknown>>(),
    lastPatientSavedAt: timestamp("last_patient_saved_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    doctorEditedAt: timestamp("doctor_edited_at", { withTimezone: true }),
    doctorEditedById: integer("doctor_edited_by_id").references(() => doctorsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("pre_consult_questionnaires_patient_unique").on(t.patientId),
    index("pre_consult_questionnaires_doctor_idx").on(t.doctorId),
    check(
      "pre_consult_questionnaires_status_check",
      sql`${t.status} IN ('draft', 'submitted')`,
    ),
  ],
);

export const preConsultInvitesTable = pgTable(
  "pre_consult_invites",
  {
    id: serial("id").primaryKey(),
    questionnaireId: integer("questionnaire_id").notNull(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    doctorId: integer("doctor_id")
      .notNull()
      .references(() => doctorsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Explicit name: the auto-generated one exceeds Postgres' 63-char limit,
    // which made drizzle-kit push drop/re-add this FK on every run.
    foreignKey({
      name: "pre_consult_invites_questionnaire_id_fk",
      columns: [t.questionnaireId],
      foreignColumns: [preConsultQuestionnairesTable.id],
    }).onDelete("cascade"),
    index("pre_consult_invites_patient_idx").on(t.patientId),
    index("pre_consult_invites_questionnaire_idx").on(t.questionnaireId),
    index("pre_consult_invites_expires_at_idx").on(t.expiresAt),
    check(
      "pre_consult_invites_status_check",
      sql`${t.status} IN ('active', 'revoked', 'submitted')`,
    ),
  ],
);

export type PreConsultQuestionnaire = typeof preConsultQuestionnairesTable.$inferSelect;
export type InsertPreConsultQuestionnaire = typeof preConsultQuestionnairesTable.$inferInsert;
export type PreConsultInvite = typeof preConsultInvitesTable.$inferSelect;
export type InsertPreConsultInvite = typeof preConsultInvitesTable.$inferInsert;
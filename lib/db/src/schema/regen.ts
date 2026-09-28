import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  uuid,
  numeric,
  jsonb,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * DocSholder Regenerativa — regen_* schema.
 *
 * These tables were historically created ad-hoc via raw SQL in
 * artifacts/api-server/src/routes/regen.ts (initRegenDb). They are now modelled
 * here so that Drizzle is the single source of truth and `drizzle-kit push`
 * (development) / Publish diff (production) can create and evolve them WITHOUT
 * dropping data. Column names, types, defaults and FKs are reproduced EXACTLY as
 * the raw DDL created them — do not change without a corresponding schema diff.
 *
 * The regen API routes access these tables through raw `pool.query(...)`, so no
 * runtime code imports these table objects; their sole purpose is schema truth.
 */

// ── regen_products ────────────────────────────────────────────────────────────
export const regenProductsTable = pgTable("regen_products", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique("regen_products_code_key"),
  name: text("name").notNull(),
  category: text("category").notNull(),
  mechanism: text("mechanism"),
  contraindications: text("contraindications").array().default([]),
  active: boolean("active").default(true),
});

// ── regen_conditions ──────────────────────────────────────────────────────────
export const regenConditionsTable = pgTable("regen_conditions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique("regen_conditions_code_key"),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").default(true),
});

// ── regen_terms_acceptance ────────────────────────────────────────────────────
export const regenTermsAcceptanceTable = pgTable(
  "regen_terms_acceptance",
  {
    id: serial("id").primaryKey(),
    doctorId: integer("doctor_id").notNull(),
    termsVersion: text("terms_version").notNull(),
    dpaVersion: text("dpa_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("regen_terms_acceptance_doctor_id_terms_version_dpa_version_key").on(
      t.doctorId,
      t.termsVersion,
      t.dpaVersion,
    ),
  ],
);

// ── regen_cases ───────────────────────────────────────────────────────────────
// active_infection / malignancy are intentionally nullable with NO default:
// the ad-hoc DDL dropped their defaults so NULL = "not yet confirmed",
// false = "confirmed absent", true = "present".
export const regenCasesTable = pgTable("regen_cases", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  doctorId: integer("doctor_id").notNull(),
  // Optional soft link. Legacy cases remain clinically useful through their
  // patient snapshot fields even when the original patient row no longer exists.
  patientId: integer("patient_id"),
  patientName: text("patient_name"),
  patientDob: date("patient_dob"),
  patientSex: text("patient_sex"),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  heightCm: numeric("height_cm", { precision: 6, scale: 2 }),
  imc: numeric("imc", { precision: 5, scale: 2 }),
  conditionCode: text("condition_code").notNull(),
  conditionCustom: text("condition_custom"),
  dm: boolean("dm").default(false),
  hba1c: numeric("hba1c", { precision: 5, scale: 2 }),
  anticoagulant: boolean("anticoagulant").default(false),
  immunosuppressed: boolean("immunosuppressed").default(false),
  activeInfection: boolean("active_infection"),
  malignancy: boolean("malignancy"),
  goalVev: text("goal_vev").array().default([]),
  goalCustom: text("goal_custom"),
  complianceFlags: jsonb("compliance_flags").default([]),
  status: text("status").default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  // Incremental ad-hoc columns (added via ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
  priorTreatments: text("prior_treatments").array().default([]),
  patientPhone: text("patient_phone"),
  anamneseRegen: jsonb("anamnese_regen").default({}),
  ladoArticulacao: text("lado_articulacao"),
  hospitalLocal: text("hospital_local"),
  dataCaso: date("data_caso"),
  planoOtimizacao: jsonb("plano_otimizacao").default({}),
  plannedProducts: text("planned_products").array().default([]),
  productDetails: jsonb("product_details").default({}),
  priorTreatDates: jsonb("prior_treat_dates").default({}),
  coMeds: jsonb("co_meds").default([]),
  assocProcedures: text("assoc_procedures").array().default([]),
});

// ── regen_procedures ──────────────────────────────────────────────────────────
export const regenProceduresTable = pgTable("regen_procedures", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: uuid("case_id")
    .notNull()
    .references(() => regenCasesTable.id, { onDelete: "cascade" }),
  doctorId: integer("doctor_id").notNull(),
  productCode: text("product_code").notNull(),
  guidanceMode: text("guidance_mode").notNull().default("ultrassom"),
  volumeMl: numeric("volume_ml", { precision: 6, scale: 2 }),
  concentration: text("concentration"),
  needleGauge: text("needle_gauge"),
  accessRoute: text("access_route"),
  localAnesthesia: boolean("local_anesthesia").default(false),
  anesthesiaAgent: text("anesthesia_agent"),
  lotNumber: text("lot_number"),
  expiryDate: date("expiry_date"),
  adverseEvent: boolean("adverse_event").default(false),
  adverseEventDesc: text("adverse_event_desc"),
  complianceResult: jsonb("compliance_result").default({}),
  notes: text("notes"),
  performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // Incremental ad-hoc column
  biologicDetails: jsonb("biologic_details").default({}),
});

// ── regen_prom_responses ──────────────────────────────────────────────────────
export const regenPromResponsesTable = pgTable("regen_prom_responses", {
  id: serial("id").primaryKey(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => regenCasesTable.id, { onDelete: "cascade" }),
  instrument: text("instrument").notNull(),
  timepoint: text("timepoint").notNull(),
  answers: jsonb("answers").notNull().default({}),
  score: numeric("score", { precision: 6, scale: 2 }),
  answeredAt: timestamp("answered_at", { withTimezone: true }).defaultNow(),
});

// ── regen_lab_results ─────────────────────────────────────────────────────────
export const regenLabResultsTable = pgTable("regen_lab_results", {
  id: serial("id").primaryKey(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => regenCasesTable.id, { onDelete: "cascade" }),
  analyte: text("analyte").notNull(),
  valueNum: numeric("value_num", { precision: 12, scale: 4 }),
  unit: text("unit"),
  refMin: numeric("ref_min", { precision: 12, scale: 4 }),
  refMax: numeric("ref_max", { precision: 12, scale: 4 }),
  flag: text("flag"),
  collectedAt: date("collected_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── regen_ai_interactions ─────────────────────────────────────────────────────
export const regenAiInteractionsTable = pgTable("regen_ai_interactions", {
  id: serial("id").primaryKey(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => regenCasesTable.id, { onDelete: "cascade" }),
  doctorId: integer("doctor_id").notNull(),
  promptHash: text("prompt_hash"),
  model: text("model"),
  rawOutput: jsonb("raw_output"),
  acceptedOutput: jsonb("accepted_output"),
  reviewAction: text("review_action"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── regen_followup_notifications ──────────────────────────────────────────────
export const regenFollowupNotificationsTable = pgTable(
  "regen_followup_notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => regenCasesTable.id, { onDelete: "cascade" }),
    periodo: text("periodo").notNull(),
    daysAfterProcedure: integer("days_after_procedure").notNull(),
    scheduledDate: date("scheduled_date"),
    scales: text("scales").array().notNull().default([]),
    status: text("status").notNull().default("pending"),
    token: uuid("token").unique("regen_followup_notifications_token_key"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
);

// ── regen_scale_responses ─────────────────────────────────────────────────────
export const regenScaleResponsesTable = pgTable(
  "regen_scale_responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => regenFollowupNotificationsTable.id, { onDelete: "cascade" }),
    nomeEscala: text("nome_escala").notNull(),
    respostas: jsonb("respostas").notNull().default({}),
    score: numeric("score", { precision: 10, scale: 2 }),
    completadoEm: timestamp("completado_em", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("regen_scale_responses_notification_id_nome_escala_unique").on(
      t.notificationId,
      t.nomeEscala,
    ),
  ],
);

// ── regen_schema_migrations ───────────────────────────────────────────────────
// Tracks one-off data backfills executed by the regen route. Modelled so it is
// not treated as a stray table by the schema diff.
export const regenSchemaMigrationsTable = pgTable("regen_schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow(),
});

export type RegenProduct = typeof regenProductsTable.$inferSelect;
export type RegenCondition = typeof regenConditionsTable.$inferSelect;
export type RegenTermsAcceptance = typeof regenTermsAcceptanceTable.$inferSelect;
export type RegenCase = typeof regenCasesTable.$inferSelect;
export type RegenProcedure = typeof regenProceduresTable.$inferSelect;
export type RegenPromResponse = typeof regenPromResponsesTable.$inferSelect;
export type RegenLabResult = typeof regenLabResultsTable.$inferSelect;
export type RegenAiInteraction = typeof regenAiInteractionsTable.$inferSelect;
export type RegenFollowupNotification =
  typeof regenFollowupNotificationsTable.$inferSelect;
export type RegenScaleResponse = typeof regenScaleResponsesTable.$inferSelect;
export type RegenSchemaMigration = typeof regenSchemaMigrationsTable.$inferSelect;

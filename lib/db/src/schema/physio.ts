import { pgTable, text, serial, timestamp, boolean, integer, smallint, jsonb, date, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";
import { surgeriesTable } from "./surgeries";

// ── 1. Conta do fisioterapeuta ──────────────────────────────────────────────
export const physiotherapistsTable = pgTable("physiotherapists", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  celular: text("celular").notNull(),
  crefito: text("crefito"),
  cpf: text("cpf"),
  clinica: text("clinica"),
  cidade: text("cidade"),
  plan: text("plan").notNull().default("free"), // free | pro
  subscriptionStatus: text("subscription_status").notNull().default("none"), // none | trialing | active | past_due | canceled
  stripeCustomerId: text("stripe_customer_id"),
  patientsCreatedTotal: integer("patients_created_total").notNull().default(0), // contador LIFETIME (paywall)
  ativo: boolean("ativo").notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── 2. Convite de encaminhamento (token de uso único) ───────────────────────
export const rehabInvitesTable = pgTable("rehab_invites", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256; NUNCA armazenar token puro
  surgeonId: integer("surgeon_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }).notNull(), // LGPD Art. 11
  consentMethod: text("consent_method").notNull(), // verbal_presencial | whatsapp | termo_assinado
  status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedBy: integer("accepted_by").references(() => physiotherapistsTable.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 3. Vínculo ativo de cuidado ──────────────────────────────────────────────
export const careLinksTable = pgTable("care_links", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  surgeonId: integer("surgeon_id").notNull().references(() => doctorsTable.id, { onDelete: "cascade" }),
  physioId: integer("physio_id").notNull().references(() => physiotherapistsTable.id, { onDelete: "cascade" }),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active | revoked_by_surgeon | ended
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("care_links_physio_surgery_unique").on(t.physioId, t.surgeryId),
]);

// ── 4. Catálogo de protocolos (versionado) ──────────────────────────────────
export const rehabProtocolsTable = pgTable("rehab_protocols", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(), // lca_r | lcp_r | menisc_sutura | meniscectomia | atj | osteotomia | mpfl | tend_patelar
  version: smallint("version").notNull().default(1),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(), // fases, follow-ups, critérios
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("rehab_protocols_code_version_unique").on(t.code, t.version),
]);

// ── 5. Pacientes do fisioterapeuta ──────────────────────────────────────────
/**
 * Status gravado quando o médico anonimiza o paciente de origem (LGPD): a linha fica só para estatística
 * (avaliações sem identificação) e nenhuma rota do fisio a lista ou abre.
 */
export const PHYSIO_PATIENT_ANONYMIZED = "anonymized";
export const physioPatientsTable = pgTable("physio_patients", {
  id: serial("id").primaryKey(),
  physioId: integer("physio_id").notNull().references(() => physiotherapistsTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").references(() => patientsTable.id), // NULL se paciente próprio
  careLinkId: integer("care_link_id").references(() => careLinksTable.id), // NULL se paciente próprio
  fullName: text("full_name").notNull(),
  cpf: text("cpf"),
  birthDate: date("birth_date"),
  phone: text("phone"),
  diagnosis: text("diagnosis"), // texto livre quando 'outro'
  diagnosisCode: text("diagnosis_code").notNull().default("outro"), // código do catálogo ou 'outro'
  protocolId: integer("protocol_id").references(() => rehabProtocolsTable.id), // NULL quando 'outro'
  protocolStartDate: date("protocol_start_date"), // data cirurgia OU início tratamento
  protocolCustomized: boolean("protocol_customized").notNull().default(false),
  status: text("status").notNull().default("active"), // active | discharged | abandoned | anonymized
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("physio_patients_physio_care_link_unique").on(t.physioId, t.careLinkId),
]);

// ── 6. Avaliações estruturadas (COMPARTILHADAS via care_link) ───────────────
export const rehabAssessmentsTable = pgTable("rehab_assessments", {
  id: serial("id").primaryKey(),
  careLinkId: integer("care_link_id").references(() => careLinksTable.id), // NULL p/ paciente próprio
  physioPatientId: integer("physio_patient_id").notNull().references(() => physioPatientsTable.id, { onDelete: "cascade" }),
  physioId: integer("physio_id").notNull().references(() => physiotherapistsTable.id, { onDelete: "cascade" }),
  phase: smallint("phase"), // 1–4
  assessmentType: text("assessment_type").notNull(),
  payload: jsonb("payload").notNull(), // dados brutos digitados
  computed: jsonb("computed"), // LSI, scores, flags (backend)
  redFlags: text("red_flags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 7. Prontuário do fisioterapeuta (PRIVADO — nunca acessível ao médico) ───
export const physioDocumentsTable = pgTable("physio_documents", {
  id: serial("id").primaryKey(),
  physioId: integer("physio_id").notNull().references(() => physiotherapistsTable.id, { onDelete: "cascade" }),
  physioPatientId: integer("physio_patient_id").notNull().references(() => physioPatientsTable.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(), // anamnese | evolucao | laudo | atestado | followup_note
  title: text("title"),
  content: jsonb("content").notNull(),
  pdfUrl: text("pdf_url"),
  lockedAt: timestamp("locked_at", { withTimezone: true }), // emitido = imutável
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_physio_docs_patient").on(t.physioPatientId, t.docType, t.createdAt),
]);

// ── 8. Agenda ────────────────────────────────────────────────────────────────
export const physioAppointmentsTable = pgTable("physio_appointments", {
  id: serial("id").primaryKey(),
  physioId: integer("physio_id").notNull().references(() => physiotherapistsTable.id, { onDelete: "cascade" }),
  physioPatientId: integer("physio_patient_id").references(() => physioPatientsTable.id, { onDelete: "cascade" }), // NULL = bloqueio
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  appointmentType: text("appointment_type").notNull().default("sessao"), // sessao | avaliacao | reavaliacao | bloqueio
  status: text("status").notNull().default("scheduled"), // scheduled | done | no_show | canceled
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_physio_agenda").on(t.physioId, t.startsAt),
]);

// ── 9. Follow-ups (motor do dashboard do fisio) ──────────────────────────────
export const physioFollowupsTable = pgTable("physio_followups", {
  id: serial("id").primaryKey(),
  physioId: integer("physio_id").notNull().references(() => physiotherapistsTable.id, { onDelete: "cascade" }),
  physioPatientId: integer("physio_patient_id").notNull().references(() => physioPatientsTable.id, { onDelete: "cascade" }),
  careLinkId: integer("care_link_id").references(() => careLinksTable.id),
  source: text("source").notNull().default("manual"), // protocol | manual
  phase: smallint("phase"), // 1–4 quando source='protocol'
  title: text("title").notNull(),
  requiredAssessments: text("required_assessments").array(),
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("pending"), // pending | done | skipped
  completedAt: timestamp("completed_at", { withTimezone: true }),
  linkedAssessmentIds: integer("linked_assessment_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_followups_dashboard").on(t.physioId, t.status, t.dueDate),
]);

export const insertPhysiotherapistSchema = createInsertSchema(physiotherapistsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPhysiotherapist = z.infer<typeof insertPhysiotherapistSchema>;
export type Physiotherapist = typeof physiotherapistsTable.$inferSelect;
export type RehabInvite = typeof rehabInvitesTable.$inferSelect;
export type CareLink = typeof careLinksTable.$inferSelect;
export type RehabProtocol = typeof rehabProtocolsTable.$inferSelect;
export type PhysioPatient = typeof physioPatientsTable.$inferSelect;
export type RehabAssessment = typeof rehabAssessmentsTable.$inferSelect;
export type PhysioDocument = typeof physioDocumentsTable.$inferSelect;
export type PhysioAppointment = typeof physioAppointmentsTable.$inferSelect;
export type PhysioFollowup = typeof physioFollowupsTable.$inferSelect;

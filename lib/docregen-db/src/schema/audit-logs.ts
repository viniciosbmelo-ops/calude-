import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id"),
  /** Who acted: 'doctor' | 'secretary' | 'patient_link' | 'anonymous'. */
  actorRole: text("actor_role").notNull().default("anonymous"),
  secretaryId: integer("secretary_id"),
  /** SHA-256 of the public link token (pre-consulta / follow-up) — never the token. */
  patientLinkHash: text("patient_link_hash"),
  method: text("method").notNull(),
  endpoint: text("endpoint").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  requestBodyHash: text("request_body_hash"),
  responseStatus: integer("response_status"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_logs_doctor_id_idx").on(t.doctorId),
  index("audit_logs_created_at_idx").on(t.createdAt),
  index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
  index("audit_logs_secretary_id_idx").on(t.secretaryId),
]);

export type AuditLog = typeof auditLogsTable.$inferSelect;

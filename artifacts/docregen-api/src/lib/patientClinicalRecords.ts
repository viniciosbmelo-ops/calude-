import { sql } from "drizzle-orm";
import type { DbTransaction } from "./storageCleanup";

/**
 * Clinical records linked to a patient, by kind. A patient with any of them
 * cannot be hard-deleted: the medical record must be kept for 20 years
 * (Lei 13.787/2018, CFM). Personal data is removed with the anonymization flow
 * (POST /lgpd/anonimizar-paciente/:id) instead.
 *
 * Every table that references a patient is covered:
 *   - regen_cases (soft link) and everything hanging from a case: procedures,
 *     PROMs, lab results, performance tests, follow-up schedule, scale
 *     responses and AI interactions;
 *   - appointments, patient_attachments and pré-consulta questionnaires with
 *     any answer (invites and empty drafts are not clinical data);
 *   - the clinical fields of the patient row itself (anamnesis, reports,
 *     Beighton score).
 * upload_grants (pending, never-consumed uploads) are not records; their
 * objects are queued for deletion with the patient.
 */
export type PatientClinicalRecords = {
  regenCases: number;
  procedures: number;
  proms: number;
  labResults: number;
  performanceTests: number;
  followups: number;
  scaleResponses: number;
  aiInteractions: number;
  appointments: number;
  attachments: number;
  preConsultAnswers: number;
  patientRecordFields: number;
};

export async function patientClinicalRecords(
  tx: DbTransaction,
  patientId: number,
): Promise<PatientClinicalRecords> {
  const { rows: [row] } = await tx.execute<Record<keyof PatientClinicalRecords, number>>(sql`
    WITH cases AS (SELECT id FROM regen_cases WHERE patient_id = ${patientId})
    SELECT
      (SELECT COUNT(*)::int FROM cases) AS "regenCases",
      (SELECT COUNT(*)::int FROM regen_procedures WHERE case_id IN (SELECT id FROM cases)) AS "procedures",
      (SELECT COUNT(*)::int FROM regen_prom_responses WHERE case_id IN (SELECT id FROM cases)) AS "proms",
      (SELECT COUNT(*)::int FROM regen_lab_results WHERE case_id IN (SELECT id FROM cases)) AS "labResults",
      (SELECT COUNT(*)::int FROM regen_performance_tests WHERE case_id IN (SELECT id FROM cases)) AS "performanceTests",
      (SELECT COUNT(*)::int FROM regen_followup_notifications WHERE case_id IN (SELECT id FROM cases)) AS "followups",
      (SELECT COUNT(*)::int FROM regen_scale_responses r
         JOIN regen_followup_notifications n ON n.id = r.notification_id
        WHERE n.case_id IN (SELECT id FROM cases)) AS "scaleResponses",
      (SELECT COUNT(*)::int FROM regen_ai_interactions WHERE case_id IN (SELECT id FROM cases)) AS "aiInteractions",
      (SELECT COUNT(*)::int FROM appointments WHERE patient_id = ${patientId}) AS "appointments",
      (SELECT COUNT(*)::int FROM patient_attachments WHERE patient_id = ${patientId}) AS "attachments",
      (SELECT COUNT(*)::int FROM pre_consult_questionnaires
        WHERE patient_id = ${patientId}
          AND (status = 'submitted'
               OR patient_answers IS NOT NULL
               OR current_answers IS NOT NULL
               OR draft_answers <> '{}'::jsonb)) AS "preConsultAnswers",
      (SELECT (CASE WHEN NULLIF(btrim(anamnese), '') IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN NULLIF(NULLIF(btrim(laudos), ''), '[]') IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN beighton_score IS NOT NULL THEN 1 ELSE 0 END)::int
         FROM patients WHERE id = ${patientId}) AS "patientRecordFields"
  `);
  const records = {} as PatientClinicalRecords;
  for (const [key, value] of Object.entries(row ?? {})) {
    records[key as keyof PatientClinicalRecords] = Number(value ?? 0);
  }
  return records;
}

export function hasClinicalRecords(records: PatientClinicalRecords): boolean {
  return Object.values(records).some((count) => count > 0);
}

/**
 * LGPD patient anonymization (Art. 18, IV / Art. 16).
 *
 * Brazilian law requires the medical record to be kept for 20 years
 * (Lei 13.787/2018; CFM Res. 1.821/2007), so this is NOT a deletion: every
 * direct identifier and identifying free text is removed, while the
 * structured clinical record (condition, procedures, products, scores, labs,
 * performance tests, dates of care) is kept, de-identified, under the same
 * internal record number. Runs in one transaction; stored files are removed
 * through the durable storage-cleanup queue.
 *
 * What is removed / kept is documented in replit.md ("LGPD — anonimização").
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  patientAttachmentsTable,
  patientsTable,
  preConsultInvitesTable,
  preConsultQuestionnairesTable,
  uploadGrantsTable,
  whatsappOutboxTable,
} from "@workspace/docregen-db";
import { enqueueStorageCleanup, type DbTransaction } from "./storageCleanup";

/**
 * Keeps numbers, booleans and short code-like strings (option values such as
 * "trauma", "prp", "knee_oa"); every other string — free text that may carry
 * names, places or other identifying details — is blanked. Recurses into
 * arrays/objects.
 */
export function stripFreeText(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return /^[A-Za-z0-9_.:+\-/]{0,40}$/.test(value) && !/\d{5,}/.test(value) ? value : "";
  }
  if (Array.isArray(value)) return value.map((item) => stripFreeText(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stripFreeText(item, depth + 1)]),
    );
  }
  return null;
}

/** Postgres array literal for a single bound parameter (values are UUIDs/digits only). */
function pgArray(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/["\\]/g, "")}"`).join(",")}}`;
}

function phoneKeys(phone: string | null | undefined): string[] {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return [];
  const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  return [national, `55${national}`];
}

export type AnonymizationResult =
  | { found: false }
  | {
      found: true;
      anonHash: string;
      regenCases: number;
      attachmentsQueuedForDeletion: number;
      followupLinksRevoked: number;
      preConsultInvitesRevoked: number;
      whatsappMessagesRedacted: number;
    };

export const ANONYMIZED_NAME_PREFIX = "PACIENTE ANONIMIZADO";

export async function anonymizePatient(doctorId: number, patientId: number): Promise<AnonymizationResult> {
  return db.transaction(async (tx: DbTransaction) => {
    const [patient] = await tx
      .select()
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.doctorId, doctorId)))
      .for("update");
    if (!patient) return { found: false as const };

    const anonHash = createHash("sha256")
      .update(`${patientId}:${randomBytes(16).toString("hex")}`)
      .digest("hex")
      .slice(0, 10);
    const anonName = `${ANONYMIZED_NAME_PREFIX} #${anonHash}`;

    // Linked regenerative cases (snapshot copies of the patient's identity).
    const cases = await tx.execute<{ id: string; patient_phone: string | null }>(sql`
      SELECT id, patient_phone FROM regen_cases
       WHERE patient_id = ${patientId} AND doctor_id = ${doctorId}
       FOR UPDATE
    `);
    const caseIds = cases.rows.map((row) => row.id);
    const phones = new Set<string>([
      ...phoneKeys(patient.telefone),
      ...cases.rows.flatMap((row) => phoneKeys(row.patient_phone)),
    ]);

    // 1. Patient row: identifiers, contact, address, card and free text.
    await tx.update(patientsTable).set({
      nome: anonName,
      cpf: null,
      email: null,
      telefone: null,
      dataNascimento: null,
      endereco: null,
      cidade: null,
      estado: null,
      cep: null,
      pais: null,
      planoSaude: null,
      numeroCarteirinha: null,
      indicadoPor: null,
      anamnese: null,
      laudos: null,
    }).where(eq(patientsTable.id, patientId));

    let followupLinksRevoked = 0;
    if (caseIds.length) {
      // 2. Case snapshots. Birth date is generalized to the birth year (age
      //    bands for research); free-text anamnesis/plan keep only coded values.
      for (const id of caseIds) {
        const [current] = (await tx.execute<{ anamnese_regen: unknown; plano_otimizacao: unknown }>(
          sql`SELECT anamnese_regen, plano_otimizacao FROM regen_cases WHERE id = ${id}::uuid`,
        )).rows;
        await tx.execute(sql`
          UPDATE regen_cases SET
            patient_name = ${anonName},
            patient_dob = date_trunc('year', patient_dob)::date,
            patient_phone = NULL,
            goal_custom = NULL,
            anamnese_regen = ${JSON.stringify(stripFreeText(current?.anamnese_regen ?? {}))}::jsonb,
            plano_otimizacao = ${JSON.stringify(stripFreeText(current?.plano_otimizacao ?? {}))}::jsonb,
            updated_at = now()
          WHERE id = ${id}::uuid
        `);
      }
      // 3. Free-text procedure notes; structured procedure data is kept.
      await tx.execute(sql`UPDATE regen_procedures SET notes = NULL WHERE case_id = ANY(${pgArray(caseIds)}::uuid[])`);
      // 4. Follow-up links: revoke tokens (the public URL stops working).
      const revoked = await tx.execute(sql`
        UPDATE regen_followup_notifications SET token = NULL, notes = NULL
         WHERE case_id = ANY(${pgArray(caseIds)}::uuid[]) AND (token IS NOT NULL OR notes IS NOT NULL)
      `);
      followupLinksRevoked = revoked.rowCount ?? 0;
      // 5. Free text inside PROM / scale answers; scores are kept.
      const proms = await tx.execute<{ id: number; answers: unknown }>(
        sql`SELECT id, answers FROM regen_prom_responses WHERE case_id = ANY(${pgArray(caseIds)}::uuid[])`,
      );
      for (const row of proms.rows) {
        await tx.execute(sql`UPDATE regen_prom_responses SET answers = ${JSON.stringify(stripFreeText(row.answers ?? {}))}::jsonb WHERE id = ${row.id}`);
      }
      const scales = await tx.execute<{ id: string; respostas: unknown }>(sql`
        SELECT r.id, r.respostas FROM regen_scale_responses r
          JOIN regen_followup_notifications n ON n.id = r.notification_id
         WHERE n.case_id = ANY(${pgArray(caseIds)}::uuid[])
      `);
      for (const row of scales.rows) {
        await tx.execute(sql`UPDATE regen_scale_responses SET respostas = ${JSON.stringify(stripFreeText(row.respostas ?? {}))}::jsonb WHERE id = ${row.id}::uuid`);
      }
      // 6. AI narratives may quote the patient: drop the generated text.
      await tx.execute(sql`
        UPDATE regen_ai_interactions SET raw_output = NULL, accepted_output = NULL, review_note = NULL
         WHERE case_id = ANY(${pgArray(caseIds)}::uuid[])
      `);
    }

    // 7. Pré-consulta: identifying free text removed, coded answers kept; open links revoked.
    const questionnaires = await tx
      .select()
      .from(preConsultQuestionnairesTable)
      .where(eq(preConsultQuestionnairesTable.patientId, patientId));
    for (const questionnaire of questionnaires) {
      await tx.update(preConsultQuestionnairesTable).set({
        draftAnswers: stripFreeText(questionnaire.draftAnswers ?? {}) as Record<string, unknown>,
        patientAnswers: questionnaire.patientAnswers ? stripFreeText(questionnaire.patientAnswers) as Record<string, unknown> : null,
        currentAnswers: questionnaire.currentAnswers ? stripFreeText(questionnaire.currentAnswers) as Record<string, unknown> : null,
      }).where(eq(preConsultQuestionnairesTable.id, questionnaire.id));
    }
    const invites = await tx
      .update(preConsultInvitesTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(preConsultInvitesTable.patientId, patientId), eq(preConsultInvitesTable.status, "active")))
      .returning({ id: preConsultInvitesTable.id });

    // 8. Attachments (exams, photos): files deleted from object storage via
    //    the durable queue, rows removed; pending upload grants too.
    const attachments = await tx
      .select({ id: patientAttachmentsTable.id, objectPath: patientAttachmentsTable.objectPath })
      .from(patientAttachmentsTable)
      .where(and(eq(patientAttachmentsTable.patientId, patientId), eq(patientAttachmentsTable.doctorId, doctorId)));
    const grants = await tx
      .select({ id: uploadGrantsTable.id, objectPath: uploadGrantsTable.objectPath })
      .from(uploadGrantsTable)
      .where(eq(uploadGrantsTable.patientId, patientId));
    const attachmentsQueuedForDeletion = await enqueueStorageCleanup(tx, [
      ...attachments.map((row) => row.objectPath),
      ...grants.map((row) => row.objectPath),
    ]);
    if (attachments.length) {
      await tx.delete(patientAttachmentsTable).where(inArray(patientAttachmentsTable.id, attachments.map((row) => row.id)));
    }
    if (grants.length) {
      await tx.delete(uploadGrantsTable).where(inArray(uploadGrantsTable.id, grants.map((row) => row.id)));
    }

    // 9. Agenda notes may name the patient or the complaint.
    await tx.update(appointmentsTable).set({ observacoes: null })
      .where(and(eq(appointmentsTable.patientId, patientId), eq(appointmentsTable.doctorId, doctorId)));

    // 10. WhatsApp messages queued/sent to the patient's phone: recipient and
    //     text removed; anything not yet sent is cancelled.
    let whatsappMessagesRedacted = 0;
    if (phones.size) {
      const redacted = await tx.execute(sql`
        UPDATE whatsapp_outbox SET
          recipient = 'anonimizado',
          message = '[mensagem removida: paciente anonimizado]',
          status = CASE WHEN status IN ('pending', 'processing') THEN 'failed' ELSE status END,
          last_error = CASE WHEN status IN ('pending', 'processing') THEN 'Cancelada: paciente anonimizado.' ELSE last_error END,
          updated_at = now()
        WHERE (doctor_id = ${doctorId} OR idempotency_key LIKE ${`generic:${doctorId}:%`})
          AND regexp_replace(recipient, '\\D', '', 'g') = ANY(${pgArray([...phones])}::text[])
      `);
      whatsappMessagesRedacted = redacted.rowCount ?? 0;
    }

    return {
      found: true as const,
      anonHash,
      regenCases: caseIds.length,
      attachmentsQueuedForDeletion,
      followupLinksRevoked,
      preConsultInvitesRevoked: invites.length,
      whatsappMessagesRedacted,
    };
  });
}

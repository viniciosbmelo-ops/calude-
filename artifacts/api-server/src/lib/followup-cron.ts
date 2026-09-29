import cron from "node-cron";
import {
  db,
  pool,
  scheduledNotificationsTable,
  followupTable,
  patientsTable,
  surgeriesTable,
  doctorsTable,
  whatsappOutboxTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { buildFollowupMessage } from "./whatsapp";
import { logger } from "./logger";
import { randomUUID } from "crypto";
import { getBaseUrl } from "./base-url";
import {
  filterSupportedFollowupScales,
  hasFractureProcedure,
  isPreoperativePeriod,
} from "./followup-schedule";
import { resolveDoctorLocale } from "./locale";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum delivery attempts before a notification is marked permanently failed. */
const MAX_ATTEMPTS = 3;

/**
 * Exponential backoff delays in minutes per attempt index (0-based).
 * attempt 1 failed → wait 30 min, attempt 2 failed → wait 120 min, etc.
 */
const BACKOFF_MINUTES = [30, 120, 480];

/**
 * How long a processing lease lives before it is considered stale and eligible
 * for recovery (in minutes).  Covers the case where the process crashes while
 * a notification is in 'processing' state with no next_attempt_at set yet.
 */
const LEASE_TIMEOUT_MINUTES = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Atomic claim
//
// Atomically:
//   1. Claims the next eligible notification (FOR UPDATE SKIP LOCKED).
//   2. Increments attempts.
//   3. Sets a processing lease expiry (next_attempt_at = now + LEASE_TIMEOUT)
//      so that a crash leaves the row recoverable.
//   4. Creates/reuses the followup row and token — persisted in the SAME
//      UPDATE so that the token is stable for retries even when the process
//      crashes after WhatsApp accepts but before we can write the response.
//
// Eligibility:
//   - status = 'pending'    AND scheduled_date <= today
//   - status = 'processing' AND next_attempt_at <= now()  (backoff elapsed or lease expired)
// ─────────────────────────────────────────────────────────────────────────────

interface ClaimedNotification {
  id: number;
  surgeryId: number;
  patientId: number;
  periodo: string;
  scales: string[];
  attempts: number;
  followupId: number | null;
  followupToken: string | null;
}

/**
 * Claim the next eligible notification row, returning the minimal fields
 * needed to send the WhatsApp message.  Returns null if no row is eligible.
 *
 * The followup row and token are created (or reused) inside this transaction
 * so they are stable across retries regardless of subsequent crash.
 */
export async function claimNextNotification(): Promise<ClaimedNotification | null> {
  while (true) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();

    const claimResult = await pool.query<{ id: number; surgeryId: number }>(
      `
      UPDATE scheduled_notifications
      SET
        status          = 'processing',
        claimed_at      = now(),
        attempts        = attempts + 1,
        next_attempt_at = now() + ($4 * interval '1 minute')
      WHERE id = (
        SELECT id FROM scheduled_notifications
        WHERE (
              (status = 'pending'    AND scheduled_date <= $1)
           OR (status = 'processing' AND next_attempt_at <= $2 AND attempts < $3)
        )
        ORDER BY scheduled_date ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, surgery_id AS "surgeryId"
      `,
      [today, now, MAX_ATTEMPTS, LEASE_TIMEOUT_MINUTES],
    );

    const claimedRow = claimResult.rows[0];
    if (!claimedRow) return null;

    const prepared = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(87001, CAST(${claimedRow.surgeryId} AS integer))`,
      );

      const rows = await tx
        .select({
          notif: scheduledNotificationsTable,
          patient: patientsTable,
          surgery: surgeriesTable,
        })
        .from(scheduledNotificationsTable)
        .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
        .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
        .where(eq(scheduledNotificationsTable.id, claimedRow.id))
        .for("update")
        .limit(1);

      if (rows.length === 0) {
        logger.warn({ id: claimedRow.id }, "Claimed notification not found in follow-up fetch — skipping");
        return false;
      }

      const { notif, patient, surgery } = rows[0]!;
      if (notif.status !== "processing") return false;

      if (
        hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
        && isPreoperativePeriod(notif.periodo)
      ) {
        await tx
          .update(scheduledNotificationsTable)
          .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
          .where(eq(scheduledNotificationsTable.id, notif.id));
        logger.warn({ notifId: notif.id, surgeryId: notif.surgeryId }, "Preoperative fracture notification disabled");
        return false;
      }

      if (!patient.telefone) {
        logger.warn({ notifId: notif.id, patientId: patient.id }, "Patient has no phone — marking no_phone");
        await tx
          .update(scheduledNotificationsTable)
          .set({ status: "no_phone", lastError: "Patient has no phone number", nextAttemptAt: null, claimedAt: null })
          .where(eq(scheduledNotificationsTable.id, notif.id));
        return false;
      }

      let followupId = notif.followupId ?? null;
      let followupToken: string | null = null;

      if (followupId != null) {
        const [existing] = await tx
          .select({ id: followupTable.id, token: followupTable.token })
          .from(followupTable)
          .where(eq(followupTable.id, followupId))
          .limit(1);
        if (existing) {
          followupToken = existing.token ?? randomUUID();
          if (!existing.token) {
            await tx
              .update(followupTable)
              .set({ token: followupToken })
              .where(eq(followupTable.id, existing.id));
          }
        } else {
          followupId = null;
        }
      }

      if (followupId == null) {
        const token = randomUUID();
        const [newFollowup] = await tx
          .insert(followupTable)
          .values({
            surgeryId: notif.surgeryId,
            tempo: notif.periodo,
            dataAvaliacao: new Date().toISOString().slice(0, 10),
            token,
            escalasEnviadas: filterSupportedFollowupScales(notif.scales),
          })
          .returning({ id: followupTable.id, token: followupTable.token });

        followupId = newFollowup!.id;
        followupToken = newFollowup!.token ?? token;

        await tx
          .update(scheduledNotificationsTable)
          .set({ followupId })
          .where(eq(scheduledNotificationsTable.id, notif.id));
      }

      return {
        id: notif.id,
        surgeryId: notif.surgeryId,
        patientId: notif.patientId,
        periodo: notif.periodo,
        scales: filterSupportedFollowupScales(notif.scales),
        attempts: notif.attempts,
        followupId,
        followupToken,
      } satisfies ClaimedNotification;
    });

    if (prepared) return prepared;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process a single claimed notification
// ─────────────────────────────────────────────────────────────────────────────

async function processClaimedNotification(claimed: ClaimedNotification): Promise<void> {
  const { id: notifId, attempts, followupId, followupToken } = claimed;

  if (!followupToken) {
    // Should not happen — claim always ensures a token.
    throw new Error(`Claimed notification ${notifId} has no followupToken`);
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${claimed.surgeryId} AS integer))`,
    );

    const doctorRows = await tx
      .select({
        notif: scheduledNotificationsTable,
        doctor: doctorsTable,
        surgery: surgeriesTable,
        patient: patientsTable,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
      .where(eq(scheduledNotificationsTable.id, notifId))
      .for("update")
      .limit(1);

    if (doctorRows.length === 0) {
      throw new Error(`Notification ${notifId}: related rows not found`);
    }

    const { notif, doctor, surgery, patient } = doctorRows[0]!;
    if (notif.status !== "processing") return;

    if (
      hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(notif.periodo)
    ) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, notifId));
      return;
    }

    const link = `${getBaseUrl()}/patient/${followupToken}`;
    const text = buildFollowupMessage({
      patientName: patient.nome,
      periodo: claimed.periodo,
      scales: claimed.scales,
      link,
      doctorName: doctor.nome,
      locale: resolveDoctorLocale(doctor.idioma),
    });

    // The durable outbox is written and committed before any provider call.
    // Its worker owns retries and conservative uncertain-delivery handling.
    await tx.insert(whatsappOutboxTable).values({
      eventType: "scheduled_followup",
      scheduledNotificationId: notifId,
      idempotencyKey: `scheduled-notification:${notifId}`,
      recipient: patient.telefone!,
      message: text,
      maxAttempts: MAX_ATTEMPTS,
    }).onConflictDoNothing({ target: whatsappOutboxTable.idempotencyKey });
    await tx.update(scheduledNotificationsTable).set({
      followupId,
      claimedAt: null,
      nextAttemptAt: null,
      status: "processing",
    }).where(eq(scheduledNotificationsTable.id, notifId));
    logger.info({ notifId }, "Follow-up notification queued in durable WhatsApp outbox");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main processing loop
// ─────────────────────────────────────────────────────────────────────────────

export async function processDueNotifications(): Promise<void> {
  let processed = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const claimed = await claimNextNotification();
    if (claimed == null) break;

    try {
      await processClaimedNotification(claimed);
      processed++;
    } catch (err) {
      // No provider call occurred here. Releasing the lease is safe.
      try {
        const isTerminal = claimed.attempts >= MAX_ATTEMPTS;
        const backoffMs = (BACKOFF_MINUTES[claimed.attempts - 1] ?? 30) * 60 * 1000;
        await db
          .update(scheduledNotificationsTable)
          .set({
            status: isTerminal ? "failed" : "processing",
            lastError: "Falha ao preparar envio para a fila de WhatsApp.",
            nextAttemptAt: isTerminal ? null : new Date(Date.now() + backoffMs),
            claimedAt: null,
          })
          .where(and(
            eq(scheduledNotificationsTable.id, claimed.id),
            eq(scheduledNotificationsTable.status, "processing"),
          ));
      } catch (releaseErr) {
        logger.error({ notifId: claimed.id }, "Failed to release notification claim");
      }
      logger.error({ notifId: claimed.id }, "Error preparing notification outbox record");
    }
  }

  if (processed > 0) {
    logger.info({ processed }, "Follow-up notification batch complete");
  }
}

export function startFollowupCron(): void {
  cron.schedule(
    "0 8 * * *",
    () => {
      processDueNotifications().catch(() =>
        logger.error({ error: "Falha ao preparar notificações de follow-up." }, "Cron: followup notification error"),
      );
    },
    { timezone: "America/Sao_Paulo" },
  );
  logger.info("Follow-up cron job started (daily 08:00 BRT)");
}

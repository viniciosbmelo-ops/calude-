/**
 * DocRegen WhatsApp outbox worker.
 *
 * Messages queued by POST /notifications/send-text are delivered here with a
 * lease, bounded retries and a per-attempt audit trail. A result that cannot be
 * confirmed is never retried blindly: it is marked "uncertain" and logged as
 * requiring intervention.
 */
import { db, pool, whatsappDeliveryAuditTable, whatsappOutboxTable } from "@workspace/docregen-db";
import { eq } from "drizzle-orm";
import cron from "node-cron";
import { sendWhatsAppText, sanitizeWhatsAppError } from "../lib/whatsapp";
import { logger } from "../lib/logger";

const MAX_ATTEMPTS = 5;
const PROCESSING_LEASE_MINUTES = 5;
const BACKOFF_MINUTES = [1, 5, 30, 120, 480];

interface ClaimedOutboxMessage {
  id: number;
  recipient: string;
  message: string;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
}

export function classifyOutboxDelivery(
  result: { ok: boolean; messageId?: string; deliveryUncertain?: boolean },
  attempts: number,
  maxAttempts: number,
): "sent" | "pending" | "failed" | "uncertain" {
  // An HTTP success without a provider message ID cannot be reconciled. It
  // may have been accepted and must not be treated as delivered or retried.
  if (result.ok && result.messageId) return "sent";
  if (result.ok) return "uncertain";
  // Neither Evolution nor Meta offers a reliable send-status lookup keyed by
  // our header. An ambiguous transport result is therefore never retried.
  if (result.deliveryUncertain) return "uncertain";
  return attempts >= maxAttempts ? "failed" : "pending";
}

export function expiredDispatchRequiresIntervention(): {
  status: "uncertain";
  interventionRequired: true;
  alternateEscalation: true;
} {
  // A process can die after the provider receives the request and before our
  // write-back. Reclaiming that lease would be a blind duplicate send.
  return { status: "uncertain", interventionRequired: true, alternateEscalation: true };
}

async function recoverExpiredClaims(): Promise<void> {
  const result = await pool.query<{ id: number; attempts: number; eventType: string }>(
    `UPDATE whatsapp_outbox
       SET status = 'uncertain',
           failed_at = now(),
           claimed_at = NULL,
           next_attempt_at = now(),
           last_error = 'Resultado de entrega incerto após interrupção do worker.',
           updated_at = now()
     WHERE status = 'processing'
       AND claimed_at < now() - ($1 * interval '1 minute')
     RETURNING id, attempts, event_type AS "eventType"`,
    [PROCESSING_LEASE_MINUTES],
  );
  for (const row of result.rows) {
    await db.insert(whatsappDeliveryAuditTable).values({
      outboxId: row.id, attempt: row.attempts, outcome: "delivery_uncertain",
      error: "Resultado de entrega incerto após interrupção do worker.",
    }).onConflictDoNothing();
    // DocRegen has no admin console: escalate through the error log so the
    // operator confirms delivery before any manual resend.
    logger.error({ outboxId: row.id, eventType: row.eventType }, "WhatsApp outbox: delivery uncertain after worker interruption; intervention required");
  }
}

export async function claimNextOutboxMessage(): Promise<ClaimedOutboxMessage | null> {
  const result = await pool.query<ClaimedOutboxMessage>(
    `UPDATE whatsapp_outbox
       SET status = 'processing',
           attempts = attempts + 1,
           claimed_at = now(),
           updated_at = now()
     WHERE id = (
       SELECT id
         FROM whatsapp_outbox
        WHERE status = 'pending'
          AND next_attempt_at <= now()
          AND attempts < max_attempts
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING id, recipient, message, idempotency_key AS "idempotencyKey",
               attempts, max_attempts AS "maxAttempts"`,
  );
  return result.rows[0] ?? null;
}

export async function processWhatsAppOutbox(): Promise<void> {
  await recoverExpiredClaims();
  while (true) {
    const alert = await claimNextOutboxMessage();
    if (!alert) return;

    let result;
    try {
      result = await sendWhatsAppText(alert.recipient, alert.message, {
        idempotencyKey: alert.idempotencyKey,
      });
    } catch (error) {
      result = {
        ok: false as const,
        error: sanitizeWhatsAppError(error),
        deliveryUncertain: true,
      };
    }

    const confirmed = result.ok && Boolean(result.messageId);
    const safeError = confirmed
      ? null
      : result.ok
        ? "O provedor aceitou o envio sem confirmar o ID da mensagem."
        : sanitizeWhatsAppError(result.error);
    const status = classifyOutboxDelivery(result, alert.attempts, alert.maxAttempts);
    const uncertain = status === "uncertain";
    const terminal = status === "uncertain" || status === "failed";
    const delay = BACKOFF_MINUTES[Math.min(alert.attempts - 1, BACKOFF_MINUTES.length - 1)]!;
    const nextAttemptAt = new Date(Date.now() + delay * 60_000);

    await db.transaction(async (tx) => {
      const [current] = await tx.select({
        status: whatsappOutboxTable.status,
        eventType: whatsappOutboxTable.eventType,
      })
        .from(whatsappOutboxTable)
        .where(eq(whatsappOutboxTable.id, alert.id))
        .for("update")
        .limit(1);
      if (current?.status !== "processing") return;

      await tx.update(whatsappOutboxTable).set({
        status,
        provider: result.provider ?? null,
        providerMessageId: result.messageId ?? null,
        lastError: safeError,
        nextAttemptAt: result.ok || terminal ? new Date() : nextAttemptAt,
        claimedAt: null,
        sentAt: confirmed ? new Date() : null,
        failedAt: !result.ok && terminal ? new Date() : null,
        interventionRequiredAt: uncertain ? new Date() : null,
        alternateEscalatedAt: uncertain ? new Date() : null,
      }).where(eq(whatsappOutboxTable.id, alert.id));

      await tx.insert(whatsappDeliveryAuditTable).values({
        outboxId: alert.id,
        attempt: alert.attempts,
        outcome: confirmed
          ? "delivered"
          : uncertain
            ? "delivery_uncertain"
            : terminal
              ? "failed_final"
              : "retry_scheduled",
        provider: result.provider,
        providerMessageId: result.messageId,
        error: safeError,
      }).onConflictDoNothing();

    });

    if (confirmed) {
      logger.info({ outboxId: alert.id, attempt: alert.attempts }, "WhatsApp outbox message delivered");
    } else if (terminal) {
      logger.error({ outboxId: alert.id, attempt: alert.attempts, uncertain }, "WhatsApp outbox message delivery ended");
    } else {
      logger.warn({ outboxId: alert.id, attempt: alert.attempts }, "WhatsApp outbox message retry scheduled");
    }
  }
}

export function startWhatsAppOutboxWorker(): void {
  void processWhatsAppOutbox().catch((error) =>
    logger.error({ error: sanitizeWhatsAppError(error) }, "Initial WhatsApp outbox run failed"),
  );
  cron.schedule("* * * * *", () => {
    void processWhatsAppOutbox().catch((error) =>
      logger.error({ error: sanitizeWhatsAppError(error) }, "WhatsApp outbox worker failed"),
    );
  });
}
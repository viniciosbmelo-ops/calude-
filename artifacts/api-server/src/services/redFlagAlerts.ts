import { adminAlertsTable, db, pool, scheduledNotificationsTable, whatsappDeliveryAuditTable, whatsappOutboxTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import cron from "node-cron";
import { sendWhatsAppText, sanitizeWhatsAppError } from "../lib/whatsapp";
import { logger } from "../lib/logger";
import { patientInitials } from "./surgeryProtocolMap";

const MAX_ATTEMPTS = 5;
const PROCESSING_LEASE_MINUTES = 5;
const BACKOFF_MINUTES = [1, 5, 30, 120, 480];

const FLAG_LABELS: Record<string, string> = {
  quadriceps_lsi_below_90: "LSI de quadríceps abaixo de 90% na fase 4",
  hop_lsi_below_90: "Bateria de hop tests abaixo de 90% na fase 4",
  acl_rsi_below_65: "ACL-RSI abaixo de 65 (prontidão psicológica)",
  extension_deficit: "Déficit de extensão do joelho",
  persistent_effusion: "Derrame articular 2+ persistente",
  atj_stiffness_risk: "Flexão <90° na semana 4–6 (risco de rigidez — ATJ)",
  giving_way_episode: "Episódio de falseio relatado",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? "Sinal clínico de atenção";
}

export function buildRedFlagMessage(params: {
  patientName: string;
  physioName: string;
  redFlags: string[];
}): string {
  const initials = patientInitials(params.patientName);
  const lines = params.redFlags.map((flag) => `• ${flagLabel(flag)}`).join("\n");
  return (
    `🚨 DocSholder — Alerta de reabilitação\n\n` +
    `Paciente ${initials} (encaminhado) apresentou sinais de atenção na avaliação ` +
    `do fisioterapeuta ${params.physioName}:\n\n${lines}\n\n` +
    `Acesse o DocSholder para ver os detalhes das avaliações.`
  );
}

interface ClaimedAlert {
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
  const result = await pool.query<{ id: number; attempts: number; eventType: string; scheduledNotificationId: number | null }>(
    `UPDATE whatsapp_outbox
       SET status = 'uncertain',
           failed_at = now(),
           claimed_at = NULL,
           next_attempt_at = now(),
           last_error = 'Resultado de entrega incerto após interrupção do worker.',
           updated_at = now()
     WHERE status = 'processing'
       AND claimed_at < now() - ($1 * interval '1 minute')
     RETURNING id, attempts, event_type AS "eventType", scheduled_notification_id AS "scheduledNotificationId"`,
    [PROCESSING_LEASE_MINUTES],
  );
  for (const row of result.rows) {
    await db.transaction(async (tx) => {
      await tx.insert(whatsappDeliveryAuditTable).values({
        outboxId: row.id, attempt: row.attempts, outcome: "delivery_uncertain",
        error: "Resultado de entrega incerto após interrupção do worker.",
      }).onConflictDoNothing();
      await tx.insert(adminAlertsTable).values({
        severity: "critical",
        title: "Intervenção obrigatória: WhatsApp sem confirmação",
        message: `Outbox #${row.id}: o processo interrompeu após o dispatch. Confirme a entrega antes de reenviar.`,
        source: "whatsapp_outbox",
      });
      if (row.scheduledNotificationId) {
        await tx.update(scheduledNotificationsTable).set({
          status: "uncertain", lastError: "Entrega incerta; intervenção obrigatória.", claimedAt: null, nextAttemptAt: null,
        }).where(eq(scheduledNotificationsTable.id, row.scheduledNotificationId));
      }
    });
  }
}

export async function claimNextRedFlagAlert(): Promise<ClaimedAlert | null> {
  const result = await pool.query<ClaimedAlert>(
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

export async function processRedFlagOutbox(): Promise<void> {
  await recoverExpiredClaims();
  while (true) {
    const alert = await claimNextRedFlagAlert();
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
        scheduledNotificationId: whatsappOutboxTable.scheduledNotificationId,
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

      if (uncertain) {
        // The provider cannot be queried with a reliable idempotency contract.
        // Escalate through the visible admin-alert channel, never blind-retry.
        await tx.insert(adminAlertsTable).values({
          severity: "critical",
          title: "Intervenção obrigatória: entrega WhatsApp incerta",
          message: `Outbox #${alert.id}: confirme o envio ao destinatário antes de qualquer reenvio.`,
          source: "whatsapp_outbox",
        });
      }
      if (current.scheduledNotificationId) {
        await tx.update(scheduledNotificationsTable).set({
          status: confirmed ? "sent" : uncertain ? "uncertain" : terminal ? "failed" : "processing",
          sentAt: confirmed ? new Date() : null,
          whatsappMessageId: result.messageId ?? null,
          lastError: safeError,
          nextAttemptAt: result.ok || terminal ? null : nextAttemptAt,
          claimedAt: null,
        }).where(eq(scheduledNotificationsTable.id, current.scheduledNotificationId));
      }
    });

    if (confirmed) {
      logger.info({ outboxId: alert.id, attempt: alert.attempts }, "Red flag alert delivered");
    } else if (terminal) {
      logger.error({ outboxId: alert.id, attempt: alert.attempts, uncertain }, "Red flag alert delivery ended");
    } else {
      logger.warn({ outboxId: alert.id, attempt: alert.attempts }, "Red flag alert retry scheduled");
    }
  }
}

export function startRedFlagOutboxWorker(): void {
  void processRedFlagOutbox().catch((error) =>
    logger.error({ error: sanitizeWhatsAppError(error) }, "Initial red flag outbox run failed"),
  );
  cron.schedule("* * * * *", () => {
    void processRedFlagOutbox().catch((error) =>
      logger.error({ error: sanitizeWhatsAppError(error) }, "Red flag outbox worker failed"),
    );
  });
}
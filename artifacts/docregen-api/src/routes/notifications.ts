import { Router, type IRouter } from "express";
import { db, whatsappOutboxTable, pool } from "@workspace/docregen-db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { consumeRateLimit, retryAfterSeconds } from "../lib/dbRateLimit";
import { identifierFingerprint } from "../lib/redaction";

const router: IRouter = Router();

/** Longest WhatsApp text the platform number will send on a doctor's behalf. */
export const MAX_WHATSAPP_TEXT_LENGTH = 1000;

export function whatsappSendLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env["DOCREGEN_WHATSAPP_HOURLY_LIMIT"]);
  return Number.isInteger(value) && value > 0 ? value : 60;
}

/** National digits of a Brazilian phone ("+55 (27) 99999-0000" → "27999990000"). */
export function nationalPhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
}

/**
 * The platform WhatsApp number only writes to the doctor's own patients:
 * the recipient must be the phone of one of the doctor's patients or of a
 * patient snapshot on one of the doctor's regenerative cases.
 */
async function isOwnPatientPhone(doctorId: number, phone: string): Promise<boolean> {
  const national = nationalPhoneDigits(phone);
  if (national.length < 10 || national.length > 11) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM (
       SELECT telefone AS phone FROM patients WHERE doctor_id = $1 AND telefone IS NOT NULL
       UNION ALL
       SELECT patient_phone FROM regen_cases WHERE doctor_id = $1 AND patient_phone IS NOT NULL
     ) known
     WHERE (CASE WHEN regexp_replace(phone, '\\D', '', 'g') ~ '^55\\d{10,11}$'
                 THEN substr(regexp_replace(phone, '\\D', '', 'g'), 3)
                 ELSE regexp_replace(phone, '\\D', '', 'g') END) = $2
     LIMIT 1`,
    [doctorId, national],
  );
  return rows.length > 0;
}

// POST /notifications/send-text — server-side WhatsApp send through the
// platform number, restricted to the doctor's own patients.
router.post("/notifications/send-text", requireAuth, async (req, res): Promise<void> => {
  try {
    const locale = await localeForDoctorId(req.doctorId);
    const { phone, text } = req.body ?? {};
    if (typeof phone !== "string" || typeof text !== "string" || !phone.trim() || !text.trim()) {
      res.status(400).json({ error: message(locale, "phoneAndTextRequired") });
      return;
    }
    if (text.length > MAX_WHATSAPP_TEXT_LENGTH) {
      res.status(400).json({ error: `Mensagem muito longa (máximo de ${MAX_WHATSAPP_TEXT_LENGTH} caracteres).`, code: "TEXT_TOO_LONG" });
      return;
    }
    const requestKey = req.get("Idempotency-Key")?.trim();
    if (!requestKey || requestKey.length > 120) {
      res.status(400).json({ error: "Idempotency-Key é obrigatório para este envio." });
      return;
    }
    const doctorId = req.doctorId!;
    if (!(await isOwnPatientPhone(doctorId, phone))) {
      req.log.warn({ doctorId, recipient: identifierFingerprint(nationalPhoneDigits(phone)) }, "WhatsApp send refused: not a patient of this doctor");
      res.status(403).json({ error: "O número informado não pertence a um paciente seu.", code: "RECIPIENT_NOT_ALLOWED" });
      return;
    }
    const idempotencyKey = `generic:${doctorId}:${requestKey}`;
    const [known] = await db.select().from(whatsappOutboxTable)
      .where(eq(whatsappOutboxTable.idempotencyKey, idempotencyKey)).limit(1);
    if (!known) {
      const quota = await consumeRateLimit(`whatsapp:${doctorId}`, whatsappSendLimit(), 60 * 60 * 1000);
      if (!quota.allowed) {
        res.setHeader("Retry-After", String(retryAfterSeconds(quota.resetAt)));
        res.status(429).json({
          error: `Limite de ${quota.limit} mensagens por hora atingido. Tente novamente mais tarde.`,
          code: "WHATSAPP_RATE_LIMIT",
        });
        return;
      }
    }
    const [queued] = known ? [] : await db.insert(whatsappOutboxTable).values({
      eventType: "generic_doctor_message",
      doctorId,
      idempotencyKey,
      recipient: phone,
      message: text,
    }).onConflictDoNothing({ target: whatsappOutboxTable.idempotencyKey }).returning();
    const existing = queued ?? known ?? (await db.select().from(whatsappOutboxTable)
      .where(eq(whatsappOutboxTable.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (!existing || existing.recipient !== phone || existing.message !== text) {
      res.status(409).json({ error: "Chave de envio já utilizada em outra mensagem." });
      return;
    }
    // Send log without the phone number or the text.
    req.log.info({
      doctorId,
      outboxId: existing.id,
      recipient: identifierFingerprint(nationalPhoneDigits(phone)),
      length: text.length,
      duplicate: Boolean(known),
    }, "WhatsApp message queued");
    res.status(202).json({ ok: true, queued: true, id: existing.id, status: existing.status });
  } catch (err) {
    req.log.error({ errName: err instanceof Error ? err.name : "unknown" }, "[POST /notifications/send-text] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

export default router;

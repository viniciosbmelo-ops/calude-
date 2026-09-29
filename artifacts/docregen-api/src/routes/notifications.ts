import { Router, type IRouter } from "express";
import { db, whatsappOutboxTable } from "@workspace/docregen-db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";

const router: IRouter = Router();

// POST /notifications/send-text — generic server-side WhatsApp send (used by regen and other flows)
router.post("/notifications/send-text", requireAuth, async (req, res): Promise<void> => {
  try {
    const locale = await localeForDoctorId(req.doctorId);
    const { phone, text } = req.body ?? {};
    if (!phone || !text) { res.status(400).json({ error: message(locale, "phoneAndTextRequired") }); return; }
    const requestKey = req.get("Idempotency-Key")?.trim();
    if (!requestKey || requestKey.length > 120) {
      res.status(400).json({ error: "Idempotency-Key é obrigatório para este envio." });
      return;
    }
    const idempotencyKey = `generic:${req.doctorId}:${requestKey}`;
    const [queued] = await db.insert(whatsappOutboxTable).values({
      eventType: "generic_doctor_message",
      idempotencyKey,
      recipient: String(phone),
      message: String(text),
    }).onConflictDoNothing({ target: whatsappOutboxTable.idempotencyKey }).returning();
    const existing = queued ?? (await db.select().from(whatsappOutboxTable)
      .where(eq(whatsappOutboxTable.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (!existing || existing.recipient !== String(phone) || existing.message !== String(text)) {
      res.status(409).json({ error: "Chave de envio já utilizada em outra mensagem." });
      return;
    }
    res.status(202).json({ ok: true, queued: true, id: existing.id, status: existing.status });
  } catch (err) {
    console.error("[POST /notifications/send-text] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

export default router;

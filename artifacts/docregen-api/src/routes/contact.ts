/**
 * Contact messages sent from inside DocRegen and the doctor's inbox of replies.
 *
 * DocRegen has no admin console: messages are stored in DocRegen's own
 * database and answered by the operator directly (see replit.md).
 */
import { Router, type IRouter } from "express";
import { db, adminContactMessages } from "@workspace/docregen-db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { verifyToken } from "../lib/auth";
import { getSessionCookie } from "../lib/session";

const router: IRouter = Router();

/**
 * POST /admin/contact
 * Optionally authenticated — doctors can send messages; doctorId is saved if JWT present.
 */
router.post("/admin/contact", async (req, res): Promise<void> => {
  const { nome, email, crm, mensagem } = req.body ?? {};
  if (!mensagem || String(mensagem).trim().length < 5) {
    res.status(400).json({ error: "Mensagem é obrigatória." });
    return;
  }
  // Try to extract doctorId from JWT if present (optional auth)
  let doctorId: number | null = null;
  try {
    const authHeader = req.headers.authorization;
    const token =
      getSessionCookie(req, "doctor") ??
      getSessionCookie(req, "secretary") ??
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
    if (token) {
      const payload = verifyToken(token);
      if (
        payload &&
        (payload.role === "doctor" || payload.role === "secretary") &&
        !payload.isAdmin
      ) {
        doctorId = payload.doctorId;
      }
    }
  } catch {}

  const [msg] = await db.insert(adminContactMessages).values({
    doctorId,
    nome: nome ? String(nome).trim() : null,
    email: email ? String(email).trim() : null,
    crm: crm ? String(crm).trim() : null,
    mensagem: String(mensagem).trim(),
  }).returning();
  res.status(201).json(msg);
});

/**
 * GET /inbox
 * Doctor only — returns their own messages and admin replies.
 */
router.get("/inbox", requireAuth, async (req, res): Promise<void> => {
  if (req.isAdmin) { res.status(403).json({ error: "Admins não possuem inbox de médico." }); return; }
  const msgs = await db
    .select()
    .from(adminContactMessages)
    .where(eq(adminContactMessages.doctorId, req.doctorId!))
    .orderBy(desc(adminContactMessages.createdAt));
  res.json(msgs.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    respondidaEm: m.respondidaEm?.toISOString() ?? null,
  })));
});

/**
 * GET /inbox/unread-count
 * Doctor only — count of messages that have an unread admin reply.
 */
router.get("/inbox/unread-count", requireAuth, async (req, res): Promise<void> => {
  if (req.isAdmin) { res.json({ count: 0 }); return; }
  const msgs = await db
    .select({ id: adminContactMessages.id })
    .from(adminContactMessages)
    .where(
      and(
        eq(adminContactMessages.doctorId, req.doctorId!),
        eq(adminContactMessages.respostaLida, false),
        isNotNull(adminContactMessages.resposta),
      )
    );
  res.json({ count: msgs.length });
});

/**
 * PATCH /inbox/:id/read-reply
 * Doctor only — marks admin reply as read.
 */
router.patch("/inbox/:id/read-reply", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  await db
    .update(adminContactMessages)
    .set({ respostaLida: true })
    .where(and(eq(adminContactMessages.id, id), eq(adminContactMessages.doctorId, req.doctorId!)));
  res.json({ success: true });
});

export default router;

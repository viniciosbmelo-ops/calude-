import { Router, type IRouter } from "express";
import { db, physiotherapistsTable, physioPatientsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { hashPassword, comparePassword, signPhysioToken } from "../lib/auth";
import { requirePhysio, requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { establishSession } from "../lib/session";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";

const router: IRouter = Router();

const RegisterPhysioBody = z.object({
  nome: z.string().min(2),
  celular: z.string().min(8),
  email: z.string().email(),
  senha: z.string().min(6),
  crefito: z.string().min(1),
  cpf: z.string().min(11),
  clinica: z.string().optional(),
  cidade: z.string().optional(),
});

const PhysioLoginBody = z.object({
  email: z.string().email(),
  senha: z.string(),
});

function sanitize(physio: typeof physiotherapistsTable.$inferSelect) {
  const { senhaHash: _, ...data } = physio;
  return {
    ...data,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString(),
  };
}

// ── Auth do fisioterapeuta ──────────────────────────────────────────────────

router.post("/physio-auth/register", async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(undefined);
  const parsed = RegisterPhysioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidPatientData") });
    return;
  }

  const { nome, celular, email, senha, crefito, cpf, clinica, cidade } = parsed.data;

  const [existing] = await db.select({ id: physiotherapistsTable.id })
    .from(physiotherapistsTable)
    .where(sql`lower(${physiotherapistsTable.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);
  if (existing) {
    res.status(409).json({ error: message(locale, "serviceEmailExists") });
    return;
  }

  const senhaHash = await hashPassword(senha);
  const [physio] = await db.insert(physiotherapistsTable).values({
    nome,
    celular,
    email: email.toLowerCase().trim(),
    senhaHash,
    crefito: crefito,
    cpf: cpf,
    clinica: clinica || null,
    cidade: cidade || null,
  }).returning();

  const token = signPhysioToken({
    physioId: physio!.id,
    sessionVersion: physio!.sessionVersion,
  });
  establishSession(res, "physio", token);
  res.status(201).json({ physio: sanitize(physio!) });
});

router.post("/physio-auth/login", async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(undefined);
  const parsed = PhysioLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidPatientData") });
    return;
  }

  const { email, senha } = parsed.data;
  const [physio] = await db.select().from(physiotherapistsTable)
    .where(sql`lower(${physiotherapistsTable.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);

  if (!physio) {
    res.status(401).json({ error: message(locale, "invalidCredentials") });
    return;
  }

  if (!physio.ativo) {
    res.status(403).json({ error: message(locale, "accountBlocked") });
    return;
  }

  const valid = await comparePassword(senha, physio.senhaHash);
  if (!valid) {
    res.status(401).json({ error: message(locale, "invalidCredentials") });
    return;
  }

  const token = signPhysioToken({
    physioId: physio.id,
    sessionVersion: physio.sessionVersion,
  });
  establishSession(res, "physio", token);
  res.json({ physio: sanitize(physio) });
});

router.get("/physio-auth/me", requirePhysio, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(undefined);
  const [physio] = await db.select().from(physiotherapistsTable)
    .where(eq(physiotherapistsTable.id, req.physioId!))
    .limit(1);
  if (!physio) {
    res.status(401).json({ error: message(locale, "unauthenticated") });
    return;
  }
  if (!physio.ativo) {
    res.status(403).json({ error: message(locale, "accountBlocked") });
    return;
  }
  res.json(sanitize(physio));
});

// ── Admin: listagem e gestão de fisioterapeutas ─────────────────────────────

router.get("/admin/physiotherapists", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: physiotherapistsTable.id,
      nome: physiotherapistsTable.nome,
      email: physiotherapistsTable.email,
      celular: physiotherapistsTable.celular,
      crefito: physiotherapistsTable.crefito,
      clinica: physiotherapistsTable.clinica,
      cidade: physiotherapistsTable.cidade,
      plan: physiotherapistsTable.plan,
      subscriptionStatus: physiotherapistsTable.subscriptionStatus,
      patientsCreatedTotal: physiotherapistsTable.patientsCreatedTotal,
      ativo: physiotherapistsTable.ativo,
      createdAt: physiotherapistsTable.createdAt,
      patientsCount: sql<number>`(select count(*)::int from ${physioPatientsTable} pp where pp.physio_id = ${physiotherapistsTable.id})`,
    })
    .from(physiotherapistsTable)
    .orderBy(sql`lower(${physiotherapistsTable.nome}) COLLATE "pt-BR-x-icu"`, physiotherapistsTable.id);

  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.patch("/admin/physiotherapists/:id/block", requireAdmin, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }

  const [physio] = await db.update(physiotherapistsTable)
    .set({
      ativo: false,
      sessionVersion: sql`${physiotherapistsTable.sessionVersion} + 1`,
    })
    .where(eq(physiotherapistsTable.id, id))
    .returning();
  if (!physio) { res.status(404).json({ error: message(locale, "physiotherapistNotFound") }); return; }
  res.json(sanitize(physio));
});

router.patch("/admin/physiotherapists/:id/unblock", requireAdmin, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }

  const [physio] = await db.update(physiotherapistsTable)
    .set({ ativo: true })
    .where(eq(physiotherapistsTable.id, id))
    .returning();
  if (!physio) { res.status(404).json({ error: message(locale, "physiotherapistNotFound") }); return; }
  res.json(sanitize(physio));
});

export default router;

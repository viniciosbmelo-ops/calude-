import { Router, type IRouter } from "express";
import { db, doctorsTable } from "@workspace/docregen-db";
import { eq, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { UpdateDoctorBody } from "@workspace/docregen-api-zod";
import { serializeDoctor } from "../lib/doctorSerializer";

const VALID_UF = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO",
  "MA","MG","MS","MT","PA","PB","PE","PI","PR",
  "RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);
const VALID_LANGUAGES = new Set(["pt-BR", "es"]);

const router: IRouter = Router();

router.get("/doctors/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (req.doctorId !== id && !req.isAdmin) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, id)).limit(1);
  if (!doctor) {
    res.status(404).json({ error: "Médico não encontrado" });
    return;
  }

  const doctorData = serializeDoctor(doctor);
  res.json({ ...doctorData, createdAt: doctorData.createdAt.toISOString() });
});

router.patch("/doctors/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (req.doctorId !== id && !req.isAdmin) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsed = UpdateDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { crmEstado, estado, idioma } = parsed.data;
  if (crmEstado && !VALID_UF.has(crmEstado.toUpperCase())) {
    res.status(400).json({ error: `Estado do CRM inválido: "${crmEstado}". Use a sigla oficial (ex: SP, ES, RJ).` });
    return;
  }
  if (estado && !VALID_UF.has(estado.toUpperCase())) {
    res.status(400).json({ error: `Estado de endereço inválido: "${estado}".` });
    return;
  }
  if (idioma && !VALID_LANGUAGES.has(idioma)) {
    res.status(400).json({ error: "Idioma inválido. Use pt-BR ou es." });
    return;
  }

  const updateData = {
    ...parsed.data,
    ...(crmEstado ? { crmEstado: crmEstado.toUpperCase() } : {}),
    ...(estado ? { estado: estado.toUpperCase() } : {}),
  };

  const [doctor] = await db.update(doctorsTable).set(updateData).where(eq(doctorsTable.id, id)).returning();
  if (!doctor) {
    res.status(404).json({ error: "Médico não encontrado" });
    return;
  }

  const doctorData = serializeDoctor(doctor);
  res.json({ ...doctorData, createdAt: doctorData.createdAt.toISOString() });
});

export default router;

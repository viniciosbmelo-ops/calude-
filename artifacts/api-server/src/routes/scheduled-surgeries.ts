import { Router, type IRouter } from "express";
import { db, scheduledSurgeriesTable, doctorSurgeryConfigTable, patientsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireDoctorOrSecretary } from "../middlewares/requireAuth";
import { z } from "zod/v4";

const router: IRouter = Router();

const CreateBody = z.object({
  patientId: z.number().int().positive(),
  data: z.string(),
  hora: z.string(),
  tipoCirurgia: z.string().min(1),
  hospital: z.string().nullish(),
  planoSaude: z.string().nullish(),
  codigosCbhpm: z.string().nullish(),
  materiais: z.string().nullish(),
  destinatarios: z.string().nullish(),
  status: z.string().default("agendado"),
  observacoes: z.string().nullish(),
});

const UpdateBody = CreateBody.partial().omit({ patientId: true });

const ConfigBody = z.object({
  hospitais: z.string().optional(),
  planosSaude: z.string().optional(),
  materiais: z.string().optional(),
  fornecedores: z.string().optional(),
  destinatarios: z.string().optional(),
});

router.get("/scheduled-surgeries", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: scheduledSurgeriesTable.id,
      patientId: scheduledSurgeriesTable.patientId,
      data: scheduledSurgeriesTable.data,
      hora: scheduledSurgeriesTable.hora,
      tipoCirurgia: scheduledSurgeriesTable.tipoCirurgia,
      hospital: scheduledSurgeriesTable.hospital,
      planoSaude: scheduledSurgeriesTable.planoSaude,
      codigosCbhpm: scheduledSurgeriesTable.codigosCbhpm,
      materiais: scheduledSurgeriesTable.materiais,
      destinatarios: scheduledSurgeriesTable.destinatarios,
      status: scheduledSurgeriesTable.status,
      observacoes: scheduledSurgeriesTable.observacoes,
      createdAt: scheduledSurgeriesTable.createdAt,
      patientNome: patientsTable.nome,
      patientTelefone: patientsTable.telefone,
    })
    .from(scheduledSurgeriesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, scheduledSurgeriesTable.patientId))
    .where(eq(scheduledSurgeriesTable.doctorId, req.doctorId!))
    .orderBy(scheduledSurgeriesTable.data, scheduledSurgeriesTable.hora);
  res.json(rows);
});

router.post("/scheduled-surgeries", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const patient = await db.query.patientsTable.findFirst({
    where: and(eq(patientsTable.id, parsed.data.patientId), eq(patientsTable.doctorId, req.doctorId!)),
  });
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }
  const [created] = await db.insert(scheduledSurgeriesTable).values({
    ...parsed.data,
    doctorId: req.doctorId!,
  }).returning();
  res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

router.patch("/scheduled-surgeries/:id", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db
    .update(scheduledSurgeriesTable)
    .set(parsed.data)
    .where(and(eq(scheduledSurgeriesTable.id, id), eq(scheduledSurgeriesTable.doctorId, req.doctorId!)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Não encontrado" }); return; }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/scheduled-surgeries/:id", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db
    .delete(scheduledSurgeriesTable)
    .where(and(eq(scheduledSurgeriesTable.id, id), eq(scheduledSurgeriesTable.doctorId, req.doctorId!)));
  res.json({ ok: true });
});

router.get("/doctor/surgery-config", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  let cfg = await db.query.doctorSurgeryConfigTable.findFirst({
    where: eq(doctorSurgeryConfigTable.doctorId, req.doctorId!),
  });
  if (!cfg) {
    const [created] = await db.insert(doctorSurgeryConfigTable)
      .values({ doctorId: req.doctorId! })
      .returning();
    cfg = created;
  }
  res.json(cfg);
});

router.patch("/doctor/surgery-config", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const parsed = ConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const existing = await db.query.doctorSurgeryConfigTable.findFirst({
    where: eq(doctorSurgeryConfigTable.doctorId, req.doctorId!),
  });
  let result;
  if (existing) {
    const [updated] = await db.update(doctorSurgeryConfigTable)
      .set(parsed.data)
      .where(eq(doctorSurgeryConfigTable.doctorId, req.doctorId!))
      .returning();
    result = updated;
  } else {
    const [created] = await db.insert(doctorSurgeryConfigTable)
      .values({ doctorId: req.doctorId!, ...parsed.data })
      .returning();
    result = created;
  }
  res.json(result);
});

export default router;

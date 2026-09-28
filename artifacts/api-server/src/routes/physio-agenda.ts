import { Router, type IRouter } from "express";
import {
  db,
  physioAppointmentsTable,
  physioPatientsTable,
} from "@workspace/db";
import { and, eq, ne, lt, gt, gte, lte } from "drizzle-orm";
import { z } from "zod/v4";
import { requirePhysio } from "../middlewares/requireAuth";
import { physioWriteGuard } from "../middlewares/physioPlanGuard";

const router: IRouter = Router();
router.use("/physio", requirePhysio);
router.use("/physio", physioWriteGuard);

const APPOINTMENT_TYPES = ["sessao", "avaliacao", "reavaliacao", "bloqueio"] as const;
const APPOINTMENT_STATUSES = ["scheduled", "done", "no_show", "canceled"] as const;

const CreateAppointmentBody = z.object({
  physioPatientId: z.number().int().positive().nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }).or(z.iso.datetime()),
  endsAt: z.iso.datetime({ offset: true }).or(z.iso.datetime()),
  appointmentType: z.enum(APPOINTMENT_TYPES).default("sessao"),
  notes: z.string().max(2000).optional(),
});

const UpdateAppointmentBody = z.object({
  physioPatientId: z.number().int().positive().nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }).or(z.iso.datetime()).optional(),
  endsAt: z.iso.datetime({ offset: true }).or(z.iso.datetime()).optional(),
  appointmentType: z.enum(APPOINTMENT_TYPES).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function parseId(raw: unknown): number | null {
  const id = parseInt(String(raw ?? ""), 10);
  return Number.isNaN(id) ? null : id;
}

async function hasConflict(physioId: number, startsAt: Date, endsAt: Date, excludeId?: number): Promise<boolean> {
  const conditions = [
    eq(physioAppointmentsTable.physioId, physioId),
    ne(physioAppointmentsTable.status, "canceled"),
    lt(physioAppointmentsTable.startsAt, endsAt),
    gt(physioAppointmentsTable.endsAt, startsAt),
  ];
  if (excludeId !== undefined) conditions.push(ne(physioAppointmentsTable.id, excludeId));
  const [row] = await db.select({ id: physioAppointmentsTable.id })
    .from(physioAppointmentsTable)
    .where(and(...conditions))
    .limit(1);
  return !!row;
}

async function validatePatientOwnership(physioId: number, physioPatientId: number): Promise<boolean> {
  const [p] = await db.select({ id: physioPatientsTable.id }).from(physioPatientsTable)
    .where(and(
      eq(physioPatientsTable.id, physioPatientId),
      eq(physioPatientsTable.physioId, physioId),
    )).limit(1);
  return !!p;
}

// Lista por intervalo: ?from=ISO&to=ISO
router.get("/physio/appointments", async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
    res.status(400).json({ error: "Informe um intervalo válido (from < to) em formato ISO." });
    return;
  }

  const rows = await db.select({
    id: physioAppointmentsTable.id,
    physioPatientId: physioAppointmentsTable.physioPatientId,
    startsAt: physioAppointmentsTable.startsAt,
    endsAt: physioAppointmentsTable.endsAt,
    appointmentType: physioAppointmentsTable.appointmentType,
    status: physioAppointmentsTable.status,
    notes: physioAppointmentsTable.notes,
    patientName: physioPatientsTable.fullName,
  })
    .from(physioAppointmentsTable)
    .leftJoin(physioPatientsTable, eq(physioPatientsTable.id, physioAppointmentsTable.physioPatientId))
    .where(and(
      eq(physioAppointmentsTable.physioId, req.physioId!),
      gte(physioAppointmentsTable.startsAt, from),
      lt(physioAppointmentsTable.startsAt, to),
    ))
    .orderBy(physioAppointmentsTable.startsAt);
  res.json(rows);
});

router.post("/physio/appointments", async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (endsAt <= startsAt) {
    res.status(400).json({ error: "O horário de término deve ser após o início." });
    return;
  }
  if (parsed.data.appointmentType !== "bloqueio" && !parsed.data.physioPatientId) {
    res.status(400).json({ error: "Selecione o paciente do agendamento." });
    return;
  }
  if (parsed.data.physioPatientId && !(await validatePatientOwnership(req.physioId!, parsed.data.physioPatientId))) {
    res.status(404).json({ error: "Paciente não encontrado" });
    return;
  }
  if (await hasConflict(req.physioId!, startsAt, endsAt)) {
    res.status(409).json({ error: "Conflito de horário com outro agendamento." });
    return;
  }

  const [appointment] = await db.insert(physioAppointmentsTable).values({
    physioId: req.physioId!,
    physioPatientId: parsed.data.appointmentType === "bloqueio" ? null : (parsed.data.physioPatientId ?? null),
    startsAt,
    endsAt,
    appointmentType: parsed.data.appointmentType,
    notes: parsed.data.notes ?? null,
  }).returning();
  res.status(201).json(appointment);
});

router.put("/physio/appointments/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const [existing] = await db.select().from(physioAppointmentsTable)
    .where(and(
      eq(physioAppointmentsTable.id, id),
      eq(physioAppointmentsTable.physioId, req.physioId!),
    )).limit(1);
  if (!existing) { res.status(404).json({ error: "Agendamento não encontrado" }); return; }

  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Dados inválidos" }); return; }

  const startsAt = parsed.data.startsAt ? new Date(parsed.data.startsAt) : existing.startsAt;
  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : existing.endsAt;
  if (endsAt <= startsAt) {
    res.status(400).json({ error: "O horário de término deve ser após o início." });
    return;
  }
  const nextType = parsed.data.appointmentType ?? existing.appointmentType;
  const nextPatientId = nextType === "bloqueio"
    ? null
    : (parsed.data.physioPatientId !== undefined ? parsed.data.physioPatientId : existing.physioPatientId);
  if (nextType !== "bloqueio" && !nextPatientId) {
    res.status(400).json({ error: "Selecione o paciente do agendamento." });
    return;
  }
  if (nextPatientId != null && !(await validatePatientOwnership(req.physioId!, nextPatientId))) {
    res.status(404).json({ error: "Paciente não encontrado" });
    return;
  }

  const nextStatus = parsed.data.status ?? existing.status;
  if (nextStatus !== "canceled" && await hasConflict(req.physioId!, startsAt, endsAt, id)) {
    res.status(409).json({ error: "Conflito de horário com outro agendamento." });
    return;
  }

  const updates: Record<string, unknown> = { startsAt, endsAt, appointmentType: nextType, physioPatientId: nextPatientId };
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  const [updated] = await db.update(physioAppointmentsTable)
    .set(updates)
    .where(eq(physioAppointmentsTable.id, id))
    .returning();
  res.json(updated);
});

router.delete("/physio/appointments/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }
  const [existing] = await db.select({ id: physioAppointmentsTable.id }).from(physioAppointmentsTable)
    .where(and(
      eq(physioAppointmentsTable.id, id),
      eq(physioAppointmentsTable.physioId, req.physioId!),
    )).limit(1);
  if (!existing) { res.status(404).json({ error: "Agendamento não encontrado" }); return; }

  await db.delete(physioAppointmentsTable).where(eq(physioAppointmentsTable.id, id));
  res.status(204).end();
});

export default router;

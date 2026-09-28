import { Router, type IRouter } from "express";
import { db, doctorsTable, secretariesTable, appointmentsTable, patientsTable, surgeriesTable, scheduledNotificationsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { hashPassword, comparePassword, signSecretaryToken } from "../lib/auth";
import { requireAuth, requireSecretary, requireDoctorOrSecretary } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { establishSession } from "../lib/session";
import { isHiddenFracturePreoperative } from "../lib/followup-schedule";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";

const router: IRouter = Router();

const CreateSecretaryBody = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6),
});

const UpdateSecretaryBody = z.object({
  nome: z.string().min(2).optional(),
  email: z.string().email().optional(),
  senha: z.string().min(6).optional(),
  ativo: z.boolean().optional(),
});

const SecretaryLoginBody = z.object({
  email: z.string().email(),
  senha: z.string(),
});

function normalizeSecretaryInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const data = input as Record<string, unknown>;
  return {
    ...data,
    ...(typeof data.nome === "string" ? { nome: data.nome.trim() } : {}),
    ...(typeof data.email === "string" ? { email: data.email.trim() } : {}),
  };
}

function secretaryValidationError(
  locale: Awaited<ReturnType<typeof localeForDoctorId>>,
  parsed: { error: { issues: Array<{ path: PropertyKey[] }> } },
): string {
  const field = parsed.error.issues[0]?.path[0];
  if (field === "email") return message(locale, "secretaryInvalidEmail");
  if (field === "senha") return message(locale, "secretaryPasswordTooShort");
  return message(locale, "secretaryRequiredFields");
}

const CreateAppointmentBody = z.object({
  patientId: z.number().int().positive(),
  data: z.string(),
  hora: z.string(),
  tipo: z.string().default("consulta"),
  observacoes: z.string().optional(),
  status: z.string().default("agendado"),
});

const UpdateAppointmentBody = z.object({
  data: z.string().optional(),
  hora: z.string().optional(),
  tipo: z.string().optional(),
  observacoes: z.string().optional(),
  status: z.string().optional(),
});

// ── Secretary Auth ──────────────────────────────────────────────────────────

router.post("/secretary-auth/login", async (req, res): Promise<void> => {
  const parsed = SecretaryLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, senha } = parsed.data;
  const [account] = await db
    .select({
      secretary: secretariesTable,
      doctorApproved: doctorsTable.aprovado,
      doctorLocale: doctorsTable.idioma,
    })
    .from(secretariesTable)
    .innerJoin(doctorsTable, eq(secretariesTable.doctorId, doctorsTable.id))
    .where(sql`lower(${secretariesTable.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);
  const secretary = account?.secretary;

  if (!secretary || !secretary.ativo || !account.doctorApproved) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const valid = await comparePassword(senha, secretary.senhaHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const token = signSecretaryToken({
    secretaryId: secretary.id,
    doctorId: secretary.doctorId,
    sessionVersion: secretary.sessionVersion,
  });
  establishSession(res, "secretary", token);
  const { senhaHash: _, ...data } = secretary;
  res.json({ secretary: { ...data, idioma: account.doctorLocale === "es" ? "es" : "pt-BR" } });
});

router.get("/secretary-auth/me", requireSecretary, async (req, res): Promise<void> => {
  const [account] = await db.select({
    secretary: secretariesTable,
    doctorLocale: doctorsTable.idioma,
  }).from(secretariesTable)
    .innerJoin(doctorsTable, eq(secretariesTable.doctorId, doctorsTable.id))
    .where(eq(secretariesTable.id, req.secretaryId!)).limit(1);
  if (!account?.secretary) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const { senhaHash: _, ...data } = account.secretary;
  res.json({ ...data, idioma: account.doctorLocale === "es" ? "es" : "pt-BR" });
});

// ── Secretaries CRUD (doctor only) ─────────────────────────────────────────

router.get("/secretaries", requireAuth, async (req, res): Promise<void> => {
  const rows = await db.select({
    id: secretariesTable.id,
    doctorId: secretariesTable.doctorId,
    nome: secretariesTable.nome,
    email: secretariesTable.email,
    ativo: secretariesTable.ativo,
    createdAt: secretariesTable.createdAt,
    updatedAt: secretariesTable.updatedAt,
  }).from(secretariesTable)
    .where(eq(secretariesTable.doctorId, req.doctorId!))
    .orderBy(sql`lower(${secretariesTable.nome}) COLLATE "pt-BR-x-icu"`, secretariesTable.id);
  res.json(rows);
});

router.post("/secretaries", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = CreateSecretaryBody.safeParse(normalizeSecretaryInput(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: secretaryValidationError(locale, parsed) });
    return;
  }

  const { nome, email, senha } = parsed.data;

  const [existing] = await db.select({ id: secretariesTable.id })
    .from(secretariesTable).where(sql`lower(${secretariesTable.email}) = ${email.toLowerCase()}`).limit(1);
  if (existing) {
    res.status(409).json({ error: message(locale, "secretaryEmailExists") });
    return;
  }

  const senhaHash = await hashPassword(senha);
  const [secretary] = await db.insert(secretariesTable).values({
    doctorId: req.doctorId!,
    nome,
    email: email.toLowerCase(),
    senhaHash,
    ativo: true,
  }).returning();

  const { senhaHash: _, ...data } = secretary;
  res.status(201).json(data);
});

router.patch("/secretaries/:id", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const id = Number(req.params["id"]);
  const [sec] = await db.select().from(secretariesTable)
    .where(and(eq(secretariesTable.id, id), eq(secretariesTable.doctorId, req.doctorId!))).limit(1);
  if (!sec) {
    res.status(404).json({ error: message(locale, "secretaryNotFound") });
    return;
  }

  const parsed = UpdateSecretaryBody.safeParse(normalizeSecretaryInput(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: secretaryValidationError(locale, parsed) });
    return;
  }

  const updates: Partial<typeof secretariesTable.$inferInsert> = {};
  if (parsed.data.nome) updates.nome = parsed.data.nome;
  if (parsed.data.email) updates.email = parsed.data.email.toLowerCase();
  if (typeof parsed.data.ativo === "boolean") updates.ativo = parsed.data.ativo;
  if (parsed.data.senha) updates.senhaHash = await hashPassword(parsed.data.senha);

  const shouldRevoke =
    parsed.data.senha !== undefined ||
    (typeof parsed.data.ativo === "boolean" && parsed.data.ativo !== sec.ativo);

  const [updated] = await db.update(secretariesTable).set({
    ...updates,
    ...(shouldRevoke
      ? { sessionVersion: sql`${secretariesTable.sessionVersion} + 1` }
      : {}),
  })
    .where(and(
      eq(secretariesTable.id, id),
      eq(secretariesTable.doctorId, req.doctorId!),
    )).returning();
  const { senhaHash: _, ...data } = updated;
  res.json(data);
});

router.delete("/secretaries/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const [sec] = await db.select({ id: secretariesTable.id })
    .from(secretariesTable)
    .where(and(eq(secretariesTable.id, id), eq(secretariesTable.doctorId, req.doctorId!))).limit(1);
  if (!sec) {
    const locale = await localeForDoctorId(req.doctorId);
    res.status(404).json({ error: message(locale, "secretaryNotFound") });
    return;
  }
  await db.delete(secretariesTable).where(eq(secretariesTable.id, id));
  res.json({ success: true });
});

// ── Appointments ────────────────────────────────────────────────────────────

router.get("/appointments", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const rows = await db
    .select({
      id: appointmentsTable.id,
      doctorId: appointmentsTable.doctorId,
      patientId: appointmentsTable.patientId,
      secretaryId: appointmentsTable.secretaryId,
      data: appointmentsTable.data,
      hora: appointmentsTable.hora,
      tipo: appointmentsTable.tipo,
      observacoes: appointmentsTable.observacoes,
      status: appointmentsTable.status,
      createdAt: appointmentsTable.createdAt,
      patientNome: patientsTable.nome,
      patientTelefone: patientsTable.telefone,
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .where(eq(appointmentsTable.doctorId, doctorId))
    .orderBy(appointmentsTable.data, appointmentsTable.hora);
  res.json(rows);
});

router.post("/appointments", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const doctorId = req.doctorId!;
  const [patient] = await db.select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, parsed.data.patientId), eq(patientsTable.doctorId, doctorId))).limit(1);
  if (!patient) {
    res.status(404).json({ error: "Paciente não encontrado" });
    return;
  }

  const [appt] = await db.insert(appointmentsTable).values({
    doctorId,
    patientId: parsed.data.patientId,
    secretaryId: req.secretaryId ?? null,
    data: parsed.data.data,
    hora: parsed.data.hora,
    tipo: parsed.data.tipo,
    observacoes: parsed.data.observacoes ?? null,
    status: parsed.data.status,
  }).returning();

  res.status(201).json(appt);
});

router.patch("/appointments/:id", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const doctorId = req.doctorId!;

  const [appt] = await db.select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.doctorId, doctorId))).limit(1);
  if (!appt) {
    res.status(404).json({ error: "Agendamento não encontrado" });
    return;
  }

  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db.update(appointmentsTable).set(parsed.data)
    .where(eq(appointmentsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/appointments/:id", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const doctorId = req.doctorId!;

  const [appt] = await db.select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.doctorId, doctorId))).limit(1);
  if (!appt) {
    res.status(404).json({ error: "Agendamento não encontrado" });
    return;
  }

  await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id));
  res.json({ success: true });
});

// ── Follow-up Alerts (for secretary) ───────────────────────────────────────

router.get("/secretary/followup-alerts", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;

  const alerts = await db
    .select({
      id: scheduledNotificationsTable.id,
      surgeryId: scheduledNotificationsTable.surgeryId,
      patientId: scheduledNotificationsTable.patientId,
      periodo: scheduledNotificationsTable.periodo,
      scheduledDate: scheduledNotificationsTable.scheduledDate,
      status: scheduledNotificationsTable.status,
      patientNome: patientsTable.nome,
      patientTelefone: patientsTable.telefone,
      tiposProcedimento: surgeriesTable.tiposProcedimento,
    })
    .from(scheduledNotificationsTable)
    .leftJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
    .leftJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
    .where(
      and(
        eq(surgeriesTable.doctorId, doctorId),
        eq(scheduledNotificationsTable.status, "pending")
      )
    )
    .orderBy(scheduledNotificationsTable.scheduledDate);

  res.json(alerts
    .filter((alert) => !isHiddenFracturePreoperative(
      alert.tiposProcedimento as string[] | null,
      alert.periodo,
    ))
    .map(({ tiposProcedimento: _tiposProcedimento, ...alert }) => alert));
});

export default router;

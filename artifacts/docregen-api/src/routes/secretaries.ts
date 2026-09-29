import { Router, type IRouter } from "express";
import { db, doctorsTable, secretariesTable, appointmentsTable, patientsTable } from "@workspace/docregen-db";
import { eq, and, desc, sql } from "drizzle-orm";
import { hashPassword, comparePassword, signSecretaryToken } from "../lib/auth";
import { requireAuth, requireSecretary, requireDoctorOrSecretary } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { establishSession } from "../lib/session";
import { localeForDoctorId } from "../lib/locale";
import { regenPeriodForLocale } from "../lib/regen-labels";
import { message } from "../lib/locale-catalog";
import { clinicToday } from "../lib/regen-followup-schedule";

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

// ── Regenerative cases (read-only summary for the secretary) ──────────────

type RegenCaseSummaryRow = {
  id: string;
  patient_id: number | null;
  patient_nome: string | null;
  patient_telefone: string | null;
  condition_code: string;
  lado_articulacao: string | null;
  status: string | null;
  data_caso: string | null;
  created_at: Date | string | null;
  procedure_count: number;
  last_procedure_at: Date | string | null;
  next_followup_date: string | null;
  next_session_date: string | null;
  next_session_time: string | null;
};

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * GET /secretary/regen-cases — regenerative cases of the doctor the caller
 * belongs to, reduced to what the front desk needs to schedule procedure
 * sessions: patient, condition, status, session counts and the next pending
 * follow-up / scheduled session. No clinical content (anamnesis, PROM scores,
 * labs, products, notes or consent) is exposed, and there is no write access:
 * sessions are scheduled through the regular /appointments endpoints.
 */
router.get("/secretary/regen-cases", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const today = clinicToday();
  const result = await db.execute(sql`
    SELECT
      c.id,
      p.id AS patient_id,
      COALESCE(p.nome, c.patient_name) AS patient_nome,
      COALESCE(p.telefone, c.patient_phone) AS patient_telefone,
      c.condition_code,
      c.lado_articulacao,
      c.status,
      to_char(c.data_caso, 'YYYY-MM-DD') AS data_caso,
      c.created_at,
      (SELECT COUNT(*) FROM regen_procedures pr WHERE pr.case_id = c.id)::int AS procedure_count,
      (SELECT MAX(pr.performed_at) FROM regen_procedures pr WHERE pr.case_id = c.id) AS last_procedure_at,
      (
        SELECT to_char(MIN(n.scheduled_date), 'YYYY-MM-DD')
        FROM regen_followup_notifications n
        WHERE n.case_id = c.id
          AND n.status <> 'completed'
          AND NOT EXISTS (SELECT 1 FROM regen_scale_responses r WHERE r.notification_id = n.id)
      ) AS next_followup_date,
      next_session.data AS next_session_date,
      next_session.hora AS next_session_time
    FROM regen_cases c
    LEFT JOIN patients p ON p.id = c.patient_id AND p.doctor_id = c.doctor_id
    LEFT JOIN LATERAL (
      SELECT a.data, a.hora
      FROM appointments a
      WHERE p.id IS NOT NULL
        AND a.doctor_id = c.doctor_id
        AND a.patient_id = p.id
        AND a.tipo = 'procedimento regenerativo'
        AND a.status <> 'cancelado'
        AND a.data >= ${today}
      ORDER BY a.data, a.hora
      LIMIT 1
    ) next_session ON true
    WHERE c.doctor_id = ${doctorId}
    ORDER BY c.created_at DESC NULLS LAST, c.id
  `);

  res.json((result.rows as RegenCaseSummaryRow[]).map((row) => ({
    id: row.id,
    patientId: row.patient_id === null ? null : Number(row.patient_id),
    patientNome: row.patient_nome,
    patientTelefone: row.patient_telefone,
    conditionCode: row.condition_code,
    ladoArticulacao: row.lado_articulacao,
    status: row.status,
    dataCaso: row.data_caso,
    createdAt: toIso(row.created_at),
    procedureCount: Number(row.procedure_count),
    lastProcedureAt: toIso(row.last_procedure_at),
    nextFollowupDate: row.next_followup_date,
    nextSessionDate: row.next_session_date,
    nextSessionTime: row.next_session_time,
  })));
});

// ── Follow-up Alerts (for secretary) ───────────────────────────────────────

const FOLLOWUP_ALERT_TYPES = new Set(["regen"]);

type RegenAlertRow = {
  id: string;
  case_id: string;
  patient_id: number | null;
  patient_nome: string | null;
  patient_telefone: string | null;
  periodo: string;
  scheduled_date: string | null;
  status: string;
};

/**
 * Regenerative follow-up (PROM) notifications still waiting for the patient:
 * no scale response recorded and not marked completed. Scoped to the
 * authenticated doctor (or the doctor the secretary belongs to). Only
 * scheduling/contact data is returned — never scores or clinical content.
 */
async function listRegenFollowupAlerts(doctorId: number) {
  const locale = await localeForDoctorId(doctorId);
  const today = clinicToday();
  const result = await db.execute(sql`
    SELECT
      n.id,
      n.case_id,
      p.id AS patient_id,
      COALESCE(p.nome, c.patient_name) AS patient_nome,
      COALESCE(p.telefone, c.patient_phone) AS patient_telefone,
      n.periodo,
      to_char(n.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
      n.status
    FROM regen_followup_notifications n
    JOIN regen_cases c ON c.id = n.case_id
    LEFT JOIN patients p ON p.id = c.patient_id AND p.doctor_id = c.doctor_id
    WHERE c.doctor_id = ${doctorId}
      AND n.status <> 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM regen_scale_responses r WHERE r.notification_id = n.id
      )
    ORDER BY n.scheduled_date ASC NULLS LAST, n.id
  `);
  return (result.rows as RegenAlertRow[]).map((row) => ({
    id: row.id,
    caseId: row.case_id,
    patientId: row.patient_id === null ? null : Number(row.patient_id),
    patientNome: row.patient_nome,
    patientTelefone: row.patient_telefone,
    periodo: regenPeriodForLocale(row.periodo, locale),
    scheduledDate: row.scheduled_date,
    status: row.status,
    kind: row.status === "sent"
      ? "awaiting" as const
      : row.scheduled_date && row.scheduled_date <= today
        ? "overdue" as const
        : "scheduled" as const,
  }));
}

router.get("/secretary/followup-alerts", requireDoctorOrSecretary, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const rawType = req.query["type"];
  if (rawType !== undefined && (typeof rawType !== "string" || !FOLLOWUP_ALERT_TYPES.has(rawType))) {
    res.status(400).json({ error: "Tipo de alerta inválido." });
    return;
  }
  // DocRegen only has regenerative follow-ups: `type` may be omitted or
  // "regen" (kept for compatibility with the secretary portal query).
  res.json(await listRegenFollowupAlerts(doctorId));
});

export default router;

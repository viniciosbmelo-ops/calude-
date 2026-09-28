import { Router, type IRouter } from "express";
import { db, servicesTable, doctorServicesTable, doctorLocationsTable, patientsTable, surgeriesTable, followupTable } from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { hashPassword, comparePassword, signServiceToken } from "../lib/auth";
import { requireAdmin, requireAuth, requireService } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { establishSession } from "../lib/session";
import { isHiddenFracturePreoperative } from "../lib/followup-schedule";
import { localeForDoctorId } from "../lib/locale";
import { message, type MessageKey } from "../lib/locale-catalog";

const router: IRouter = Router();
const pt = (key: MessageKey, vars?: Record<string, string | number>) => message("pt-BR", key, vars);
async function doctorTranslator(doctorId: number | undefined) {
  const locale = await localeForDoctorId(doctorId);
  return (key: MessageKey, vars?: Record<string, string | number>) => message(locale, key, vars);
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const CreateServiceBody = z.object({
  nome: z.string().min(2),
  cnpj: z.string().optional(),
  responsavelNome: z.string().min(2),
  responsavelCpf: z.string().min(11),
  responsavelCrm: z.string().min(4),
  email: z.string().email(),
  senha: z.string().min(6),
});

const ServiceLoginBody = z.object({
  email: z.string().email(),
  senha: z.string(),
});

const LinkServiceBody = z.object({
  email: z.string().email(),
  senha: z.string(),
});

// ── Service Auth ─────────────────────────────────────────────────────────────

router.post("/service-auth/login", async (req, res): Promise<void> => {
  const parsed = ServiceLoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: pt("invalidServiceLogin") }); return; }

  const { email, senha } = parsed.data;
  const [service] = await db.select().from(servicesTable)
    .where(sql`lower(${servicesTable.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);

  if (!service || !service.ativo) {
    res.status(401).json({ error: pt("invalidCredentialsOrInactive") });
    return;
  }
  const valid = await comparePassword(senha, service.senhaHash);
  if (!valid) { res.status(401).json({ error: pt("invalidCredentials") }); return; }

  const token = signServiceToken({
    serviceId: service.id,
    sessionVersion: service.sessionVersion,
  });
  establishSession(res, "service", token);
  res.json({ service: { id: service.id, nome: service.nome, email: service.email } });
});

router.get("/service-auth/me", requireService, async (req, res): Promise<void> => {
  const [service] = await db.select({
    id: servicesTable.id,
    nome: servicesTable.nome,
    cnpj: servicesTable.cnpj,
    responsavelNome: servicesTable.responsavelNome,
    responsavelCpf: servicesTable.responsavelCpf,
    responsavelCrm: servicesTable.responsavelCrm,
    email: servicesTable.email,
    ativo: servicesTable.ativo,
    createdAt: servicesTable.createdAt,
  }).from(servicesTable).where(eq(servicesTable.id, req.serviceId!)).limit(1);

  if (!service) { res.status(404).json({ error: pt("serviceNotFound") }); return; }
  res.json(service);
});

router.put("/service-auth/password", requireService, async (req, res): Promise<void> => {
  const { senhaAtual, novaSenha } = req.body as { senhaAtual: string; novaSenha: string };
  if (!senhaAtual || !novaSenha || novaSenha.length < 6) {
    res.status(400).json({ error: pt("newPasswordTooShort") });
    return;
  }
  const [service] = await db.select().from(servicesTable)
    .where(eq(servicesTable.id, req.serviceId!)).limit(1);
  if (!service) { res.status(404).json({ error: pt("serviceNotFound") }); return; }

  const valid = await comparePassword(senhaAtual, service.senhaHash);
  if (!valid) { res.status(401).json({ error: pt("currentPasswordIncorrect") }); return; }

  const senhaHash = await hashPassword(novaSenha);
  const [updatedService] = await db.update(servicesTable)
    .set({
      senhaHash,
      sessionVersion: sql`${servicesTable.sessionVersion} + 1`,
    })
    .where(eq(servicesTable.id, req.serviceId!))
    .returning();
  if (!updatedService) {
    res.status(404).json({ error: pt("serviceNotFound") });
    return;
  }

  establishSession(res, "service", signServiceToken({
    serviceId: updatedService.id,
    sessionVersion: updatedService.sessionVersion,
  }));
  res.json({ ok: true });
});

// ── Admin: gerenciar serviços ────────────────────────────────────────────────

router.post("/admin/services", requireAdmin, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const parsed = CreateServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: t("invalidServiceData") }); return; }

  const { nome, cnpj, responsavelNome, responsavelCpf, responsavelCrm, email, senha } = parsed.data;

  const [existing] = await db.select({ id: servicesTable.id })
    .from(servicesTable)
    .where(sql`lower(${servicesTable.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);
  if (existing) { res.status(409).json({ error: t("serviceEmailExists") }); return; }

  const senhaHash = await hashPassword(senha);
  const [service] = await db.insert(servicesTable).values({
    nome, cnpj, responsavelNome, responsavelCpf, responsavelCrm,
    email: email.toLowerCase().trim(), senhaHash,
  }).returning();

  res.status(201).json({ service });
});

router.get("/admin/services", requireAdmin, async (req, res): Promise<void> => {
  const services = await db.select({
    id: servicesTable.id,
    nome: servicesTable.nome,
    cnpj: servicesTable.cnpj,
    responsavelNome: servicesTable.responsavelNome,
    responsavelCrm: servicesTable.responsavelCrm,
    email: servicesTable.email,
    ativo: servicesTable.ativo,
    createdAt: servicesTable.createdAt,
  }).from(servicesTable).orderBy(sql`lower(${servicesTable.nome}) COLLATE "pt-BR-x-icu"`, servicesTable.id);

  // Count linked doctors for each service
  const counts = await db.select({
    serviceId: doctorServicesTable.serviceId,
    total: sql<number>`count(*)::int`,
  }).from(doctorServicesTable).groupBy(doctorServicesTable.serviceId);
  const countMap = Object.fromEntries(counts.map(c => [c.serviceId, c.total]));

  res.json(services.map(s => ({ ...s, totalMedicos: countMap[s.id] ?? 0 })));
});

router.delete("/admin/services/:id", requireAdmin, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: t("invalidId") }); return; }

  const [deleted] = await db.delete(servicesTable).where(eq(servicesTable.id, id)).returning({ id: servicesTable.id });
  if (!deleted) { res.status(404).json({ error: t("serviceNotFound") }); return; }
  res.json({ ok: true });
});

router.patch("/admin/services/:id", requireAdmin, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: t("invalidId") }); return; }

  const allowed = ["nome", "cnpj", "responsavelNome", "responsavelCpf", "responsavelCrm", "email", "ativo"] as const;
  const updates: Record<string, unknown> = {};
  for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }

  if (req.body.senha) {
    updates["senhaHash"] = await hashPassword(req.body.senha as string);
  }
  if (req.body.ativo !== undefined || req.body.senha) {
    updates["sessionVersion"] = sql`${servicesTable.sessionVersion} + 1`;
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: t("nothingToUpdate") }); return; }
  const [updated] = await db.update(servicesTable).set(updates).where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: t("serviceNotFound") }); return; }
  res.json(updated);
});

// ── Doctor: vincular/desvincular serviços ────────────────────────────────────

router.post("/doctor/services/link", requireAuth, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const parsed = LinkServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: t("invalidServiceLogin") }); return; }

  const { email, senha } = parsed.data;
  const [service] = await db.select().from(servicesTable)
    .where(sql`lower(${servicesTable.email}) = ${email.toLowerCase().trim()}`)
    .limit(1);

  if (!service) {
    res.status(404).json({ error: t("serviceEmailNotFound", { email: email.toLowerCase().trim() }) });
    return;
  }
  if (!service.ativo) {
    res.status(403).json({ error: t("serviceInactive", { service: service.nome }) });
    return;
  }
  const valid = await comparePassword(senha, service.senhaHash);
  if (!valid) { res.status(401).json({ error: t("servicePasswordIncorrect", { service: service.nome }) }); return; }

  try {
    await db.insert(doctorServicesTable).values({
      doctorId: req.doctorId!,
      serviceId: service.id,
    });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "23505") {
      res.status(409).json({ error: t("serviceAlreadyLinked") });
      return;
    }
    throw e;
  }

  res.status(201).json({ service: { id: service.id, nome: service.nome, email: service.email } });
});

router.delete("/doctor/services/:serviceId/unlink", requireAuth, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const serviceId = parseInt(String(req.params.serviceId));
  if (isNaN(serviceId)) { res.status(400).json({ error: t("invalidId") }); return; }

  await db.delete(doctorServicesTable).where(
    and(eq(doctorServicesTable.doctorId, req.doctorId!), eq(doctorServicesTable.serviceId, serviceId))
  );
  res.json({ ok: true });
});

router.get("/doctor/services", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: servicesTable.id,
      nome: servicesTable.nome,
      email: servicesTable.email,
      cnpj: servicesTable.cnpj,
      linkedAt: doctorServicesTable.createdAt,
    })
    .from(doctorServicesTable)
    .innerJoin(servicesTable, eq(doctorServicesTable.serviceId, servicesTable.id))
    .where(and(
      eq(doctorServicesTable.doctorId, req.doctorId!),
      eq(servicesTable.ativo, true),
    ))
    .orderBy(sql`lower(${servicesTable.nome}) COLLATE "pt-BR-x-icu"`, servicesTable.id);
  res.json(rows);
});

// ── Doctor: locais frequentes ────────────────────────────────────────────────

router.get("/doctor/locations", requireAuth, async (req, res): Promise<void> => {
  const locs = await db.select().from(doctorLocationsTable)
    .where(eq(doctorLocationsTable.doctorId, req.doctorId!))
    .orderBy(sql`lower(${doctorLocationsTable.nome}) COLLATE "pt-BR-x-icu"`, doctorLocationsTable.id);
  res.json(locs);
});

router.post("/doctor/locations", requireAuth, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const { nome } = req.body as { nome: string };
  if (!nome?.trim()) { res.status(400).json({ error: t("locationNameRequired") }); return; }

  const [loc] = await db.insert(doctorLocationsTable).values({
    doctorId: req.doctorId!,
    nome: nome.trim(),
  }).returning();
  res.status(201).json(loc);
});

router.delete("/doctor/locations/:id", requireAuth, async (req, res): Promise<void> => {
  const t = await doctorTranslator(req.doctorId);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: t("invalidId") }); return; }

  await db.delete(doctorLocationsTable).where(
    and(eq(doctorLocationsTable.id, id), eq(doctorLocationsTable.doctorId, req.doctorId!))
  );
  res.json({ ok: true });
});

// ── Service Dashboard ────────────────────────────────────────────────────────

async function getLinkedDoctorIds(serviceId: number): Promise<number[]> {
  const links = await db.select({ doctorId: doctorServicesTable.doctorId })
    .from(doctorServicesTable).where(eq(doctorServicesTable.serviceId, serviceId));
  return links.map(l => l.doctorId);
}

router.get("/service/patients", requireService, async (req, res): Promise<void> => {
  const doctorIds = await getLinkedDoctorIds(req.serviceId!);
  if (doctorIds.length === 0) { res.json([]); return; }

  const patients = await db.select().from(patientsTable)
    .where(inArray(patientsTable.doctorId, doctorIds))
    .orderBy(sql`lower(${patientsTable.nome}) COLLATE "pt-BR-x-icu"`, patientsTable.id);
  res.json(patients);
});

router.get("/service/surgeries", requireService, async (req, res): Promise<void> => {
  const doctorIds = await getLinkedDoctorIds(req.serviceId!);
  if (doctorIds.length === 0) { res.json([]); return; }

  const surgeries = await db.select({
    id: surgeriesTable.id,
    dataCirurgia: surgeriesTable.dataCirurgia,
    hospital: surgeriesTable.hospital,
    lado: surgeriesTable.lado,
    tipoCaso: surgeriesTable.tipoCaso,
    diagnostico: surgeriesTable.diagnostico,
    status: surgeriesTable.status,
    doctorId: surgeriesTable.doctorId,
    patientId: surgeriesTable.patientId,
    patientNome: patientsTable.nome,
  })
    .from(surgeriesTable)
    .innerJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .where(inArray(surgeriesTable.doctorId, doctorIds))
    .orderBy(desc(surgeriesTable.dataCirurgia));
  res.json(surgeries);
});

router.get("/service/followups", requireService, async (req, res): Promise<void> => {
  const doctorIds = await getLinkedDoctorIds(req.serviceId!);
  if (doctorIds.length === 0) { res.json([]); return; }

  // followup → surgery → patient; join through surgeriesTable (followup has no patientId column)
  const patientRows = await db.select({ id: patientsTable.id, nome: patientsTable.nome })
    .from(patientsTable).where(inArray(patientsTable.doctorId, doctorIds));
  const patientMap = Object.fromEntries(patientRows.map(p => [p.id, p.nome]));

  const surgeryRows = await db.select({
    id: surgeriesTable.id,
    patientId: surgeriesTable.patientId,
    tiposProcedimento: surgeriesTable.tiposProcedimento,
  })
    .from(surgeriesTable).where(inArray(surgeriesTable.doctorId, doctorIds));
  const surgeryIds = surgeryRows.map(s => s.id);
  const surgeryToPatient = Object.fromEntries(surgeryRows.map(s => [s.id, s.patientId]));
  const surgeryToProcedures = Object.fromEntries(surgeryRows.map(s => [s.id, s.tiposProcedimento]));

  if (surgeryIds.length === 0) { res.json([]); return; }

  const followups = await db.select().from(followupTable)
    .where(inArray(followupTable.surgeryId, surgeryIds))
    .orderBy(desc(followupTable.createdAt));

  res.json(followups
    .filter((followup) => !isHiddenFracturePreoperative(
      surgeryToProcedures[followup.surgeryId] as string[] | null,
      followup.tempo,
    ))
    .map(f => ({
      ...f,
      patientNome: patientMap[surgeryToPatient[f.surgeryId]] ?? "",
    })));
});

router.get("/service/stats", requireService, async (req, res): Promise<void> => {
  const doctorIds = await getLinkedDoctorIds(req.serviceId!);
  if (doctorIds.length === 0) {
    res.json({ totalMedicos: 0, totalPacientes: 0, totalCirurgias: 0, totalFollowups: 0 });
    return;
  }

  const [pCount] = await db.select({ c: sql<number>`count(*)::int` })
    .from(patientsTable).where(inArray(patientsTable.doctorId, doctorIds));
  const [sCount] = await db.select({ c: sql<number>`count(*)::int` })
    .from(surgeriesTable).where(inArray(surgeriesTable.doctorId, doctorIds));

  const surgeryRowsForCount = await db.select({
    id: surgeriesTable.id,
    tiposProcedimento: surgeriesTable.tiposProcedimento,
  })
    .from(surgeriesTable).where(inArray(surgeriesTable.doctorId, doctorIds));
  const surgeryIdsForCount = surgeryRowsForCount.map(s => s.id);
  const surgeryTypesForCount = Object.fromEntries(
    surgeryRowsForCount.map((surgery) => [surgery.id, surgery.tiposProcedimento]),
  );
  const followupsForCount = surgeryIdsForCount.length > 0
    ? await db.select({
        surgeryId: followupTable.surgeryId,
        tempo: followupTable.tempo,
      })
        .from(followupTable)
        .where(inArray(followupTable.surgeryId, surgeryIdsForCount))
    : [];
  const totalFollowups = followupsForCount.filter((followup) => !isHiddenFracturePreoperative(
    surgeryTypesForCount[followup.surgeryId] as string[] | null,
    followup.tempo,
  )).length;

  res.json({
    totalMedicos: doctorIds.length,
    totalPacientes: pCount?.c ?? 0,
    totalCirurgias: sCount?.c ?? 0,
    totalFollowups,
  });
});

export default router;

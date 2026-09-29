import { Router, type IRouter, type Response } from "express";
import { db, followupTable, surgeriesTable, patientsTable, doctorsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateFollowupBody, UpdateFollowupBody } from "@workspace/api-zod";
import crypto from "node:crypto";
import { sendWhatsAppText, buildFollowupMessage } from "../lib/whatsapp";
import { getBaseUrl } from "../lib/base-url";
import { buildRequestAppLink } from "../lib/app-links";
import {
  filterSupportedFollowupScales,
  hasFractureProcedure,
  isPreoperativePeriod,
} from "../lib/followup-schedule";
import { resolveDoctorLocale } from "../lib/locale";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import type { SupportedLocale } from "../lib/locale";
import {
  loadClinicianScales,
  loadPatientScales,
  parseClinicianScales,
  upsertClinicianScales,
  type ClinicianScalesParse,
} from "../lib/clinician-scales";

const router: IRouter = Router();

router.post("/followup", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const parsed = CreateFollowupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: message(locale, "invalidData") });
    return;
  }

  const whereClause = req.isAdmin
    ? eq(surgeriesTable.id, parsed.data.surgeryId)
    : and(eq(surgeriesTable.id, parsed.data.surgeryId), eq(surgeriesTable.doctorId, req.doctorId!));

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${parsed.data.surgeryId} AS integer))`,
    );
    const [surgery] = await tx
      .select()
      .from(surgeriesTable)
      .where(whereClause)
      .for("update")
      .limit(1);

    if (!surgery) return { kind: "missing" as const };
    if (
      hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(parsed.data.tempo)
    ) {
      return { kind: "blocked" as const };
    }

    // Escalas do médico: validadas e pontuadas no servidor ANTES de criar o follow-up.
    const { escalasClinicas, ...followupData } = parsed.data;
    const scales = parseClinicianScales(escalasClinicas, surgery);
    if (scales.kind !== "ok") return { kind: "scales" as const, scales };

    const [followup] = await tx.insert(followupTable).values(followupData).returning();
    await upsertClinicianScales(tx, followup.id, scales.rows);
    return { kind: "created" as const, followup };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: message(locale, "surgeryNotFound") });
    return;
  }
  if (result.kind === "blocked") {
    res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (result.kind === "scales") {
    sendClinicianScaleError(res, locale, result.scales);
    return;
  }

  const { followup } = result;
  const escalasClinicas = (await loadClinicianScales([followup.id])).get(followup.id) ?? [];
  const escalasPaciente = (await loadPatientScales([followup.id])).get(followup.id) ?? [];
  res.status(201).json({ ...followup, createdAt: followup.createdAt.toISOString(), escalasClinicas, escalasPaciente });
});

function sendClinicianScaleError(
  res: Response,
  locale: SupportedLocale,
  scales: Exclude<ClinicianScalesParse, { kind: "ok" }>,
): void {
  if (scales.kind === "not_applicable") {
    res.status(422).json({ error: message(locale, "clinicianScaleNotApplicable", { scale: scales.scale }), scale: scales.scale });
    return;
  }
  res.status(400).json({
    error: message(locale, "clinicianScaleInvalid", { scale: scales.scale, field: scales.field ?? "" }),
    scale: scales.scale,
    field: scales.field ?? null,
  });
}

// PUT /followup/:id/clinician-scales — médico grava/atualiza Constant/Rowe de um follow-up existente
router.put("/followup/:id/clinician-scales", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }
  const body = req.body as { escalasClinicas?: unknown } | undefined;
  if (!body || typeof body.escalasClinicas !== "object" || body.escalasClinicas === null) {
    res.status(400).json({ error: message(locale, "invalidData") });
    return;
  }

  const [pointer] = await db
    .select({ surgeryId: followupTable.surgeryId })
    .from(followupTable)
    .where(eq(followupTable.id, id))
    .limit(1);
  if (!pointer) { res.status(404).json({ error: message(locale, "followupNotFound") }); return; }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
    );
    const ownerFilter = req.isAdmin
      ? eq(followupTable.id, id)
      : and(eq(followupTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!));
    const [row] = await tx
      .select({ followup: followupTable, surgery: surgeriesTable })
      .from(followupTable)
      .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
      .where(ownerFilter)
      .for("update")
      .limit(1);
    if (!row) return { kind: "missing" as const };
    if (
      hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(row.followup.tempo)
    ) {
      return { kind: "blocked" as const };
    }
    const scales = parseClinicianScales(body.escalasClinicas, row.surgery);
    if (scales.kind !== "ok") return { kind: "scales" as const, scales };
    await upsertClinicianScales(tx, id, scales.rows);
    return { kind: "saved" as const };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: message(locale, "followupNotFound") });
    return;
  }
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (outcome.kind === "scales") {
    sendClinicianScaleError(res, locale, outcome.scales);
    return;
  }
  const escalasClinicas = (await loadClinicianScales([id])).get(id) ?? [];
  res.json({ followupId: id, escalasClinicas });
});

router.get("/followup/:surgeryId", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.surgeryId) ? req.params.surgeryId[0] : req.params.surgeryId;
  const surgeryId = parseInt(raw, 10);

  const [surgery] = await db
    .select()
    .from(surgeriesTable)
    .where(and(eq(surgeriesTable.id, surgeryId), eq(surgeriesTable.doctorId, req.doctorId!)))
    .limit(1);

  if (!surgery) {
    res.status(404).json({ error: message(locale, "surgeryNotFound") });
    return;
  }

  const followups = await db
    .select()
    .from(followupTable)
    .where(eq(followupTable.surgeryId, surgeryId))
    .orderBy(followupTable.createdAt);
  const visibleFollowups = hasFractureProcedure(surgery.tiposProcedimento as string[] | null)
    ? followups.filter((followup) => !isPreoperativePeriod(followup.tempo))
    : followups;

  const ids = visibleFollowups.map((f) => f.id);
  const [clinicianScales, patientScales] = await Promise.all([loadClinicianScales(ids), loadPatientScales(ids)]);
  res.json(visibleFollowups.map(f => ({
    ...f,
    createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
    escalasClinicas: clinicianScales.get(f.id) ?? [],
    escalasPaciente: patientScales.get(f.id) ?? [],
  })));
});

router.patch("/followup/:id/update", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }

  const parsed = UpdateFollowupBody.safeParse(req.body);
  // Campos desconhecidos são descartados pelo schema; sem nenhum campo válido
  // não há o que gravar (e um UPDATE vazio quebraria no banco).
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: message(locale, "invalidData") });
    return;
  }

  const [pointer] = await db
    .select({ surgeryId: followupTable.surgeryId })
    .from(followupTable)
    .where(eq(followupTable.id, id))
    .limit(1);
  if (!pointer) {
    res.status(404).json({ error: message(locale, "followupNotFound") });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
    );
    const ownerFilter = req.isAdmin
      ? eq(followupTable.id, id)
      : and(eq(followupTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!));
    const [existing] = await tx
      .select({ followup: followupTable, surgery: surgeriesTable })
      .from(followupTable)
      .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
      .where(ownerFilter)
      .for("update")
      .limit(1);
    if (!existing) return { kind: "missing" as const };

    const updatedPeriod = "tempo" in parsed.data && typeof parsed.data.tempo === "string"
      ? parsed.data.tempo
      : existing.followup.tempo;
    if (
      hasFractureProcedure(existing.surgery.tiposProcedimento as string[] | null)
      && (isPreoperativePeriod(existing.followup.tempo) || isPreoperativePeriod(updatedPeriod))
    ) {
      return { kind: "blocked" as const };
    }

    const [followup] = await tx
      .update(followupTable)
      .set(parsed.data)
      .where(eq(followupTable.id, id))
      .returning();
    return { kind: "updated" as const, followup };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: message(locale, "followupNotFound") });
    return;
  }
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  const { followup } = outcome;
  res.json({ ...followup, createdAt: followup.createdAt.toISOString() });
});

// POST /followup/:id/send-scales — doctor sets which scales to send to patient
router.post("/followup/:id/send-scales", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const requested = (req.body as { escalasEnviadas?: unknown } | undefined)?.escalasEnviadas;
  // Escalas retiradas (ex.: do joelho) são descartadas; se nada suportado sobrar, é como não escolher nenhuma.
  const escalasEnviadas = Array.isArray(requested)
    ? filterSupportedFollowupScales(requested.filter((s): s is string => typeof s === "string"))
    : [];

  if (escalasEnviadas.length === 0) {
    res.status(400).json({ error: message(locale, "selectAtLeastOneScale") });
    return;
  }

  const [pointer] = await db
    .select({ surgeryId: followupTable.surgeryId })
    .from(followupTable)
    .where(eq(followupTable.id, id))
    .limit(1);
  if (!pointer) {
    res.status(404).json({ error: message(locale, "followupNotFound") });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
    );
    const [row] = await tx
      .select({ followup: followupTable, surgery: surgeriesTable })
      .from(followupTable)
      .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
      .where(and(eq(followupTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
      .for("update")
      .limit(1);
    if (!row) return { kind: "missing" as const };
    if (
      hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(row.followup.tempo)
    ) {
      return { kind: "blocked" as const };
    }

    const token = row.followup.token ?? crypto.randomUUID();
    const [followup] = await tx
      .update(followupTable)
      .set({ token, escalasEnviadas })
      .where(eq(followupTable.id, id))
      .returning();
    return { kind: "updated" as const, token, followup };
  });

  if (outcome.kind === "missing") {
    res.status(403).json({ error: message(locale, "accessDenied") });
    return;
  }
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  const { token, followup } = outcome;
  const link = buildRequestAppLink(req, getBaseUrl(req), `/patient/${token}`);
  res.json({ token, link, escalasEnviadas, followup });
});

// POST /followup/:id/prepare-whatsapp — preview message for an existing follow-up
router.post("/followup/:id/prepare-whatsapp", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }

  const [pointer] = await db
    .select({ surgeryId: followupTable.surgeryId })
    .from(followupTable)
    .where(eq(followupTable.id, id))
    .limit(1);
  if (!pointer) { res.status(404).json({ error: message(locale, "followupNotFound") }); return; }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
    );
    const [row] = await tx
      .select({ followup: followupTable, surgery: surgeriesTable, patient: patientsTable, doctor: doctorsTable })
      .from(followupTable)
      .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
      .innerJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
      .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
      .where(and(eq(followupTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
      .for("update")
      .limit(1);
    if (!row) return { kind: "missing" as const };
    if (
      hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(row.followup.tempo)
    ) {
      return { kind: "blocked" as const };
    }

    const token = row.followup.token ?? crypto.randomUUID();
    if (!row.followup.token) {
      await tx.update(followupTable).set({ token }).where(eq(followupTable.id, id));
    }
    const link = buildRequestAppLink(req, getBaseUrl(req), `/patient/${token}`);
    const scales = filterSupportedFollowupScales(row.followup.escalasEnviadas);
    const message = buildFollowupMessage({
      patientName: row.patient.nome,
      periodo: row.followup.tempo,
      scales,
      link,
      doctorName: row.doctor.nome,
      locale: resolveDoctorLocale(row.doctor.idioma),
    });
    return { kind: "prepared" as const, link, message, hasTelefone: !!row.patient.telefone };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: message(locale, "followupNotFound") });
    return;
  }
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }

  res.json({ followupId: id, link: outcome.link, message: outcome.message, hasTelefone: outcome.hasTelefone });
});

// POST /followup/:id/send-whatsapp — send WhatsApp message for an existing follow-up
router.post("/followup/:id/send-whatsapp", requireAuth, async (req, res): Promise<void> => {
  const locale = await localeForDoctorId(req.doctorId);
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }
  const { customMessage } = req.body as { customMessage?: string };

  const [pointer] = await db
    .select({ surgeryId: followupTable.surgeryId })
    .from(followupTable)
    .where(eq(followupTable.id, id))
    .limit(1);
  if (!pointer) { res.status(404).json({ error: message(locale, "followupNotFound") }); return; }

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
    );
    const [row] = await tx
      .select({ followup: followupTable, surgery: surgeriesTable, patient: patientsTable, doctor: doctorsTable })
      .from(followupTable)
      .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
      .innerJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
      .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
      .where(and(eq(followupTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)))
      .for("update")
      .limit(1);
    if (!row) return { kind: "missing" as const };
    if (
      hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(row.followup.tempo)
    ) {
      return { kind: "blocked" as const };
    }
    if (!row.patient.telefone) return { kind: "no_phone" as const };

    const token = row.followup.token ?? crypto.randomUUID();
    if (!row.followup.token) {
      await tx.update(followupTable).set({ token }).where(eq(followupTable.id, id));
    }
    const link = buildRequestAppLink(req, getBaseUrl(req), `/patient/${token}`);
    const scales = filterSupportedFollowupScales(row.followup.escalasEnviadas);
    const text = customMessage ?? buildFollowupMessage({
      patientName: row.patient.nome,
      periodo: row.followup.tempo,
      scales,
      link,
      doctorName: row.doctor.nome,
      locale: resolveDoctorLocale(row.doctor.idioma),
    });
    const result = await sendWhatsAppText(row.patient.telefone, text, {
      idempotencyKey: `manual-followup:${id}`,
    });
    return { kind: "sent" as const, result };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: message(locale, "followupNotFound") });
    return;
  }
  if (outcome.kind === "blocked") {
    res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    return;
  }
  if (outcome.kind === "no_phone") {
    res.status(400).json({ error: message(locale, "patientNoPhone") });
    return;
  }

  const { result } = outcome;
  if (result.ok) {
    res.json({ ok: true, messageId: result.messageId });
  } else {
    res.status(502).json({ ok: false, error: message(locale, "sendFailed") });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { db, scheduledNotificationsTable, patientsTable, surgeriesTable, doctorsTable, followupTable, whatsappOutboxTable } from "@workspace/db";
import { eq, and, lte, lt, inArray, isNotNull, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { buildFollowupMessage } from "../lib/whatsapp";
import { getBaseUrl } from "../lib/base-url";
import { randomUUID } from "crypto";
import { hasFractureProcedure, isPreoperativePeriod } from "../lib/followup-schedule";
import { resolveDoctorLocale } from "../lib/locale";
import { localeForDoctorId } from "../lib/locale";
import { message } from "../lib/locale-catalog";

const router: IRouter = Router();

type DispatchOutcome =
  | { kind: "missing" }
  | { kind: "blocked"; notifId: number; patientNome: string; periodo: string }
  | { kind: "already_sent"; notifId: number; patientNome: string; periodo: string }
  | { kind: "no_phone"; notifId: number; patientNome: string; periodo: string }
  | { kind: "queued"; notifId: number; patientNome: string; periodo: string }
  | { kind: "failed"; notifId: number; patientNome: string; periodo: string; error?: string };

async function dispatchNotification(
  notificationId: number,
  doctorId: number,
  doctorName?: string,
  doctorIdioma?: unknown,
): Promise<DispatchOutcome> {
  const [pointer] = await db
    .select({ surgeryId: scheduledNotificationsTable.surgeryId })
    .from(scheduledNotificationsTable)
    .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
    .where(and(
      eq(scheduledNotificationsTable.id, notificationId),
      eq(surgeriesTable.doctorId, doctorId),
    ))
    .limit(1);
  if (!pointer) return { kind: "missing" };

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
    );
    const [row] = await tx
      .select({
        notif: scheduledNotificationsTable,
        patient: patientsTable,
        surgery: surgeriesTable,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(and(
        eq(scheduledNotificationsTable.id, notificationId),
        eq(surgeriesTable.doctorId, doctorId),
      ))
      .for("update")
      .limit(1);
    if (!row) return { kind: "missing" };

    const identity = {
      notifId: row.notif.id,
      patientNome: row.patient.nome,
      periodo: row.notif.periodo,
    };
    if (
      hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(row.notif.periodo)
    ) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, row.notif.id));
      return { kind: "blocked", ...identity };
    }
    if (row.notif.status === "sent") return { kind: "already_sent", ...identity };
    if (!row.patient.telefone) {
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "failed" })
        .where(eq(scheduledNotificationsTable.id, row.notif.id));
      return { kind: "no_phone", ...identity };
    }

    let [followup] = row.notif.followupId
      ? await tx
          .select()
          .from(followupTable)
          .where(eq(followupTable.id, row.notif.followupId))
          .for("update")
          .limit(1)
      : [];
    if (!followup) {
      [followup] = await tx
        .select()
        .from(followupTable)
        .where(and(
          eq(followupTable.surgeryId, row.notif.surgeryId),
          eq(followupTable.tempo, row.notif.periodo),
        ))
        .for("update")
        .limit(1);
    }

    let token = followup?.token ?? randomUUID();
    if (!followup) {
      [followup] = await tx
        .insert(followupTable)
        .values({
          surgeryId: row.notif.surgeryId,
          tempo: row.notif.periodo,
          dataAvaliacao: new Date().toISOString().slice(0, 10),
          token,
          escalasEnviadas: row.notif.scales ?? [],
        })
        .returning();
    } else if (!followup.token) {
      [followup] = await tx
        .update(followupTable)
        .set({ token })
        .where(eq(followupTable.id, followup.id))
        .returning();
    } else {
      token = followup.token;
    }

    const text = buildFollowupMessage({
      patientName: row.patient.nome,
      periodo: row.notif.periodo,
      scales: row.notif.scales ?? [],
      link: `${getBaseUrl()}/patient/${token}`,
      doctorName,
      locale: resolveDoctorLocale(doctorIdioma),
    });
    await tx.insert(whatsappOutboxTable).values({
      eventType: "scheduled_followup",
      scheduledNotificationId: row.notif.id,
      idempotencyKey: `scheduled-notification:${row.notif.id}`,
      recipient: row.patient.telefone,
      message: text,
      maxAttempts: 3,
    }).onConflictDoNothing({ target: whatsappOutboxTable.idempotencyKey });
    await tx.update(scheduledNotificationsTable).set({
      status: "processing", followupId: followup.id, claimedAt: null, nextAttemptAt: null,
    }).where(eq(scheduledNotificationsTable.id, row.notif.id));
    return { kind: "queued", ...identity };
  });
}

// GET /notifications/pending — all notifications for the doctor (all statuses + upcoming)
router.get("/notifications/pending", requireAuth, async (req, res): Promise<void> => {
  try {
    const doctorId = req.doctorId!;

    // Get all surgeries owned by this doctor
    const surgeries = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.doctorId, doctorId));

    if (surgeries.length === 0) {
      res.json({ pending: [], upcoming: [], sent: [], failed: [] });
      return;
    }

    const surgeryIds = surgeries.map(s => s.id);

    const rows = await db
      .select({
        notif: scheduledNotificationsTable,
        patient: { id: patientsTable.id, nome: patientsTable.nome, telefone: patientsTable.telefone },
        surgery: {
          id: surgeriesTable.id,
          dataCirurgia: surgeriesTable.dataCirurgia,
          diagnostico: surgeriesTable.diagnostico,
          tiposProcedimento: surgeriesTable.tiposProcedimento,
        },
      })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(inArray(scheduledNotificationsTable.surgeryId, surgeryIds))
      .orderBy(scheduledNotificationsTable.scheduledDate);

    const today = new Date().toISOString().slice(0, 10);

    const pending:   typeof rows = [];
    const upcoming:  typeof rows = [];
    const sent:      typeof rows = [];
    const failed:    typeof rows = [];

    for (const row of rows) {
      if (
        hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
        && isPreoperativePeriod(row.notif.periodo)
      ) {
        continue;
      }
      const { status, scheduledDate } = row.notif;
      if (status === "sent") {
        sent.push(row);
      } else if (status === "failed") {
        failed.push(row);
      } else if (scheduledDate && scheduledDate <= today) {
        pending.push(row);
      } else {
        upcoming.push(row);
      }
    }

    res.json({ pending, upcoming, sent, failed });
  } catch (err) {
    console.error("[GET /notifications/pending] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

// POST /notifications/dispatch-pending — dispatch all due notifications for the doctor
// Optional body: { surgeryId: number } — filter to a specific surgery only
router.post("/notifications/dispatch-pending", requireAuth, async (req, res): Promise<void> => {
  try {
    const doctorId = req.doctorId!;
    const locale = await localeForDoctorId(doctorId);
    const today = new Date().toISOString().slice(0, 10);
    const filterSurgeryId: number | undefined = req.body?.surgeryId ? Number(req.body.surgeryId) : undefined;

    const [doctor] = await db
      .select()
      .from(doctorsTable)
      .where(eq(doctorsTable.id, doctorId))
      .limit(1);

    const surgeries = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.doctorId, doctorId));

    if (surgeries.length === 0) {
      res.json({ sent: 0, failed: 0, skipped: 0, details: [] });
      return;
    }

    const surgeryIds = surgeries.map(s => s.id);
    if (filterSurgeryId && !surgeryIds.includes(filterSurgeryId)) {
      res.status(403).json({ error: message(locale, "accessDenied") });
      return;
    }
    // If filtering by a specific surgery, ensure it belongs to this doctor
    const effectiveSurgeryIds = filterSurgeryId
      ? [filterSurgeryId]
      : surgeryIds;

    const due = await db
      .select({
        notif: scheduledNotificationsTable,
        patient: patientsTable,
        surgery: surgeriesTable,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(
        and(
          eq(scheduledNotificationsTable.status, "pending"),
          lte(scheduledNotificationsTable.scheduledDate, today),
          inArray(scheduledNotificationsTable.surgeryId, effectiveSurgeryIds)
        )
      );

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const details: Array<{ notifId: number; patientNome: string; periodo: string; result: string; reason?: string }> = [];

    for (const { notif, patient } of due) {
      const outcome = await dispatchNotification(notif.id, doctorId, doctor?.nome, doctor?.idioma);
      const identity = outcome.kind === "missing"
        ? { notifId: notif.id, patientNome: patient.nome, periodo: notif.periodo }
        : outcome;
      if (outcome.kind === "queued") {
        sent++;
        details.push({ ...identity, result: "queued" });
      } else if (outcome.kind === "failed") {
        failed++;
        details.push({ ...identity, result: "failed", reason: outcome.error });
      } else {
        skipped++;
        const reason = outcome.kind === "blocked"
          ? message(locale, "fracturePreoperativeFollowupUnavailable")
          : outcome.kind === "no_phone"
            ? "sem telefone"
            : outcome.kind === "already_sent"
              ? "já enviado"
              : "notificação indisponível";
        details.push({ ...identity, result: "skipped", reason });
      }
    }

    res.json({ sent, failed, skipped, total: due.length, details });
  } catch (err) {
    console.error("[POST /notifications/dispatch-pending] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

// POST /notifications/:id/dispatch — send one specific notification via Evolution/Meta
router.post("/notifications/:id/dispatch", requireAuth, async (req, res): Promise<void> => {
  try {
    const doctorId = req.doctorId!;
    const locale = await localeForDoctorId(doctorId);
    const notifId = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(notifId)) { res.status(400).json({ error: message(locale, "invalidId") }); return; }

    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId)).limit(1);
    const outcome = await dispatchNotification(notifId, doctorId, doctor?.nome, doctor?.idioma);
    if (outcome.kind === "missing") {
      res.status(403).json({ error: message(locale, "accessDenied") });
    } else if (outcome.kind === "blocked") {
      res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    } else if (outcome.kind === "already_sent") {
      res.status(409).json({ error: message(locale, "alreadySent") });
    } else if (outcome.kind === "no_phone") {
      res.status(400).json({ error: message(locale, "patientNoPhone") });
    } else if (outcome.kind === "queued") {
      res.status(202).json({ ok: true, queued: true });
    } else {
      res.status(502).json({ error: message(locale, "sendFailed") });
    }
  } catch (err) {
    console.error("[POST /notifications/:id/dispatch] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

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

// POST /notifications/:id/reset — reset a failed notification back to pending
router.post("/notifications/:id/reset", requireAuth, async (req, res): Promise<void> => {
  try {
    const locale = await localeForDoctorId(req.doctorId);
    const notifId = parseInt(String(req.params.id ?? ""), 10);

    const [pointer] = await db
      .select({ surgeryId: scheduledNotificationsTable.surgeryId })
      .from(scheduledNotificationsTable)
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(and(
        eq(scheduledNotificationsTable.id, notifId),
        eq(surgeriesTable.doctorId, req.doctorId!),
      ))
      .limit(1);

    if (!pointer) {
      res.status(403).json({ error: message(locale, "accessDenied") });
      return;
    }

    const reset = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(87001, CAST(${pointer.surgeryId} AS integer))`,
      );
      const [row] = await tx
        .select({ notif: scheduledNotificationsTable, surgery: surgeriesTable })
        .from(scheduledNotificationsTable)
        .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
        .where(and(
          eq(scheduledNotificationsTable.id, notifId),
          eq(surgeriesTable.doctorId, req.doctorId!),
        ))
        .for("update")
        .limit(1);
      if (!row) return "missing" as const;
      if (
        hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
        && isPreoperativePeriod(row.notif.periodo)
      ) {
        await tx
          .update(scheduledNotificationsTable)
          .set({ status: "skipped", nextAttemptAt: null, claimedAt: null })
          .where(eq(scheduledNotificationsTable.id, notifId));
        return "blocked" as const;
      }
      await tx
        .update(scheduledNotificationsTable)
        .set({ status: "pending", nextAttemptAt: null, claimedAt: null })
        .where(eq(scheduledNotificationsTable.id, notifId));
      return "reset" as const;
    });

    if (reset === "missing") {
      res.status(403).json({ error: message(locale, "accessDenied") });
    } else if (reset === "blocked") {
      res.status(409).json({ error: message(locale, "fracturePreoperativeFollowupUnavailable") });
    } else {
      res.json({ ok: true });
    }
  } catch (err) {
    console.error("[POST /notifications/:id/reset] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

// GET /notifications/overdue-followups — patients with "sent" notifications > 7 days without response
router.get("/notifications/overdue-followups", requireAuth, async (req, res): Promise<void> => {
  try {
    const doctorId = req.doctorId!;

    const surgeries = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.doctorId, doctorId));

    if (surgeries.length === 0) { res.json([]); return; }

    const surgeryIds = surgeries.map(s => s.id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        notifId: scheduledNotificationsTable.id,
        periodo: scheduledNotificationsTable.periodo,
        sentAt: scheduledNotificationsTable.sentAt,
        surgeryId: scheduledNotificationsTable.surgeryId,
        patientId: patientsTable.id,
        patientName: patientsTable.nome,
        patientPhone: patientsTable.telefone,
        tiposProcedimento: surgeriesTable.tiposProcedimento,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(
        and(
          eq(scheduledNotificationsTable.status, "sent"),
          isNotNull(scheduledNotificationsTable.sentAt),
          lt(scheduledNotificationsTable.sentAt, sevenDaysAgo),
          inArray(scheduledNotificationsTable.surgeryId, surgeryIds)
        )
      )
      .orderBy(scheduledNotificationsTable.sentAt);

    res.json(rows
      .filter((row) => !(
        hasFractureProcedure(row.tiposProcedimento as string[] | null)
        && isPreoperativePeriod(row.periodo)
      ))
      .map(({ tiposProcedimento: _tiposProcedimento, ...row }) => row));
  } catch (err) {
    console.error("[GET /notifications/overdue-followups] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

// GET /notifications/followup-overview — dashboard summary: vencidos, agendados, respondidos, aguardando
router.get("/notifications/followup-overview", requireAuth, async (req, res): Promise<void> => {
  try {
    const doctorId = req.doctorId!;

    const surgeries = await db
      .select({ id: surgeriesTable.id })
      .from(surgeriesTable)
      .where(eq(surgeriesTable.doctorId, doctorId));

    if (surgeries.length === 0) {
      res.json({ vencidos: [], agendados: [], respondidos: [], aguardando: [], counts: { vencidos: 0, agendados: 0, respondidos: 0, aguardando: 0 } });
      return;
    }

    const surgeryIds = surgeries.map(s => s.id);
    const today = new Date().toISOString().slice(0, 10);

    const rows = await db
      .select({
        notifId: scheduledNotificationsTable.id,
        status: scheduledNotificationsTable.status,
        periodo: scheduledNotificationsTable.periodo,
        scheduledDate: scheduledNotificationsTable.scheduledDate,
        sentAt: scheduledNotificationsTable.sentAt,
        followupId: scheduledNotificationsTable.followupId,
        surgeryId: scheduledNotificationsTable.surgeryId,
        scales: scheduledNotificationsTable.scales,
        patientNome: patientsTable.nome,
        patientId: patientsTable.id,
        patientTelefone: patientsTable.telefone,
        dataCirurgia: surgeriesTable.dataCirurgia,
        tiposProcedimento: surgeriesTable.tiposProcedimento,
      })
      .from(scheduledNotificationsTable)
      .innerJoin(patientsTable, eq(scheduledNotificationsTable.patientId, patientsTable.id))
      .innerJoin(surgeriesTable, eq(scheduledNotificationsTable.surgeryId, surgeriesTable.id))
      .where(inArray(scheduledNotificationsTable.surgeryId, surgeryIds))
      .orderBy(scheduledNotificationsTable.scheduledDate);

    type Row = {
      notifId: number; status: string; periodo: string;
      scheduledDate: string | null; sentAt: Date | null; followupId: number | null;
      surgeryId: number; scales: string[]; patientNome: string; patientId: number;
      patientTelefone: string | null; dataCirurgia: string | null;
      tiposProcedimento: string[] | null;
    };

    type PublicRow = Omit<Row, "tiposProcedimento">;
    const vencidos: PublicRow[] = [];
    const agendados: PublicRow[] = [];
    const respondidos: PublicRow[] = [];
    const aguardando: PublicRow[] = [];

    for (const row of rows) {
      if (
        hasFractureProcedure(row.tiposProcedimento as string[] | null)
        && isPreoperativePeriod(row.periodo)
      ) {
        continue;
      }
      const { tiposProcedimento: _tiposProcedimento, ...publicRow } = row;
      if (publicRow.followupId !== null) {
        respondidos.push(publicRow);
      } else if (publicRow.status === "sent") {
        aguardando.push(publicRow);
      } else if (publicRow.scheduledDate && publicRow.scheduledDate <= today) {
        vencidos.push(publicRow);
      } else {
        agendados.push(publicRow);
      }
    }

    res.json({
      vencidos,
      agendados,
      respondidos,
      aguardando,
      counts: {
        vencidos: vencidos.length,
        agendados: agendados.length,
        respondidos: respondidos.length,
        aguardando: aguardando.length,
      },
    });
  } catch (err) {
    console.error("[GET /notifications/followup-overview] failed");
    if (!res.headersSent) res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

export default router;

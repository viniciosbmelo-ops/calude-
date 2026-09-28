import { Router, type IRouter } from "express";
import { db, patientsTable, surgeriesTable, whatsappOutboxTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/wa-broadcast/patients", requireAuth, async (req, res): Promise<void> => {
  const { procedureType, dateFrom, dateTo } = req.query as Record<string, string>;

  const patients = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.doctorId, req.doctorId!))
    .orderBy(sql`lower(${patientsTable.nome}) COLLATE "pt-BR-x-icu"`, patientsTable.id);

  const result = [];

  for (const patient of patients) {
    const surgeries = await db
      .select()
      .from(surgeriesTable)
      .where(eq(surgeriesTable.patientId, patient.id));

    const hasAnyFilter = procedureType || dateFrom || dateTo;

    let matchedSurgeries = surgeries;
    if (hasAnyFilter) {
      matchedSurgeries = surgeries.filter(s => {
        if (procedureType) {
          const inTipos = s.tiposProcedimento.includes(procedureType);
          const inProcRealizado = s.procedimentoRealizado
            ? s.procedimentoRealizado.toLowerCase().includes(procedureType.toLowerCase())
            : false;
          if (!inTipos && !inProcRealizado) return false;
        }
        if (dateFrom && (!s.dataCirurgia || s.dataCirurgia < dateFrom)) return false;
        if (dateTo && (!s.dataCirurgia || s.dataCirurgia > dateTo)) return false;
        return true;
      });
      if (matchedSurgeries.length === 0) continue;
    }

    result.push({
      id: patient.id,
      nome: patient.nome,
      telefone: patient.telefone ?? null,
      email: patient.email ?? null,
      sexo: patient.sexo ?? null,
      dataNascimento: patient.dataNascimento ?? null,
      surgeries: matchedSurgeries.map(s => ({
        id: s.id,
        dataCirurgia: s.dataCirurgia ?? null,
        tiposProcedimento: s.tiposProcedimento,
        procedimentoRealizado: s.procedimentoRealizado ?? null,
        lado: s.lado ?? null,
        hospital: s.hospital ?? null,
      })),
    });
  }

  res.json(result);
});

router.post("/wa-broadcast/send", requireAuth, async (req, res): Promise<void> => {
  const { patientIds, messageTemplate } = req.body as {
    patientIds: number[];
    messageTemplate: string;
  };

  if (!Array.isArray(patientIds) || patientIds.length === 0) {
    res.status(400).json({ error: "patientIds deve ser um array não-vazio." });
    return;
  }

  if (!messageTemplate || typeof messageTemplate !== "string") {
    res.status(400).json({ error: "messageTemplate é obrigatório." });
    return;
  }
  const requestKey = req.get("Idempotency-Key")?.trim();
  if (!requestKey || requestKey.length > 120) {
    res.status(400).json({ error: "Idempotency-Key é obrigatório para este envio." });
    return;
  }

  const patients = await db
    .select({ id: patientsTable.id, nome: patientsTable.nome, telefone: patientsTable.telefone })
    .from(patientsTable)
    .where(
      eq(patientsTable.doctorId, req.doctorId!) &&
        inArray(patientsTable.id, patientIds)
    );

  const results: { id: number; nome: string; ok: boolean; error?: string }[] = [];

  for (const patient of patients) {
    if (!patient.telefone) {
      results.push({ id: patient.id, nome: patient.nome, ok: false, error: "Sem telefone cadastrado." });
      continue;
    }

    const firstName = patient.nome.split(" ")[0];
    const text = messageTemplate
      .replace(/\{nome\}/gi, firstName)
      .replace(/\{medico\}/gi, "");

    await db.insert(whatsappOutboxTable).values({
      eventType: "doctor_broadcast",
      idempotencyKey: `broadcast:${req.doctorId}:${requestKey}:${patient.id}`,
      recipient: patient.telefone,
      message: text,
    }).onConflictDoNothing({ target: whatsappOutboxTable.idempotencyKey });
    results.push({ id: patient.id, nome: patient.nome, ok: true });
  }

  res.status(202).json({ results });
});

export { router as waBroadcastRouter };

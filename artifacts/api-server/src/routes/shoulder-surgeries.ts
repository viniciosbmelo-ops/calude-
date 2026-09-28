/**
 * DocSholder — cirurgia de ombro e cotovelo.
 *
 * - Rascunho: `dadosClinicos` só precisa ter a forma certa (parseClinicalPayload).
 * - Finalização / criação completa: tudo válido pelos schemas do núcleo (validateClinicalPayload).
 * - Relatório: texto determinístico do ReportEngine, sem IA, a partir do registro salvo.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, doctorsTable, patientsTable, surgeriesTable } from "@workspace/db";
import {
  ClinicalPayload,
  ClinicalPayloadError,
  IssueGroup,
  ReportEngine,
  SchemaRegistry,
  ValidateClinicalOptions,
  buildReportInput,
  parseClinicalPayload,
  validateClinicalPayload,
} from "@workspace/clinical";
import { requireAuth } from "../middlewares/requireAuth";

const registry = new SchemaRegistry();
const engine = new ReportEngine();

export type ClinicalCheck =
  | { ok: true; payload: ClinicalPayload | null }
  | { ok: false; status: 400 | 422; body: { error: string; code: string; details?: IssueGroup[] } };

interface SurgeryColumnsInput {
  dataCirurgia?: string | null;
  lado?: string | null;
  hospital?: string | null;
}

/**
 * Normaliza e, se `complete`, valida os dados clínicos.
 * `complete` = a cirurgia será gravada como "completo" (finalizar / criar direto).
 * Na gravação valem também as regras por região / tipo de acesso (ex.: via deltopeitoral ou
 * ângulo da cadeira de praia em cotovelo). O relatório de registros já gravados passa
 * `{ regionRules: false }` para não bloquear cirurgias antigas.
 */
export function checkClinicalPayload(raw: unknown, cols: SurgeryColumnsInput, complete: boolean, opts: ValidateClinicalOptions = {}): ClinicalCheck {
  if (raw === undefined || raw === null) {
    if (!complete) return { ok: true, payload: null };
    return { ok: false, status: 422, body: { error: "Registre os dados do procedimento antes de finalizar.", code: "CLINICAL_DATA_REQUIRED" } };
  }
  let payload: ClinicalPayload;
  try {
    payload = parseClinicalPayload(raw);
  } catch (err) {
    if (err instanceof ClinicalPayloadError) return { ok: false, status: 400, body: { error: err.message, code: "CLINICAL_DATA_INVALID" } };
    throw err;
  }
  if (complete) {
    const groups = validateClinicalPayload(registry, payload, cols, opts);
    if (groups.length > 0) {
      return { ok: false, status: 422, body: { error: "Há campos pendentes no registro do procedimento.", code: "CLINICAL_VALIDATION_FAILED", details: groups } };
    }
  }
  return { ok: true, payload };
}

const router = Router();

/** Relatório cirúrgico em texto, gerado a partir do registro salvo (somente do médico dono). */
router.get("/surgeries/:id/relatorio", requireAuth, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }
  const [row] = await db
    .select({ surgery: surgeriesTable, patientNome: patientsTable.nome, patientRegistro: patientsTable.numeroRegistro })
    .from(surgeriesTable)
    .leftJoin(patientsTable, eq(patientsTable.id, surgeriesTable.patientId))
    .where(and(eq(surgeriesTable.id, id), eq(surgeriesTable.doctorId, req.doctorId!)));
  if (!row) {
    res.status(404).json({ error: "Cirurgia não encontrada." });
    return;
  }
  const s = row.surgery;
  if (!s.dadosClinicos) {
    res.status(409).json({ error: "Cirurgia sem dados de ombro/cotovelo.", code: "NO_CLINICAL_DATA" });
    return;
  }
  const check = checkClinicalPayload(s.dadosClinicos, s, true, { regionRules: false });
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }
  const [doctor] = await db
    .select({ nome: doctorsTable.nome, crm: doctorsTable.crm, crmEstado: doctorsTable.crmEstado })
    .from(doctorsTable)
    .where(eq(doctorsTable.id, req.doctorId!));
  const crm = doctor?.crm ? `${doctor.crm}${doctor.crmEstado ? `-${doctor.crmEstado}` : ""}` : undefined;
  const input = buildReportInput(check.payload!, s, {
    patient: { name: row.patientNome ?? "", ...(row.patientRegistro ? { record_number: row.patientRegistro } : {}) },
    surgeon: { name: doctor?.nome ?? "", ...(crm ? { crm } : {}) },
  });
  const report = engine.generate(input);
  res.json({ texto: report.text, versoesTemplate: report.template_versions });
});

export default router;

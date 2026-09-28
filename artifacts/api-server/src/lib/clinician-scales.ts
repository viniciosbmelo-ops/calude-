/**
 * Escalas preenchidas pelo médico no retorno (Constant-Murley, Rowe).
 * Quais valem para a cirurgia e o escore vêm SEMPRE do @workspace/clinical;
 * qualquer escore enviado pelo cliente é ignorado.
 */
import { and, inArray } from "drizzle-orm";
import { db, scaleResponsesTable } from "@workspace/db";
import { SUPPORTED_FOLLOWUP_SCALES } from "./followup-schedule";
import {
  ClinicalGuardError,
  INSTRUMENTS,
  applicableClinicianScales,
  isClinicianScaleEnabled,
  scoreClinicianScale,
} from "@workspace/clinical";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ClinicianScaleRow {
  nomeEscala: string;
  respostas: string;
  score: number;
}

export type ClinicianScalesParse =
  | { kind: "ok"; rows: ClinicianScaleRow[] }
  | { kind: "not_applicable"; scale: string }
  | { kind: "invalid"; scale: string; field?: string };

export interface ClinicianScaleSummary {
  escala: string;
  score: number | null;
  max: number | null;
  versao: string | null;
  flags: string[];
  completadoEm: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Códigos de todos os instrumentos que podem ser gravados pelo médico (licença 'free'). */
export function enabledClinicianScaleCodes(): string[] {
  return INSTRUMENTS.map((i) => i.code).filter(isClinicianScaleEnabled);
}

/**
 * Valida `escalasClinicas` ({ CONSTANT: {...}, ROWE: {...} }) contra a cirurgia.
 * `undefined`/`null` = nada a gravar. Escala fora das aplicáveis (ou não 'free') é rejeitada.
 */
export function parseClinicianScales(
  raw: unknown,
  surgery: { dadosClinicos: unknown; tiposProcedimento: unknown },
): ClinicianScalesParse {
  if (raw === undefined || raw === null) return { kind: "ok", rows: [] };
  if (!isObj(raw)) return { kind: "invalid", scale: "escalasClinicas" };
  const applicable = new Set(applicableClinicianScales({
    dadosClinicos: surgery.dadosClinicos,
    tiposProcedimento: Array.isArray(surgery.tiposProcedimento)
      ? surgery.tiposProcedimento.filter((t): t is string => typeof t === "string")
      : null,
  }));
  const rows: ClinicianScaleRow[] = [];
  for (const [scale, answers] of Object.entries(raw)) {
    if (!applicable.has(scale) || !isClinicianScaleEnabled(scale)) return { kind: "not_applicable", scale };
    try {
      const { answers: clean, result } = scoreClinicianScale(scale, answers);
      rows.push({ nomeEscala: scale, respostas: JSON.stringify(clean), score: result.score });
    } catch (err) {
      if (err instanceof ClinicalGuardError) return { kind: "invalid", scale, field: err.field };
      throw err;
    }
  }
  return { kind: "ok", rows };
}

export async function upsertClinicianScales(tx: Tx, followupId: number, rows: ClinicianScaleRow[]): Promise<void> {
  for (const row of rows) {
    await tx
      .insert(scaleResponsesTable)
      .values({ followupId, ...row })
      .onConflictDoUpdate({
        target: [scaleResponsesTable.followupId, scaleResponsesTable.nomeEscala],
        set: { respostas: row.respostas, score: row.score, completadoEm: new Date() },
      });
  }
}

/** Escalas do médico gravadas por follow-up (máximo/versão recalculados das respostas gravadas). */
export async function loadClinicianScales(followupIds: number[]): Promise<Map<number, ClinicianScaleSummary[]>> {
  const out = new Map<number, ClinicianScaleSummary[]>();
  const codes = enabledClinicianScaleCodes();
  if (followupIds.length === 0 || codes.length === 0) return out;
  const rows = await db
    .select()
    .from(scaleResponsesTable)
    .where(and(
      inArray(scaleResponsesTable.followupId, followupIds),
      inArray(scaleResponsesTable.nomeEscala, codes),
    ));
  for (const r of rows) {
    let max: number | null = null;
    let versao: string | null = null;
    let flags: string[] = [];
    try {
      const { result } = scoreClinicianScale(r.nomeEscala, JSON.parse(r.respostas));
      ({ max, version: versao, flags } = result);
    } catch {
      // Resposta antiga/ilegível: mostra só o escore gravado.
    }
    const list = out.get(r.followupId) ?? [];
    list.push({
      escala: r.nomeEscala,
      score: r.score,
      max,
      versao,
      flags,
      completadoEm: r.completadoEm ? r.completadoEm.toISOString() : null,
    });
    out.set(r.followupId, list);
  }
  for (const list of out.values()) list.sort((a, b) => codes.indexOf(a.escala) - codes.indexOf(b.escala));
  return out;
}

/** Resposta do paciente pelo link (VAS Dor, SANE) — nunca mistura com o valor do médico. */
export interface PatientScaleSummary {
  escala: string;
  score: number | null;
  completadoEm: string | null;
}

/**
 * Escalas respondidas pelo paciente por follow-up (scale_responses com nome em
 * SUPPORTED_FOLLOWUP_SCALES). Exibidas ao lado do valor do médico (ex.: vasDor).
 */
export async function loadPatientScales(followupIds: number[]): Promise<Map<number, PatientScaleSummary[]>> {
  const out = new Map<number, PatientScaleSummary[]>();
  const codes = [...SUPPORTED_FOLLOWUP_SCALES];
  if (followupIds.length === 0 || codes.length === 0) return out;
  const rows = await db
    .select()
    .from(scaleResponsesTable)
    .where(and(
      inArray(scaleResponsesTable.followupId, followupIds),
      inArray(scaleResponsesTable.nomeEscala, codes),
    ));
  for (const r of rows) {
    const list = out.get(r.followupId) ?? [];
    list.push({
      escala: r.nomeEscala,
      score: r.score,
      completadoEm: r.completadoEm ? r.completadoEm.toISOString() : null,
    });
    out.set(r.followupId, list);
  }
  for (const list of out.values()) list.sort((a, b) => codes.indexOf(a.escala) - codes.indexOf(b.escala));
  return out;
}

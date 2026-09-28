/**
 * Patient public-link routes  (Task #70 — P0 security hardening)
 *
 * Flow for classic followup links:
 *   GET  /patient/:token                → minimal public info (no IDs/names/clinical dates)
 *   POST /patient/:token/verify         → CPF verification + persistent rate-limit/lockout + session
 *   POST /patient/:token/scale/:escala  → requires session, Origin/Referer guard, server-side score,
 *                                         validates respostas, advisory-lock upsert
 *
 * Flow for regen links:
 *   GET  /patient/regen/:token                → minimal public info
 *   POST /patient/regen/:token/verify         → CPF verification + rate-limit/lockout + session
 *   POST /patient/regen/:token/scale/:escala  → same guards
 *
 * Security properties:
 *   ✅ Req #1  — public GET returns minimum: scales list + period + joint region
 *               (shoulder/elbow, for the SANE wording), no IDs/names/dates
 *   ✅ Req #2  — verify denies by default when identifier absent; persistent PG lockout (5 × 15 min)
 *   ✅ Req #3  — scale POST requires session cookie; app.ts CSRF guard applies (patient cookie in SESSION_COOKIE_NAMES)
 *   ✅ Req #4  — score recalculated server-side; no silent 0 fallback for invalid answers
 *   ✅ Req #5  — double-submission prevented with pg_advisory_xact_lock inside transaction
 *   ✅ Req #6  — session is token-bound with server-side exp; cookie revoked on invalid link
 *   ✅ Req #7  — respostas validated: plain object, key/value limits, no NaN/Infinity, in-range values;
 *               final score clamped to known scale ranges
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, doctorsTable, followupTable, surgeriesTable, scaleResponsesTable, patientsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import {
  filterSupportedFollowupScales,
  hasFractureProcedure,
  isSupportedFollowupScale,
  isPreoperativePeriod,
  resolveFollowupRegion,
} from "../lib/followup-schedule";
import { scoreSANE } from "@workspace/clinical";
import { eq, sql } from "drizzle-orm";
import {
  issuePatientSession,
  revokePatientSession,
  getPatientSession,
  checkLockout,
  recordFailedAttempt,
  clearLockout,
} from "../lib/patient-session";
import { logger } from "../lib/logger";
import { resolveDoctorLocale } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { regenPeriodForLocale } from "../lib/regen-labels";

const router: IRouter = Router();

async function localeForClassicToken(token: string) {
  const [row] = await db.select({ idioma: doctorsTable.idioma })
    .from(followupTable)
    .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(eq(followupTable.token, token)).limit(1);
  return resolveDoctorLocale(row?.idioma);
}

async function localeForRegenToken(token: string) {
  const { rows } = await pool.query(
    `SELECT d.idioma FROM regen_followup_notifications n
     JOIN regen_cases c ON c.id = n.case_id LEFT JOIN doctors d ON d.id = c.doctor_id
     WHERE n.token = $1 LIMIT 1`, [token],
  );
  return resolveDoctorLocale(rows[0]?.idioma);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCpf(c: string): string {
  return c.replace(/\D/g, "");
}

/** Returns error string if session is invalid/missing/mismatched; null if ok. */
function requirePatientSession(
  req: Request,
  tokenType: "classic" | "regen",
  linkToken: string,
): string | null {
  const session = getPatientSession(req);
  if (!session) return "Sessão de verificação ausente. Por favor, verifique sua identidade primeiro.";
  if (session.tokenType !== tokenType) return "Tipo de sessão inválido.";
  if (session.linkToken !== linkToken) return "Sessão vinculada a outro link.";
  return null; // ok
}

// ─── Response validation ──────────────────────────────────────────────────────

const MAX_RESPOSTAS_KEYS = 30;
const MAX_KEY_LENGTH = 80;
const MAX_STRING_VALUE_LENGTH = 200;

/**
 * Validates the `respostas` object:
 *  - must be a plain object (not array/null)
 *  - at most MAX_RESPOSTAS_KEYS keys
 *  - key names ≤ MAX_KEY_LENGTH chars
 *  - values must be number (finite, not NaN/Inf) | boolean | string (≤ MAX_STRING_VALUE_LENGTH)
 *  - no nested objects/arrays
 * Returns an error string on failure, null on success.
 */
function validateRespostas(
  respostas: unknown,
): string | null {
  if (
    typeof respostas !== "object" ||
    respostas === null ||
    Array.isArray(respostas)
  ) {
    return "Respostas deve ser um objeto simples";
  }
  const entries = Object.entries(respostas as Record<string, unknown>);
  if (entries.length === 0) return "Respostas não pode estar vazio";
  if (entries.length > MAX_RESPOSTAS_KEYS) {
    return `Respostas excede o máximo de ${MAX_RESPOSTAS_KEYS} chaves`;
  }
  for (const [key, value] of entries) {
    if (key.length > MAX_KEY_LENGTH) {
      return `Chave de resposta muito longa: ${key.slice(0, 20)}…`;
    }
    if (typeof value === "number") {
      if (!isFinite(value) || isNaN(value)) {
        return `Valor inválido para "${key}": deve ser um número finito`;
      }
      if (value < -10000 || value > 100000) {
        return `Valor numérico fora de faixa para "${key}"`;
      }
    } else if (typeof value === "boolean") {
      // ok
    } else if (typeof value === "string") {
      if (value.length > MAX_STRING_VALUE_LENGTH) {
        return `Valor de texto muito longo para "${key}"`;
      }
    } else {
      return `Tipo de valor inválido para "${key}": esperado número, booleano ou texto`;
    }
  }
  return null;
}

// ─── Score ranges ─────────────────────────────────────────────────────────────

// As escalas do joelho (IKDC, Lysholm, KOOS, Tegner, Kujala, ACL-RSI, Marx,
// WOMAC) foram retiradas. Escalas de ombro/cotovelo entram aqui com o cálculo.
const SCALE_SCORE_RANGES: Record<string, [number, number]> = {
  "VAS Dor":  [0, 10],
  "SANE":     [0, 100],
};

/** Clamp score to the known range for this scale. */
function clampScore(escala: string, score: number): number {
  const range = SCALE_SCORE_RANGES[escala];
  if (!range) return score; // unknown scale — no clamping
  return Math.max(range[0], Math.min(range[1], score));
}

// ─── Server-side score calculators ───────────────────────────────────────────

type Answers = Record<string, number>;

/**
 * Extract numeric answers from the validated respostas object.
 * Booleans are converted to 1/0. Non-numeric values are omitted.
 */
function extractNumericAnswers(respostas: Record<string, unknown>): Answers {
  const answers: Answers = {};
  for (const [k, v] of Object.entries(respostas)) {
    if (typeof v === "number" && isFinite(v)) {
      answers[k] = v;
    } else if (typeof v === "boolean") {
      answers[k] = v ? 1 : 0;
    }
    // strings ignored for numeric computation
  }
  return answers;
}

const SERVER_SCORE_CALCULATORS: Record<string, (a: Answers) => number> = {
  "VAS Dor": (a) => {
    const v = a["vas"];
    if (v === undefined || !isFinite(v)) throw new Error("VAS: resposta 'vas' ausente ou inválida");
    return Math.max(0, Math.min(10, v));
  },
  // SANE (0–100, % do normal): pontuado pelo núcleo clínico, que rejeita
  // resposta ausente, não inteira ou fora de 0–100 (sem clamp silencioso).
  "SANE": (a) => {
    const v = a["sane"];
    if (v === undefined) throw new Error("SANE: resposta 'sane' ausente");
    return scoreSANE({ value: v }).score;
  },
};

/**
 * Compute server-authoritative score.
 * - For known scales: throws on invalid/missing answers (no silent fallback).
 * - For unknown scales: validates client score is finite and in 0-100.
 * Returns { score } or throws with a user-readable message.
 */
function computeScore(
  escala: string,
  respostas: Record<string, unknown>,
  clientScore: unknown,
): number {
  const calc = SERVER_SCORE_CALCULATORS[escala];
  if (calc) {
    const answers = extractNumericAnswers(respostas);
    const raw = calc(answers); // throws on missing/invalid answers
    if (!isFinite(raw)) throw new Error(`Score calculado inválido para "${escala}"`);
    return clampScore(escala, raw);
  }

  // Unknown scale — use client-supplied score but validate it
  const cs = Number(clientScore);
  if (!isFinite(cs) || isNaN(cs)) {
    throw new Error(`Score ausente ou inválido para escala desconhecida "${escala}"`);
  }
  if (cs < 0 || cs > 100) {
    throw new Error(`Score fora da faixa permitida (0–100) para escala "${escala}"`);
  }
  return cs;
}

/**
 * Escalas do paciente já respondidas: interseção entre as escalas enviadas
 * (já filtradas às suportadas) e as linhas de scale_responses do follow-up.
 * Exclui escalas do médico gravadas no mesmo follow-up.
 */
export function completedPatientScales(
  escalasEnviadas: readonly string[],
  responseScaleNames: readonly string[],
): string[] {
  const answered = new Set(responseScaleNames);
  return escalasEnviadas.filter((e) => answered.has(e));
}

// ─── Classic followup routes ──────────────────────────────────────────────────

/**
 * GET /patient/:token
 * Public — returns ONLY scale names, completion mask, and period.
 * No internal IDs, no patient name, no surgery date, no clinical data.
 */
router.get("/patient/:token", async (req: Request, res: Response): Promise<void> => {
  const token = req.params["token"] as string;

  const [followup] = await db
    .select({
      escalasEnviadas: followupTable.escalasEnviadas,
      tempo: followupTable.tempo,
      tiposProcedimento: surgeriesTable.tiposProcedimento,
      regiao: surgeriesTable.regiao,
      doctorLocale: doctorsTable.idioma,
    })
    .from(followupTable)
    .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(eq(followupTable.token, token))
    .limit(1);

  if (
    !followup
    || (
      hasFractureProcedure(followup.tiposProcedimento as string[] | null)
      && isPreoperativePeriod(followup.tempo)
    )
  ) {
    revokePatientSession(res);
    res.status(404).json({
      error: message(
        followup ? resolveDoctorLocale(followup.doctorLocale) : "pt-BR",
        "invalidLink",
      ),
    });
    return;
  }

  // Linhas antigas podem listar escalas do joelho já retiradas: só expõe as
  // escalas que o cronograma atual aplica (sem alterar o banco).
  const escalasEnviadas = filterSupportedFollowupScales(followup.escalasEnviadas);
  res.json({
    tempo: followup.tempo,
    escalasEnviadas,
    noScales: escalasEnviadas.length === 0,
    doctorLocale: resolveDoctorLocale(followup.doctorLocale),
    // Só "shoulder" | "elbow" | null: define a palavra da articulação no SANE.
    regiao: resolveFollowupRegion(
      followup.regiao,
      followup.tiposProcedimento as string[] | null,
    ),
  });
});

/**
 * POST /patient/:token/verify
 * Verifies CPF.  Denies if CPF is not registered.
 * Applies persistent per-IP+token rate-limit/lockout (5 attempts → 15 min).
 * On success issues a short-lived HttpOnly session cookie.
 */
router.post("/patient/:token/verify", async (req: Request, res: Response): Promise<void> => {
  const token = req.params["token"] as string;
  const { cpf } = req.body as { cpf?: string };

  const [followupPointer] = await db
    .select({ id: followupTable.id, surgeryId: followupTable.surgeryId, idioma: doctorsTable.idioma })
    .from(followupTable)
    .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
    .innerJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(eq(followupTable.token, token))
    .limit(1);

  const locale = resolveDoctorLocale(followupPointer?.idioma);

  if (!followupPointer) {
    // Don't reveal whether the token exists — same error as wrong CPF
    const remaining = await checkLockout(req, token);
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      res.status(429).json({
        error: message(locale, "incorrectAttempts", { minutes, suffix: minutes !== 1 ? "s" : "" }),
        code: "LOCKOUT",
      });
      return;
    }
    await recordFailedAttempt(req, token);
    res.status(401).json({ error: message(locale, "cpfVerificationFailed") });
    return;
  }
  if (!cpf || !cpf.trim()) {
    res.status(400).json({ error: message(locale, "cpfRequired") });
    return;
  }

  // Resolve the owner before emitting the lockout error, so a valid public
  // link cannot be used to force the fallback language.
  const remaining = await checkLockout(req, token);
  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60000);
    res.status(429).json({
      error: message(locale, "incorrectAttempts", { minutes, suffix: minutes !== 1 ? "s" : "" }),
      code: "LOCKOUT",
    });
    return;
  }

  const verification = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(87001, CAST(${followupPointer.surgeryId} AS integer))`,
    );
    const [row] = await tx
      .select({
        followup: followupTable,
        surgery: surgeriesTable,
        patient: patientsTable,
      })
      .from(followupTable)
      .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
      .innerJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
      .where(eq(followupTable.token, token))
      .for("update")
      .limit(1);
    if (
      !row
      || (
        hasFractureProcedure(row.surgery.tiposProcedimento as string[] | null)
        && isPreoperativePeriod(row.followup.tempo)
      )
    ) {
      revokePatientSession(res);
      return { kind: "invalid" as const };
    }
    if (!row.patient.cpf) return { kind: "no_identifier" as const };
    if (normalizeCpf(cpf) !== normalizeCpf(row.patient.cpf)) {
      return { kind: "wrong_identifier" as const };
    }

    await clearLockout(req, token);
    issuePatientSession(res, "classic", token);
    const responses = await tx
      .select({ nomeEscala: scaleResponsesTable.nomeEscala })
      .from(scaleResponsesTable)
      .where(eq(scaleResponsesTable.followupId, row.followup.id));
    const escalasEnviadas = filterSupportedFollowupScales(row.followup.escalasEnviadas);
    return {
      kind: "verified" as const,
      tempo: row.followup.tempo,
      escalasEnviadas,
      // Só escalas do paciente: respostas do médico no mesmo follow-up
      // (Constant, Rowe…) não são "concluídas" pelo paciente.
      completedScales: completedPatientScales(escalasEnviadas, responses.map((r) => r.nomeEscala)),
      regiao: resolveFollowupRegion(
        row.surgery.regiao,
        row.surgery.tiposProcedimento as string[] | null,
      ),
    };
  });

  if (verification.kind === "invalid" || verification.kind === "wrong_identifier") {
    await recordFailedAttempt(req, token);
    res.status(401).json({ error: message(locale, "verificationFailed") });
    return;
  }
  if (verification.kind === "no_identifier") {
    await recordFailedAttempt(req, token);
    res.status(401).json({ error: message(locale, "identificationNotRegistered") });
    return;
  }

  res.json({
    ok: true,
    doctorLocale: locale,
    tempo: verification.tempo,
    escalasEnviadas: verification.escalasEnviadas,
    completedScales: verification.completedScales,
    noScales: verification.escalasEnviadas.length === 0,
    regiao: verification.regiao,
  });
});

/**
 * POST /patient/:token/scale/:escala
 * Requires the patient session cookie issued by /verify.
 * Validates Origin/Referer (handled by app.ts CSRF guard when cookie present).
 * Validates respostas structure and values.
 * Recalculates score server-side — no silent fallback on invalid answers.
 * Uses DB-level advisory lock to prevent concurrent double submission.
 */
router.post("/patient/:token/scale/:escala", async (req: Request, res: Response): Promise<void> => {
  const token = req.params["token"] as string;
  const escala = req.params["escala"] as string;
  const locale = await localeForClassicToken(token);

  // 1. Require valid patient session
  const sessionError = requirePatientSession(req, "classic", token);
  if (sessionError) {
    res.status(401).json({ error: message(locale, "sessionVerificationRequired") });
    return;
  }

  const { respostas, score: clientScore } = req.body as {
    respostas?: unknown;
    score?: unknown;
  };

  // 2. Validate respostas structure
  const validationError = validateRespostas(respostas);
  if (validationError) {
    res.status(400).json({ error: message(locale, "invalidAnswers") });
    return;
  }

  const [followupPointer] = await db
    .select({ id: followupTable.id, surgeryId: followupTable.surgeryId })
    .from(followupTable)
    .where(eq(followupTable.token, token))
    .limit(1);

  if (!followupPointer) {
    revokePatientSession(res);
    res.status(404).json({ error: message(locale, "invalidLink") });
    return;
  }

  let score: number;
  try {
    score = computeScore(escala, respostas as Record<string, unknown>, clientScore);
  } catch (err) {
    res.status(400).json({
      error: message(locale, "scoreCalculationFailed"),
    });
    return;
  }

  const scoreField = ({
    "VAS Dor": ["vas_dor", Math.round(score)],
  } as const)[escala];
  const lockKey = `classic:${followupPointer.id}:${escala}`;

  const client = await pool.connect();
  let persistedFollowupId: number | null = null;
  let requestedScales: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [87001, followupPointer.surgeryId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);

    const { rows: lockedRows } = await client.query<{
      id: number;
      tempo: string;
      escalas: string[] | null;
      tipos: string[] | null;
    }>(
      `SELECT
         f.id,
         f.tempo,
         f.escalas_enviadas AS escalas,
         s.tipos_procedimento AS tipos
       FROM followup f
       INNER JOIN surgeries s ON s.id = f.surgery_id
       WHERE f.token = $1
       FOR UPDATE OF f, s`,
      [token],
    );
    const locked = lockedRows[0];
    if (
      !locked
      || (
        hasFractureProcedure(locked.tipos)
        && isPreoperativePeriod(locked.tempo)
      )
    ) {
      await client.query("ROLLBACK");
      revokePatientSession(res);
      res.status(404).json({ error: message(locale, "invalidLink") });
      return;
    }
    if (!isSupportedFollowupScale(escala) || !locked.escalas?.includes(escala)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: message(locale, "requestedScaleNotFound") });
      return;
    }

    const { rows: existing } = await client.query(
      `SELECT id FROM scale_responses WHERE followup_id = $1 AND nome_escala = $2`,
      [locked.id, escala],
    );

    if (existing.length > 0) {
      await client.query("COMMIT");
      res.json({ ok: true, message: message(locale, "scaleAlreadyCompleted") });
      return;
    }

    await client.query(
      `INSERT INTO scale_responses (followup_id, nome_escala, respostas, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (followup_id, nome_escala) DO NOTHING`,
      [locked.id, escala, JSON.stringify(respostas), score],
    );
    if (scoreField) {
      // A resposta do paciente fica em scale_responses; o campo do follow-up só
      // é preenchido quando o médico ainda não registrou valor (nunca sobrescreve).
      await client.query(
        `UPDATE followup SET ${scoreField[0]} = $1, updated_at = now()
         WHERE id = $2 AND ${scoreField[0]} IS NULL`,
        [scoreField[1], locked.id],
      );
    }

    persistedFollowupId = locked.id;
    requestedScales = filterSupportedFollowupScales(locked.escalas);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "patient scale insert error");
    res.status(500).json({ error: message(locale, "responseSaveFailed") });
    return;
  } finally {
    client.release();
  }

  if (persistedFollowupId == null) {
    res.status(500).json({ error: message(locale, "responseSaveFailed") });
    return;
  }

  const allResponses = await db
    .select({ nomeEscala: scaleResponsesTable.nomeEscala })
    .from(scaleResponsesTable)
    .where(eq(scaleResponsesTable.followupId, persistedFollowupId));
  const completedScales = completedPatientScales(requestedScales, allResponses.map(r => r.nomeEscala));
  const allCompleted = requestedScales.every(e => completedScales.includes(e));

  res.json({ ok: true, allCompleted });
});

// ─── Regen followup routes ────────────────────────────────────────────────────

const UUID_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /patient/regen/:token
 * Public — returns ONLY period, scale list, and completion mask.
 */
router.get("/patient/regen/:token", async (req: Request, res: Response): Promise<void> => {
  const token = req.params["token"] as string;
  if (!UUID_TOKEN_PATTERN.test(token)) {
    revokePatientSession(res);
    res.status(404).json({ error: message("pt-BR", "invalidLink") });
    return;
  }
  const { rows } = await pool.query(
    `SELECT n.id, n.periodo, n.scales, d.idioma AS doctor_locale
     FROM regen_followup_notifications n
     JOIN regen_cases c ON c.id = n.case_id
     LEFT JOIN doctors d ON d.id = c.doctor_id
     WHERE n.token = $1`,
    [token]
  );
  const locale = resolveDoctorLocale(rows[0]?.doctor_locale);
  if (!rows.length) {
    revokePatientSession(res);
    res.status(404).json({
      error: message(locale, "invalidLink"),
      // This is a controlled locale belonging to a matched notification. It
      // lets the public client render the same non-enumerating error safely.
      ...(rows.length ? { doctorLocale: locale } : {}),
    });
    return;
  }
  const n = rows[0];
  const respRows = await pool.query(
    `SELECT nome_escala FROM regen_scale_responses WHERE notification_id = $1`,
    [n.id]
  );
  res.json({
    // `periodo` remains the canonical database value used by verification and
    // response writes. This label is strictly presentation-only.
    periodo: n.periodo,
    periodoLabel: regenPeriodForLocale(n.periodo, locale),
    scales: n.scales ?? [],
    completedScales: respRows.rows.map((r: Record<string, string>) => r.nome_escala),
    noScales: !(n.scales?.length),
    isRegen: true,
    doctorLocale: locale,
  });
});

/**
 * POST /patient/regen/:token/verify
 * Verifies the linked patient's CPF. Denies if CPF is not registered.
 * Applies persistent per-IP+token rate-limit/lockout.
 * On success issues patient session cookie.
 */
router.post("/patient/regen/:token/verify", async (req: Request, res: Response): Promise<void> => {
  const token = req.params["token"] as string;
  const { cpf } = req.body as { cpf?: string };
  const locale = await localeForRegenToken(token);

  if (!cpf || !cpf.trim()) {
    res.status(400).json({ error: message(locale, "cpfRequired") });
    return;
  }
  if (!UUID_TOKEN_PATTERN.test(token)) {
    revokePatientSession(res);
    res.status(401).json({ error: message(locale, "cpfVerificationFailed") });
    return;
  }

  // Persistent rate-limit / lockout
  const remaining = await checkLockout(req, `regen:${token}`);
  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60000);
    res.status(429).json({
      error: message(locale, "incorrectAttempts", {
        minutes,
        suffix: minutes !== 1 ? "s" : "",
      }),
      code: "LOCKOUT",
    });
    return;
  }

  const { rows } = await pool.query(
    `SELECT n.id, n.periodo, n.scales, n.scheduled_date,
            p.cpf AS patient_cpf
     FROM regen_followup_notifications n
     JOIN regen_cases c ON c.id = n.case_id
     LEFT JOIN patients p
       ON p.id = c.patient_id
      AND p.doctor_id = c.doctor_id
     WHERE n.token = $1`,
    [token]
  );

  if (!rows.length) {
    // Same error as wrong CPF — don't reveal token existence
    await recordFailedAttempt(req, `regen:${token}`);
    res.status(401).json({ error: message(locale, "cpfVerificationFailed") });
    return;
  }
  const n = rows[0];

  // DENY by default when CPF is not registered or the case has no linked patient.
  if (!n.patient_cpf) {
    await recordFailedAttempt(req, `regen:${token}`);
    res.status(401).json({ error: message(locale, "identificationNotRegistered") });
    return;
  }

  if (normalizeCpf(cpf) !== normalizeCpf(n.patient_cpf)) {
    await recordFailedAttempt(req, `regen:${token}`);
    res.status(401).json({ error: message(locale, "cpfVerificationFailed") });
    return;
  }

  // CPF matched
  await clearLockout(req, `regen:${token}`);
  issuePatientSession(res, "regen", token);

  const respRows = await pool.query(
    `SELECT nome_escala FROM regen_scale_responses WHERE notification_id = $1`,
    [n.id]
  );

  res.json({
    ok: true,
    doctorLocale: locale,
    periodo: n.periodo,
    periodoLabel: regenPeriodForLocale(n.periodo, locale),
    scales: n.scales ?? [],
    completedScales: respRows.rows.map((r: Record<string, string>) => r.nome_escala),
    noScales: !(n.scales?.length),
    scheduledDate: n.scheduled_date,
    isRegen: true,
  });
});

/**
 * POST /patient/regen/:token/scale/:escala
 * Requires patient session cookie.  Validates respostas.  Recalculates score server-side.
 * Advisory lock prevents concurrent double submission.
 */
router.post("/patient/regen/:token/scale/:escala", async (req: Request, res: Response): Promise<void> => {
  const token = req.params["token"] as string;
  const escala = req.params["escala"] as string;
  const locale = await localeForRegenToken(token);

  // 1. Require valid patient session
  const sessionError = requirePatientSession(req, "regen", token);
  if (sessionError) {
    res.status(401).json({ error: message(locale, "sessionVerificationRequired") });
    return;
  }
  if (!UUID_TOKEN_PATTERN.test(token)) {
    revokePatientSession(res);
    res.status(404).json({ error: message(locale, "invalidLink") });
    return;
  }

  const { respostas, score: clientScore } = req.body as {
    respostas?: unknown;
    score?: unknown;
  };

  // 2. Validate respostas structure
  const validationError = validateRespostas(respostas);
  if (validationError) {
    res.status(400).json({ error: message(locale, "invalidAnswers") });
    return;
  }

  const { rows } = await pool.query(
    `SELECT n.id, n.scales FROM regen_followup_notifications n WHERE n.token = $1`,
    [token]
  );
  if (!rows.length) {
    revokePatientSession(res);
    res.status(404).json({ error: message(locale, "invalidLink") });
    return;
  }
  const n = rows[0];

  if (!n.scales?.includes(escala)) {
    res.status(400).json({ error: message(locale, "requestedScaleNotFound") });
    return;
  }

  // 3. Compute authoritative score
  let score: number;
  try {
    score = computeScore(escala, respostas as Record<string, unknown>, clientScore);
  } catch (err) {
    res.status(400).json({
      error: message(locale, "scoreCalculationFailed"),
    });
    return;
  }

  // 4. Advisory lock + insert
  const lockKey = `regen:${String(n.id)}:${escala}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);

    const { rows: existing } = await client.query(
      `SELECT id FROM regen_scale_responses WHERE notification_id = $1 AND nome_escala = $2`,
      [n.id, escala]
    );

    if (existing.length > 0) {
      await client.query("COMMIT");
      res.json({ ok: true, message: message(locale, "scaleAlreadyCompleted") });
      return;
    }

    await client.query(
      `INSERT INTO regen_scale_responses (notification_id, nome_escala, respostas, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (notification_id, nome_escala) DO NOTHING`,
      [n.id, escala, JSON.stringify(respostas), score]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "regen scale insert error");
    res.status(500).json({ error: message(locale, "responseSaveFailed") });
    return;
  } finally {
    client.release();
  }

  // 5. Check overall completion
  const { rows: all } = await pool.query(
    `SELECT nome_escala FROM regen_scale_responses WHERE notification_id = $1`,
    [n.id]
  );
  const completedScales = all.map((r: Record<string, string>) => r.nome_escala);
  const allCompleted = (n.scales || []).every((s: string) => completedScales.includes(s));

  if (allCompleted) {
    await pool.query(
      `UPDATE regen_followup_notifications SET status = 'completed' WHERE id = $1`,
      [n.id]
    );
  }

  res.json({ ok: true, allCompleted });
});

export default router;

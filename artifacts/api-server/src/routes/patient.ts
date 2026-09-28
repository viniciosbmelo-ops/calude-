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
 *   ✅ Req #1  — public GET returns minimum: scales list + period, no IDs/names/dates
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
  hasFractureProcedure,
  isPreoperativePeriod,
} from "../lib/followup-schedule";
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

const SCALE_SCORE_RANGES: Record<string, [number, number]> = {
  "VAS Dor":  [0, 10],
  "Tegner":   [0, 10],
  "Lysholm":  [0, 100],
  "IKDC":     [0, 100],
  "Kujala":   [0, 100],
  "ACL-RSI":  [0, 100],
  "Marx":     [0, 16],
  "WOMAC":    [0, 100],
  "KOOS-12":  [0, 100],
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
  "Tegner": (a) => {
    const v = a["tegner"];
    if (v === undefined || !isFinite(v)) throw new Error("Tegner: resposta 'tegner' ausente ou inválida");
    return Math.max(0, Math.min(10, Math.round(v)));
  },
  "Lysholm": (a) => {
    const keys = ["claudicacao","apoio","bloqueio","instabilidade","dor","edema","escadas","agachar"];
    for (const k of keys) {
      if (a[k] === undefined) throw new Error(`Lysholm: resposta '${k}' ausente`);
    }
    return keys.reduce((s, k) => s + a[k]!, 0);
  },
  "IKDC": (a) => {
    const required = ["atividade_atual","dor_frequencia","dor_intensidade","rigidez","edema",
      "travamento","falseamento","nivel_atual_atividade","funcao_geral","funcao_esporte"];
    for (const k of required) {
      if (a[k] === undefined) throw new Error(`IKDC: resposta '${k}' ausente`);
    }
    const dor = 10 - (a["dor_intensidade"]!);
    const keys: Array<[string, number]> = [
      ["atividade_atual", 4], ["dor_frequencia", 10], ["rigidez", 10],
      ["edema", 10], ["travamento", 15], ["falseamento", 15],
      ["nivel_atual_atividade", 4], ["funcao_geral", 10], ["funcao_esporte", 10],
    ];
    const rawPoints = keys.reduce((s, [k]) => s + a[k]!, 0) + dor;
    const maxRaw = keys.reduce((s, [, m]) => s + m, 0) + 10;
    return Math.round((rawPoints / maxRaw) * 100);
  },
  "Kujala": (a) => {
    const keys = ["claudicacao","apoio","andar","escadas","agachar","correr","pular","ajoelhar",
      "dor_frente","edema","luxacao","atrofia","flexao"];
    for (const k of keys) {
      if (a[k] === undefined) throw new Error(`Kujala: resposta '${k}' ausente`);
    }
    return keys.reduce((s, k) => s + a[k]!, 0);
  },
  "ACL-RSI": (a) => {
    const negative = ["medo_lesao","nervoso_esporte","nao_recuperado","frustracao_nivel","preocupacao_ceder","arriscado_retornar"];
    const positive = ["confianca_suportar","joelho_aguentara","satisfeito_nivel","seguro_dedicar","nivel_anterior","animado_retorno"];
    const all = [...negative, ...positive];
    for (const k of all) {
      if (a[k] === undefined) throw new Error(`ACL-RSI: resposta '${k}' ausente`);
    }
    let total = 0; let count = 0;
    for (const k of negative) { total += (10 - a[k]!); count++; }
    for (const k of positive) { total += a[k]!; count++; }
    return Math.round((total / count) * 10);
  },
  "Marx": (a) => {
    const keys = ["correr","desacelerar","corte_lateral","pivotar"];
    for (const k of keys) {
      if (a[k] === undefined) throw new Error(`Marx: resposta '${k}' ausente`);
    }
    return keys.reduce((s, k) => s + a[k]!, 0);
  },
  "KOOS-12": (a) => {
    const keys = ["dor_freq","dor_torcao","dor_extensao","rigidez_manha","rigidez_tarde",
      "adl_escadas","adl_levantar","adl_caminhar","sport_agachar","sport_correr",
      "qol_consciente","qol_modificou"];
    for (const k of keys) {
      if (a[k] === undefined) throw new Error(`KOOS-12: resposta '${k}' ausente`);
    }
    const total = keys.reduce((s, k) => s + a[k]!, 0);
    return Math.round((total / (keys.length * 4)) * 100);
  },
  "WOMAC": (a) => {
    const keys = ["dor_caminhar","dor_escadas","dor_noite","dor_repouso","dor_carga",
      "rig_manha","rig_tarde","fis_descer","fis_subir","fis_levantar","fis_ficar_pe",
      "fis_caminhar","fis_carro","fis_compras","fis_meias","fis_cama","fis_banho",
      "fis_sentado","fis_vaso","fis_tarefas","fis_tarefas_leves"];
    for (const k of keys) {
      if (a[k] === undefined) throw new Error(`WOMAC: resposta '${k}' ausente`);
    }
    const total = keys.reduce((s, k) => s + a[k]!, 0);
    return Math.round(100 - (total / (keys.length * 4)) * 100);
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

  res.json({
    tempo: followup.tempo,
    escalasEnviadas: followup.escalasEnviadas ?? [],
    noScales: !(followup.escalasEnviadas?.length),
    doctorLocale: resolveDoctorLocale(followup.doctorLocale),
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
    return {
      kind: "verified" as const,
      tempo: row.followup.tempo,
      escalasEnviadas: row.followup.escalasEnviadas ?? [],
      completedScales: responses.map((response) => response.nomeEscala),
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
    "Tegner": ["tegner", Math.round(score)],
    "Lysholm": ["lysholm", Math.round(score)],
    "IKDC": ["ikdc", score],
    "Kujala": ["kujala", Math.round(score)],
    "ACL-RSI": ["acl_rsi", Math.round(score)],
    "Marx": ["marx", Math.round(score)],
    "WOMAC": ["womac", Math.round(score)],
    "KOOS-12": ["koos12", Math.round(score)],
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
    if (!locked.escalas?.includes(escala)) {
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
      await client.query(
        `UPDATE followup SET ${scoreField[0]} = $1, updated_at = now() WHERE id = $2`,
        [scoreField[1], locked.id],
      );
    }

    persistedFollowupId = locked.id;
    requestedScales = locked.escalas;
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
  const completedScales = allResponses.map(r => r.nomeEscala);
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

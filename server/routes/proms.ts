/** Escores clínicos (Prompt 8) — preenchimento pelo médico. Envio ao paciente por link fica fora deste módulo. */
import { createHash, randomBytes } from 'crypto';
import { Request, Router } from 'express';
import { Pool } from 'pg';
import { INSTRUMENTS, ScoreResult, canSendToPatient, isInstrumentEnabled, scoreASES, scoreConstant, scoreMEPS, scoreRowe, scoreSANE } from '../../src/clinical';
import { isUuid, withRole, withUser } from '../db';
import { userOf } from '../auth';
import { HttpError, badRequest, h, notFound } from '../http';

const TIMEPOINTS = ['preop', '6w', '3m', '6m', '12m', '24m', 'other'];
const SCORERS: Record<string, (a: any) => ScoreResult> = { SANE: scoreSANE, ASES: scoreASES, CONSTANT: scoreConstant, MEPS: scoreMEPS, ROWE: scoreRowe };

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function baseUrl(req: Request, configured?: string): string {
  return (configured ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

export function promRoutes(pool: Pool, publicBaseUrl?: string): Router {
  const r = Router();

  r.post('/episodes/:id/proms', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const { instrument, timepoint, answers, completed_at } = req.body ?? {};
    const meta = INSTRUMENTS.find((i) => i.code === instrument);
    const scorer = SCORERS[instrument];
    if (!meta || !scorer) throw badRequest('Instrumento desconhecido ou sem pontuação implementada.');
    // ASES/MEPS ficam 'pending' até confirmação de licença — não liberar aqui
    if (!isInstrumentEnabled(instrument)) throw new HttpError(422, 'INSTRUMENT_NOT_LICENSED', `${instrument} bloqueado até confirmação da licença.`);
    if (!TIMEPOINTS.includes(timepoint)) throw badRequest(`timepoint inválido. Opções: ${TIMEPOINTS.join(', ')}.`);
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) throw badRequest('answers deve ser objeto.');
    const when = completed_at ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(when))) throw badRequest('completed_at inválido.');

    const s = scorer(answers); // ClinicalGuardError → 422
    const row = await withUser(pool, userOf(req), async (db) => {
      const e = await db.query(`SELECT region FROM public.care_episode WHERE id = $1`, [req.params.id]);
      if (e.rowCount === 0) throw notFound('Episódio');
      if (!meta.region.includes(e.rows[0].region)) throw badRequest(`${instrument} não se aplica à região ${e.rows[0].region}.`);
      return (await db.query(
        `INSERT INTO public.prom_response (episode_id, instrument, instrument_version, timepoint, answers, score, score_max, subscores, flags, respondent, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'clinician',$10)
         RETURNING id, instrument, instrument_version, timepoint, score::float8 AS score, score_max::float8 AS score_max, subscores, flags, completed_at`,
        [req.params.id, instrument, s.version, timepoint, answers, s.score, s.max, s.subscores, s.flags, when]
      )).rows[0];
    });
    res.status(201).json(row);
  }));

  // Séries separadas por (instrumento, versão, máximo): Constant/75 nunca se mistura com Constant/100
  r.get('/episodes/:id/proms', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const rows = await withUser(pool, userOf(req), async (db) => {
      const e = await db.query(`SELECT 1 FROM public.care_episode WHERE id = $1`, [req.params.id]);
      if (e.rowCount === 0) throw notFound('Episódio');
      return (await db.query(
        `SELECT id, instrument, instrument_version, timepoint, score::float8 AS score, score_max::float8 AS score_max, subscores, flags, respondent, completed_at
           FROM public.prom_response WHERE episode_id = $1 ORDER BY completed_at`,
        [req.params.id]
      )).rows;
    });
    const series: Record<string, typeof rows> = {};
    for (const x of rows) (series[`${x.instrument}|${x.instrument_version}|${x.score_max}`] ??= []).push(x);
    res.json({ responses: rows, series: Object.entries(series).map(([key, points]) => { const [instrument, version, max] = key.split('|'); return { instrument, version, max: Number(max), points }; }) });
  }));

  // ---------------- convites por link (paciente) ----------------
  r.post('/episodes/:id/prom-invites', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const { instrument, timepoint } = req.body ?? {};
    const days = req.body?.expires_in_days ?? 14;
    if (!canSendToPatient(instrument)) throw new HttpError(422, 'NOT_PATIENT_INSTRUMENT', 'Instrumento não pode ser enviado ao paciente (clínico/misto ou sem licença).');
    if (!TIMEPOINTS.includes(timepoint)) throw badRequest(`timepoint inválido. Opções: ${TIMEPOINTS.join(', ')}.`);
    if (!Number.isInteger(days) || days < 1 || days > 60) throw badRequest('expires_in_days: 1 a 60.');
    const token = randomBytes(32).toString('base64url');
    const row = await withUser(pool, userOf(req), async (db) => {
      const e = await db.query(`SELECT region FROM public.care_episode WHERE id = $1`, [req.params.id]);
      if (e.rowCount === 0) throw notFound('Episódio');
      if (!INSTRUMENTS.find((i) => i.code === instrument)!.region.includes(e.rows[0].region)) throw badRequest(`${instrument} não se aplica à região.`);
      return (await db.query(
        `INSERT INTO public.prom_invite (episode_id, instrument, timepoint, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5))
         RETURNING id, instrument, timepoint, created_at, expires_at`,
        [req.params.id, instrument, timepoint, sha256(token), days]
      )).rows[0];
    });
    // O token só existe nesta resposta; o banco guarda o hash
    res.status(201).json({ ...row, url: `${baseUrl(req, publicBaseUrl)}/p/${token}` });
  }));

  r.get('/episodes/:id/prom-invites', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const rows = await withUser(pool, userOf(req), async (db) => {
      if ((await db.query(`SELECT 1 FROM public.care_episode WHERE id = $1`, [req.params.id])).rowCount === 0) throw notFound('Episódio');
      return (await db.query(
        `SELECT id, instrument, timepoint, created_at, expires_at, used_at,
                CASE WHEN used_at IS NOT NULL THEN 'used' WHEN expires_at <= now() THEN 'expired' ELSE 'open' END AS status
           FROM public.prom_invite WHERE episode_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      )).rows;
    });
    res.json(rows);
  }));

  r.delete('/prom-invites/:inviteId', h(async (req, res) => {
    if (!isUuid(req.params.inviteId)) throw notFound('Convite');
    const n = await withUser(pool, userOf(req), async (db) => (await db.query(`DELETE FROM public.prom_invite WHERE id = $1 AND used_at IS NULL`, [req.params.inviteId])).rowCount);
    if (!n) throw notFound('Convite');
    res.status(204).end();
  }));

  // ---------------- agenda (criada na assinatura do relatório) ----------------
  r.get('/proms/agenda', h(async (req, res) => {
    const rows = await withUser(pool, userOf(req), async (db) =>
      (await db.query(
        `SELECT ps.id, ps.episode_id, ps.surgery_id, ps.timepoint, ps.due::text AS due, ps.window_start::text AS window_start, ps.window_end::text AS window_end,
                e.patient_id, e.region, e.side, e.primary_pathology, to_jsonb(p)->>'name' AS patient_name,
                EXISTS (SELECT 1 FROM public.prom_response pr WHERE pr.episode_id = ps.episode_id AND pr.timepoint = ps.timepoint) AS done,
                CASE WHEN EXISTS (SELECT 1 FROM public.prom_response pr WHERE pr.episode_id = ps.episode_id AND pr.timepoint = ps.timepoint) THEN 'done'
                     WHEN current_date > ps.window_end THEN 'overdue'
                     WHEN current_date >= ps.window_start THEN 'due'
                     ELSE 'future' END AS status
           FROM public.prom_schedule ps
           JOIN public.care_episode e ON e.id = ps.episode_id
           JOIN public.patient p ON p.id = e.patient_id
          ORDER BY ps.due`
      )).rows
    );
    res.json(rows);
  }));

  return r;
}

/** Rotas PÚBLICAS do paciente: executam como docsholder_public, que só alcança as funções de convite. */
export function publicPromRoutes(pool: Pool): Router {
  const r = Router();
  const info = (token: string) =>
    withRole(pool, 'docsholder_public', async (db) => (await db.query(`SELECT * FROM public.prom_invite_info($1)`, [sha256(token)])).rows[0]);

  r.get('/public/prom/:token', h(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!TOKEN_RE.test(req.params.token)) throw notFound('Convite');
    const i = await info(req.params.token);
    if (!i) throw notFound('Convite');
    const meta = INSTRUMENTS.find((x) => x.code === i.instrument);
    res.json({ instrument: i.instrument, name_pt: meta?.name_pt ?? i.instrument, timepoint: i.timepoint, expires_at: i.expires_at, status: i.status });
  }));

  r.post('/public/prom/:token', h(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!TOKEN_RE.test(req.params.token)) throw notFound('Convite');
    const i = await info(req.params.token);
    if (!i) throw notFound('Convite');
    if (i.status !== 'open') throw new HttpError(410, i.status === 'used' ? 'INVITE_USED' : 'INVITE_EXPIRED', i.status === 'used' ? 'Este questionário já foi respondido.' : 'Este link expirou.');
    if (!canSendToPatient(i.instrument)) throw new HttpError(410, 'INVITE_EXPIRED', 'Instrumento indisponível.');
    const answers = req.body?.answers;
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) throw badRequest('answers deve ser objeto.');
    const s = SCORERS[i.instrument](answers); // pontuação SEMPRE no servidor
    const out = await withRole(pool, 'docsholder_public', async (db) =>
      (await db.query(`SELECT * FROM public.prom_invite_submit($1,$2,$3,$4,$5,$6,$7)`, [sha256(req.params.token), s.version, answers, s.score, s.max, s.subscores, s.flags])).rows[0]
    );
    if (out.status !== 'ok') throw new HttpError(410, out.status === 'used' ? 'INVITE_USED' : 'INVITE_EXPIRED', 'Link indisponível.');
    // Paciente não recebe o escore de volta — só a confirmação
    res.status(201).json({ ok: true });
  }));

  return r;
}

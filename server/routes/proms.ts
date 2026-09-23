/** Escores clínicos (Prompt 8) — preenchimento pelo médico. Envio ao paciente por link fica fora deste módulo. */
import { Router } from 'express';
import { Pool } from 'pg';
import { INSTRUMENTS, ScoreResult, isInstrumentEnabled, scoreASES, scoreConstant, scoreMEPS, scoreRowe, scoreSANE } from '../../src/clinical';
import { isUuid, withUser } from '../db';
import { userOf } from '../auth';
import { HttpError, badRequest, h, notFound } from '../http';

const TIMEPOINTS = ['preop', '6w', '3m', '6m', '12m', '24m', 'other'];
const SCORERS: Record<string, (a: any) => ScoreResult> = { SANE: scoreSANE, ASES: scoreASES, CONSTANT: scoreConstant, MEPS: scoreMEPS, ROWE: scoreRowe };

export function promRoutes(pool: Pool): Router {
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

  return r;
}

/** Episódios de cuidado (Prompt 2). Isolamento por RLS; recurso alheio → 404. */
import { Router } from 'express';
import { Pool } from 'pg';
import { PATHOLOGY_BY_CODE } from '../../src/clinical';
import { isUuid, withUser } from '../db';
import { userOf } from '../auth';
import { HttpError, badRequest, h, notFound } from '../http';

const MECHANISMS = ['traumatic', 'degenerative', 'acute_on_chronic', 'overuse', 'unknown'];
const STATUSES = ['open', 'surgical', 'conservative', 'closed'];
const COLS = `id, patient_id, region, side, affected_is_dominant, primary_pathology, secondary_pathologies, mechanism, onset_date::text AS onset_date, status, opened_at, updated_at`;

function checkPathologies(region: string, codes: unknown[]): void {
  for (const c of codes) {
    const p = typeof c === 'string' ? PATHOLOGY_BY_CODE.get(c) : undefined;
    if (!p) throw badRequest(`Patologia desconhecida: ${String(c)}`);
    if (p.region !== region) throw badRequest(`Patologia ${c} não é da região ${region}.`);
  }
}

function checkSecondaries(region: string, primary: string, v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 20) throw badRequest('secondary_pathologies deve ser lista (até 20).');
  checkPathologies(region, v);
  if (v.includes(primary)) throw badRequest('Patologia principal não pode ser secundária.');
  return [...new Set(v as string[])];
}

export function episodeRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/patients/:patientId/episodes', h(async (req, res) => {
    const { patientId } = req.params;
    if (!isUuid(patientId)) throw notFound('Paciente');
    const b = req.body ?? {};
    if (b.region !== 'shoulder' && b.region !== 'elbow') throw badRequest('region deve ser shoulder ou elbow.');
    if (b.side !== 'R' && b.side !== 'L') throw badRequest('side deve ser R ou L.');
    if (typeof b.affected_is_dominant !== 'boolean') throw badRequest('affected_is_dominant (boolean) obrigatório.');
    checkPathologies(b.region, [b.primary_pathology]);
    const secondaries = checkSecondaries(b.region, b.primary_pathology, b.secondary_pathologies ?? []);
    if (b.mechanism !== undefined && !MECHANISMS.includes(b.mechanism)) throw badRequest(`mechanism inválido. Opções: ${MECHANISMS.join(', ')}.`);

    const row = await withUser(pool, userOf(req), async (db) => {
      // owner/clinic herdados do paciente; se a RLS esconder o paciente, 404
      const p = await db.query(`SELECT owner_id, clinic_id FROM public.patient WHERE id = $1`, [patientId]);
      if (p.rowCount === 0) throw notFound('Paciente');
      return (await db.query(
        `INSERT INTO public.care_episode (patient_id, owner_id, clinic_id, region, side, affected_is_dominant, primary_pathology, secondary_pathologies, mechanism, onset_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
        [patientId, p.rows[0].owner_id, p.rows[0].clinic_id, b.region, b.side, b.affected_is_dominant, b.primary_pathology, secondaries, b.mechanism ?? null, b.onset_date ?? null]
      )).rows[0];
    });
    res.status(201).json(row);
  }));

  r.get('/patients/:patientId/episodes', h(async (req, res) => {
    if (!isUuid(req.params.patientId)) throw notFound('Paciente');
    const rows = await withUser(pool, userOf(req), async (db) =>
      (await db.query(`SELECT ${COLS} FROM public.care_episode WHERE patient_id = $1 ORDER BY opened_at DESC`, [req.params.patientId])).rows
    );
    res.json(rows);
  }));

  r.get('/episodes/:id', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const row = await withUser(pool, userOf(req), async (db) => {
      const e = await db.query(`SELECT ${COLS} FROM public.care_episode WHERE id = $1`, [req.params.id]);
      if (e.rowCount === 0) throw notFound('Episódio');
      const s = await db.query(`SELECT id, surgery_date::text AS surgery_date, side, status FROM public.surgery WHERE episode_id = $1 ORDER BY surgery_date, created_at`, [req.params.id]);
      return { ...e.rows[0], surgeries: s.rows };
    });
    res.json(row);
  }));

  r.patch('/episodes/:id', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const b = req.body ?? {};
    const extra = Object.keys(b).filter((k) => k !== 'status' && k !== 'secondary_pathologies');
    if (extra.length) throw badRequest(`Campos não editáveis: ${extra.join(', ')}.`);
    if (b.status !== undefined && !STATUSES.includes(b.status)) throw badRequest(`status inválido. Opções: ${STATUSES.join(', ')}.`);

    const row = await withUser(pool, userOf(req), async (db) => {
      const cur = await db.query(`SELECT region, primary_pathology, secondary_pathologies, status FROM public.care_episode WHERE id = $1 FOR UPDATE`, [req.params.id]);
      if (cur.rowCount === 0) throw notFound('Episódio');
      const c = cur.rows[0];
      const secondaries = b.secondary_pathologies === undefined ? c.secondary_pathologies : checkSecondaries(c.region, c.primary_pathology, b.secondary_pathologies);
      // Não deixa remover secundária já usada em procedimento (o trigger do banco só checa na inserção)
      const allowed = new Set<string>([c.primary_pathology, ...secondaries]);
      const used = await db.query(
        `SELECT DISTINCT sp.pathology_code, pc.parent_code FROM public.surgery_procedure sp
           JOIN public.surgery s ON s.id = sp.surgery_id JOIN public.pathology_catalog pc ON pc.code = sp.pathology_code
          WHERE s.episode_id = $1`,
        [req.params.id]
      );
      const orphan = used.rows.filter((u) => !allowed.has(u.pathology_code) && !(u.parent_code && allowed.has(u.parent_code)));
      if (orphan.length) throw new HttpError(422, 'PATHOLOGY_IN_USE', `Patologia usada em procedimento registrado: ${orphan.map((o) => o.pathology_code).join(', ')}.`);
      return (await db.query(
        `UPDATE public.care_episode SET status = $2, secondary_pathologies = $3, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
        [req.params.id, b.status ?? c.status, secondaries]
      )).rows[0];
    });
    res.json(row);
  }));

  return r;
}

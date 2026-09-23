/** Avaliações do episódio (história, exame, imagem, diagnóstico…). Só dados válidos pelo schema são gravados. */
import { Router } from 'express';
import { Pool } from 'pg';
import { PATHOLOGY_BY_CODE, SchemaRegistry } from '../../src/clinical';
import { isUuid, withUser } from '../db';
import { userOf } from '../auth';
import { HttpError, badRequest, h, notFound } from '../http';

const KINDS = ['history', 'physical_exam', 'imaging', 'diagnosis', 'planning', 'clinical_score'];
const COLS = 'id, kind, pathology_code, schema_id, data, performed_at, author_id, created_at';

export function assessmentRoutes(pool: Pool, registry: SchemaRegistry): Router {
  const r = Router();

  r.get('/episodes/:id/assessments', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const rows = await withUser(pool, userOf(req), async (db) => {
      if ((await db.query(`SELECT 1 FROM public.care_episode WHERE id = $1`, [req.params.id])).rowCount === 0) throw notFound('Episódio');
      return (await db.query(`SELECT ${COLS} FROM public.episode_assessment WHERE episode_id = $1 ORDER BY performed_at DESC, created_at DESC`, [req.params.id])).rows;
    });
    res.json(rows);
  }));

  r.post('/episodes/:id/assessments', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Episódio');
    const { kind, schema_id, pathology_code, data, performed_at } = req.body ?? {};
    if (!KINDS.includes(kind)) throw badRequest(`kind inválido. Opções: ${KINDS.join(', ')}.`);
    if (typeof schema_id !== 'string' || !registry.get(schema_id)) throw badRequest('schema_id desconhecido.');
    if (pathology_code !== undefined && !PATHOLOGY_BY_CODE.has(pathology_code)) throw badRequest('pathology_code desconhecido.');
    const v = registry.validate(schema_id, data);
    if (!v.valid) throw new HttpError(422, 'VALIDATION_FAILED', 'Há campos pendentes.', v.issues);
    const when = performed_at ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(when))) throw badRequest('performed_at inválido.');
    const row = await withUser(pool, userOf(req), async (db) => {
      if ((await db.query(`SELECT 1 FROM public.care_episode WHERE id = $1`, [req.params.id])).rowCount === 0) throw notFound('Episódio');
      return (await db.query(
        `INSERT INTO public.episode_assessment (episode_id, kind, pathology_code, schema_id, data, performed_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
        [req.params.id, kind, pathology_code ?? null, schema_id, data, when]
      )).rows[0];
    });
    res.status(201).json(row);
  }));

  return r;
}

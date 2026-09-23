/** Dados de referência: catálogo, schemas, rótulos, estruturas do mapa, instrumentos. */
import { Router } from 'express';
import { Pool } from 'pg';
import { ARTHRO_STRUCTURES, INSTRUMENTS, SchemaRegistry } from '../../src/clinical';
import labels from '../../src/clinical/labels.pt.json';
import { withUser } from '../db';
import { userOf } from '../auth';
import { badRequest, h, notFound } from '../http';

export function referenceRoutes(pool: Pool, registry: SchemaRegistry): Router {
  const r = Router();

  r.get('/pathologies', h(async (req, res) => {
    const region = req.query.region;
    if (region !== undefined && region !== 'shoulder' && region !== 'elbow') throw badRequest('region deve ser shoulder ou elbow.');
    const rows = await withUser(pool, userOf(req), async (db) =>
      (await db.query(
        `SELECT code, region, name_pt, parent_code, diagnosis_schema_id, intraop_schema_id, report_template, proms_default
           FROM public.pathology_catalog WHERE active AND ($1::text IS NULL OR region = $1) ORDER BY code`,
        [region ?? null]
      )).rows
    );
    // Agrupa filhas sob a patologia-mãe, preservando a ordem do catálogo
    const roots = rows.filter((p) => !p.parent_code).map((p) => ({ ...p, children: [] as any[] }));
    const byCode = new Map(roots.map((p) => [p.code, p]));
    for (const p of rows.filter((x) => x.parent_code)) byCode.get(p.parent_code)?.children.push(p);
    res.json(roots);
  }));

  r.get('/schemas', (_req, res) => res.json(registry.ids()));
  r.get('/schemas/:id', (req, res, next) => {
    const s = registry.get(req.params.id);
    if (!s) return next(notFound('Schema'));
    res.json(s);
  });
  r.get('/labels', (_req, res) => res.json(labels));
  r.get('/arthro-structures/:region', (req, res, next) => {
    const s = ARTHRO_STRUCTURES[req.params.region as 'shoulder' | 'elbow'];
    if (!s) return next(notFound('Região'));
    res.json(s);
  });
  r.get('/instruments', (_req, res) => res.json(INSTRUMENTS));

  return r;
}

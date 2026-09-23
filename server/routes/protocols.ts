/** Protocolos pós-operatórios do cirurgião. O conteúdo é escrito pelo médico; o sistema não fornece texto clínico. */
import { Router } from 'express';
import { Pool } from 'pg';
import { isUuid, withUser } from '../db';
import { userOf } from '../auth';
import { badRequest, h, notFound } from '../http';

const COLS = 'id, code, title, body, active, updated_at';

function check(b: any, partial: boolean): void {
  if (!partial || b.code !== undefined) if (typeof b.code !== 'string' || !/^[A-Z0-9_]{2,40}$/.test(b.code)) throw badRequest('code: 2–40 caracteres A-Z, 0-9 ou _.');
  if (!partial || b.title !== undefined) if (typeof b.title !== 'string' || b.title.trim().length < 2 || b.title.length > 120) throw badRequest('title: 2–120 caracteres.');
  if (!partial || b.body !== undefined) if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 20000) throw badRequest('body: 1–20000 caracteres.');
  if (b.active !== undefined && typeof b.active !== 'boolean') throw badRequest('active deve ser boolean.');
}

export function protocolRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/protocols', h(async (req, res) => {
    res.json(await withUser(pool, userOf(req), async (db) => (await db.query(`SELECT ${COLS} FROM public.postop_protocol ORDER BY code`)).rows));
  }));

  r.post('/protocols', h(async (req, res) => {
    const b = req.body ?? {};
    check(b, false);
    const row = await withUser(pool, userOf(req), async (db) =>
      (await db.query(`INSERT INTO public.postop_protocol (code, title, body, active) VALUES ($1,$2,$3,$4) RETURNING ${COLS}`, [b.code, b.title.trim(), b.body, b.active ?? true])).rows[0]
    );
    res.status(201).json(row);
  }));

  r.patch('/protocols/:id', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Protocolo');
    const b = req.body ?? {};
    check(b, true);
    const row = await withUser(pool, userOf(req), async (db) =>
      (await db.query(
        `UPDATE public.postop_protocol SET code = COALESCE($2, code), title = COALESCE($3, title), body = COALESCE($4, body), active = COALESCE($5, active), updated_at = now()
          WHERE id = $1 RETURNING ${COLS}`,
        [req.params.id, b.code ?? null, b.title?.trim() ?? null, b.body ?? null, b.active ?? null]
      )).rows[0]
    );
    if (!row) throw notFound('Protocolo');
    res.json(row);
  }));

  r.delete('/protocols/:id', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Protocolo');
    const n = await withUser(pool, userOf(req), async (db) => (await db.query(`DELETE FROM public.postop_protocol WHERE id = $1`, [req.params.id])).rowCount);
    if (!n) throw notFound('Protocolo');
    res.status(204).end();
  }));

  return r;
}

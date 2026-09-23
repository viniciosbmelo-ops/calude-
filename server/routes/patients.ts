/**
 * Pacientes (modo standalone — tabela de db/migrations/000_base_patient.sql).
 * Leitura via to_jsonb para tolerar prontuários com colunas diferentes.
 */
import { Router } from 'express';
import { Pool } from 'pg';
import { isUuid, withUser } from '../db';
import { userOf } from '../auth';
import { badRequest, h, notFound } from '../http';

const pick = (j: Record<string, any>) => ({
  id: j.id,
  name: j.name ?? null,
  record_number: j.record_number ?? null,
  birth_date: j.birth_date ?? null,
  sex: j.sex ?? null,
  clinic_id: j.clinic_id ?? null,
  created_at: j.created_at ?? null
});

export function patientRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/patients', h(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rows = await withUser(pool, userOf(req), async (db) =>
      (await db.query(
        `SELECT to_jsonb(p) AS j FROM public.patient p
          WHERE $1 = '' OR (to_jsonb(p)->>'name') ILIKE '%' || $1 || '%' OR (to_jsonb(p)->>'record_number') = $1
          ORDER BY (to_jsonb(p)->>'name') NULLS LAST LIMIT 200`,
        [q]
      )).rows
    );
    res.json(rows.map((x) => pick(x.j)));
  }));

  r.post('/patients', h(async (req, res) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name.length < 2 || name.length > 200) throw badRequest('Nome do paciente: 2 a 200 caracteres.');
    if (b.record_number !== undefined && b.record_number !== null && (typeof b.record_number !== 'string' || b.record_number.length > 40)) throw badRequest('Prontuário: até 40 caracteres.');
    if (b.birth_date !== undefined && b.birth_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date)) throw badRequest('Data de nascimento: AAAA-MM-DD.');
    if (b.sex !== undefined && b.sex !== null && !['F', 'M', 'O'].includes(b.sex)) throw badRequest('Sexo: F, M ou O.');
    if (b.clinic_id !== undefined && b.clinic_id !== null && !isUuid(b.clinic_id)) throw badRequest('clinic_id inválido.');
    const u = userOf(req);
    const row = await withUser(pool, u, async (db) =>
      (await db.query(
        `INSERT INTO public.patient (owner_id, clinic_id, name, record_number, birth_date, sex) VALUES ($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(patient) AS j`,
        [u.id, b.clinic_id ?? null, name, b.record_number || null, b.birth_date || null, b.sex || null]
      )).rows[0]
    );
    res.status(201).json(pick(row.j));
  }));

  r.get('/patients/:id', h(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Paciente');
    const row = await withUser(pool, userOf(req), async (db) => (await db.query(`SELECT to_jsonb(p) AS j FROM public.patient p WHERE id = $1`, [req.params.id])).rows[0]);
    if (!row) throw notFound('Paciente');
    res.json(pick(row.j));
  }));

  return r;
}

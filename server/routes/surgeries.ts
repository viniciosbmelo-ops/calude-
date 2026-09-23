/**
 * Registro cirúrgico (Prompts 4 e 5): cirurgia, procedimentos, mapa artroscópico, implantes.
 *
 * Rascunho (autosave): dados incompletos PODEM ser gravados; toda escrita devolve
 * `validation` com as pendências do schema. Gerar/assinar relatório exige tudo válido
 * (ver reports.ts). Só `surgery_date` e `side` são exigidos já no rascunho (o banco deriva colunas deles).
 */
import { Router } from 'express';
import { Pool } from 'pg';
import { ARTHRO_STRUCTURES, PATHOLOGY_BY_CODE, Region, SchemaRegistry, parseGs1 } from '../../src/clinical';
import { Db, isUuid, withUser } from '../db';
import { userOf } from '../auth';
import { HttpError, badRequest, h, notFound } from '../http';

export const CORE_SCHEMA = 'CORE_SURGERY.v1';
const DEFAULT_KEYS = ['anesthesia', 'positioning', 'beach_chair_angle_deg', 'antibiotic', 'portals', 'skin_prep', 'tranexamic_acid', 'approach'];
const MAP_STATUSES = ['normal', 'lesion', 'treated', 'not_evaluated'];
const IMPLANT_CATEGORIES = ['anchor', 'screw', 'plate', 'button', 'prosthesis_component', 'graft', 'suture_tape', 'other'];

export function intraopSchemaOf(code: string): { id: string; version: number } {
  const p = PATHOLOGY_BY_CODE.get(code);
  if (!p) throw badRequest(`Patologia desconhecida: ${code}`);
  if (!p.intraop) throw new HttpError(422, 'NO_INTRAOP_SCHEMA', `A patologia ${code} ainda não tem formulário intraoperatório.`);
  const m = /\.v(\d+)$/.exec(p.intraop);
  return { id: p.intraop, version: Number(m![1]) };
}

function assertCoreMinimum(core: any): void {
  if (!core || typeof core !== 'object' || Array.isArray(core)) throw badRequest('core deve ser objeto.');
  if (typeof core.surgery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(core.surgery_date)) throw badRequest('core.surgery_date (YYYY-MM-DD) obrigatório.');
  if (core.side !== 'R' && core.side !== 'L') throw badRequest('core.side (R/L) obrigatório.');
}

/** Cirurgia visível ao usuário + região do episódio. Lança 404 se a RLS esconder. */
export async function loadSurgery(db: Db, id: string, lock = false) {
  if (!isUuid(id)) throw notFound('Cirurgia');
  const r = await db.query(
    `SELECT s.id, s.episode_id, s.surgeon_id, s.core, s.status, s.surgery_date::text AS surgery_date, s.side,
            e.region, e.side AS episode_side, e.patient_id
       FROM public.surgery s JOIN public.care_episode e ON e.id = s.episode_id
      WHERE s.id = $1`,
    [id]
  );
  if (r.rowCount === 0) throw notFound('Cirurgia');
  // Trava por advisory lock (não FOR UPDATE: a policy de UPDATE esconderia cirurgias assinadas → 404 em vez de 409)
  if (lock) await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [id]);
  return r.rows[0];
}

function assertEditable(s: { status: string }): void {
  if (s.status !== 'draft' && s.status !== 'completed') {
    throw new HttpError(409, 'SURGERY_LOCKED', 'Cirurgia com relatório assinado — alterações só por nova versão do relatório.');
  }
}

export function surgeryRoutes(pool: Pool, registry: SchemaRegistry): Router {
  const r = Router();

  // Defaults da última cirurgia do mesmo cirurgião
  r.get('/surgeries/defaults', h(async (req, res) => {
    const u = userOf(req);
    const core = await withUser(pool, u, async (db) =>
      (await db.query(`SELECT core FROM public.surgery WHERE surgeon_id = $1 ORDER BY surgery_date DESC, created_at DESC LIMIT 1`, [u.id])).rows[0]?.core
    );
    const out: Record<string, unknown> = {};
    for (const k of DEFAULT_KEYS) if (core && core[k] !== undefined) out[k] = core[k];
    res.json(out);
  }));

  r.post('/episodes/:episodeId/surgeries', h(async (req, res) => {
    if (!isUuid(req.params.episodeId)) throw notFound('Episódio');
    const core = req.body?.core;
    assertCoreMinimum(core);
    const row = await withUser(pool, userOf(req), async (db) => {
      const e = await db.query(`SELECT id FROM public.care_episode WHERE id = $1`, [req.params.episodeId]);
      if (e.rowCount === 0) throw notFound('Episódio');
      return (await db.query(
        `INSERT INTO public.surgery (episode_id, core, core_schema_id) VALUES ($1, $2, $3) RETURNING id, status, surgery_date::text AS surgery_date, side`,
        [req.params.episodeId, core, CORE_SCHEMA]
      )).rows[0];
    });
    res.status(201).json({ ...row, validation: registry.validate(CORE_SCHEMA, core) });
  }));

  r.get('/surgeries/:id', h(async (req, res) => {
    const out = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id);
      const [procs, map, implants, reports] = [
        await db.query(`SELECT id, pathology_code, sequence, schema_id, schema_version, data FROM public.surgery_procedure WHERE surgery_id = $1 ORDER BY sequence`, [s.id]),
        await db.query(`SELECT structure_code, status, finding_text, justification FROM public.arthroscopic_map WHERE surgery_id = $1`, [s.id]),
        await db.query(
          `SELECT si.id, si.procedure_id, si.implant_id, si.lot, si.serial, si.expiry::text AS expiry, si.quantity, si.location, si.size, si.raw_barcode,
                  ic.category, ic.manufacturer, ic.model, ic.ref_code, ic.gtin
             FROM public.surgery_implant si LEFT JOIN public.implant_catalog ic ON ic.id = si.implant_id
            WHERE si.surgery_id = $1 ORDER BY si.created_at`,
          [s.id]
        ),
        await db.query(`SELECT id, version, signed_at, supersedes, content_hash FROM public.surgical_report WHERE surgery_id = $1 ORDER BY version`, [s.id])
      ];
      return {
        ...s,
        validation: registry.validate(CORE_SCHEMA, s.core),
        procedures: procs.rows.map((p) => ({ ...p, validation: registry.validate(p.schema_id, p.data) })),
        arthroscopic_map: map.rows,
        implants: implants.rows,
        reports: reports.rows
      };
    });
    res.json(out);
  }));

  r.patch('/surgeries/:id', h(async (req, res) => {
    const b = req.body ?? {};
    if (b.core === undefined && b.status === undefined) throw badRequest('Nada a alterar (core ou status).');
    if (b.status !== undefined && b.status !== 'draft' && b.status !== 'completed') throw badRequest('status só pode ser draft ou completed (assinatura é pelo relatório).');
    if (b.core !== undefined) assertCoreMinimum(b.core);
    const out = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      const core = b.core ?? s.core;
      if (b.status === 'completed') {
        const v = registry.validate(CORE_SCHEMA, core);
        if (!v.valid) throw new HttpError(422, 'VALIDATION_FAILED', 'Núcleo cirúrgico incompleto.', v.issues);
      }
      await db.query(`UPDATE public.surgery SET core = $2, status = $3, updated_at = now() WHERE id = $1`, [s.id, core, b.status ?? s.status]);
      return { id: s.id, status: b.status ?? s.status, validation: registry.validate(CORE_SCHEMA, core) };
    });
    res.json(out);
  }));

  // ---------------- procedimentos ----------------
  r.post('/surgeries/:id/procedures', h(async (req, res) => {
    const { pathology_code, data = {} } = req.body ?? {};
    if (typeof pathology_code !== 'string') throw badRequest('pathology_code obrigatório.');
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw badRequest('data deve ser objeto.');
    const schema = intraopSchemaOf(pathology_code);
    const row = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      if (PATHOLOGY_BY_CODE.get(pathology_code)!.region !== s.region) throw badRequest(`Patologia ${pathology_code} não é da região do episódio.`);
      const next = (await db.query(`SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM public.surgery_procedure WHERE surgery_id = $1`, [s.id])).rows[0].n;
      return (await db.query(
        `INSERT INTO public.surgery_procedure (surgery_id, pathology_code, sequence, schema_id, schema_version, data)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, pathology_code, sequence, schema_id, schema_version, data`,
        [s.id, pathology_code, next, schema.id, schema.version, data]
      )).rows[0];
    });
    res.status(201).json({ ...row, validation: registry.validate(row.schema_id, row.data) });
  }));

  r.put('/surgeries/:id/procedures/:procId', h(async (req, res) => {
    const data = req.body?.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw badRequest('data deve ser objeto.');
    if (!isUuid(req.params.procId)) throw notFound('Procedimento');
    const row = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      const u = await db.query(
        `UPDATE public.surgery_procedure SET data = $3 WHERE id = $2 AND surgery_id = $1 RETURNING id, pathology_code, sequence, schema_id, schema_version, data`,
        [s.id, req.params.procId, data]
      );
      if (u.rowCount === 0) throw notFound('Procedimento');
      return u.rows[0];
    });
    res.json({ ...row, validation: registry.validate(row.schema_id, row.data) });
  }));

  r.delete('/surgeries/:id/procedures/:procId', h(async (req, res) => {
    if (!isUuid(req.params.procId)) throw notFound('Procedimento');
    await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      const d = await db.query(`DELETE FROM public.surgery_procedure WHERE id = $2 AND surgery_id = $1`, [s.id, req.params.procId]);
      if (d.rowCount === 0) throw notFound('Procedimento');
      // Recompacta a sequência (1..N)
      await db.query(
        `UPDATE public.surgery_procedure sp SET sequence = o.rn
           FROM (SELECT id, row_number() OVER (ORDER BY sequence) AS rn FROM public.surgery_procedure WHERE surgery_id = $1) o
          WHERE sp.id = o.id AND sp.sequence <> o.rn`,
        [s.id]
      );
    });
    res.status(204).end();
  }));

  // Reordenar (arrastar): lista completa de ids na nova ordem
  r.put('/surgeries/:id/procedures-order', h(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every(isUuid) || new Set(ids).size !== ids.length) throw badRequest('ids deve ser lista de UUIDs sem repetição.');
    await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      const cur = (await db.query(`SELECT id FROM public.surgery_procedure WHERE surgery_id = $1`, [s.id])).rows.map((x) => x.id);
      if (cur.length !== ids.length || !cur.every((id) => ids.includes(id))) throw badRequest('A lista deve conter exatamente os procedimentos desta cirurgia.');
      // UNIQUE(surgery_id, sequence) é DEFERRABLE INITIALLY DEFERRED → trocas dentro da transação são permitidas
      await db.query(
        `UPDATE public.surgery_procedure sp SET sequence = o.ord FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, ord) WHERE sp.id = o.id AND sp.surgery_id = $1`,
        [s.id, ids]
      );
    });
    res.status(204).end();
  }));

  // ---------------- mapa artroscópico (substituição integral) ----------------
  r.put('/surgeries/:id/arthroscopic-map', h(async (req, res) => {
    const entries = req.body?.entries;
    if (!Array.isArray(entries)) throw badRequest('entries deve ser lista.');
    const out = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      const valid = ARTHRO_STRUCTURES[s.region as Region];
      const seen = new Set<string>();
      for (const e of entries) {
        if (!e || typeof e.structure_code !== 'string' || !(e.structure_code in valid)) throw badRequest(`Estrutura inválida para ${s.region}: ${e?.structure_code}`);
        if (seen.has(e.structure_code)) throw badRequest(`Estrutura repetida: ${e.structure_code}`);
        seen.add(e.structure_code);
        if (!MAP_STATUSES.includes(e.status)) throw badRequest(`status inválido em ${e.structure_code}.`);
        for (const k of ['finding_text', 'justification']) {
          if (e[k] !== undefined && e[k] !== null && (typeof e[k] !== 'string' || e[k].length > 300)) throw badRequest(`${k} em ${e.structure_code}: texto até 300 caracteres.`);
        }
      }
      await db.query(`DELETE FROM public.arthroscopic_map WHERE surgery_id = $1`, [s.id]);
      for (const e of entries) {
        await db.query(
          `INSERT INTO public.arthroscopic_map (surgery_id, structure_code, status, finding_text, justification) VALUES ($1,$2,$3,$4,$5)`,
          [s.id, e.structure_code, e.status, e.finding_text || null, e.justification || null]
        );
      }
      return { count: entries.length };
    });
    res.json(out);
  }));

  // ---------------- implantes ----------------
  r.get('/implant-catalog', h(async (req, res) => {
    const gtin = req.query.gtin;
    if (typeof gtin !== 'string' || !/^\d{14}$/.test(gtin)) throw badRequest('gtin (14 dígitos) obrigatório.');
    const u = userOf(req);
    const rows = await withUser(pool, u, async (db) =>
      // privado do usuário primeiro, depois global
      (await db.query(`SELECT id, category, manufacturer, model, ref_code, gtin, anvisa_reg, owner_id IS NOT NULL AS private FROM public.implant_catalog WHERE gtin = $1 ORDER BY owner_id IS NULL`, [gtin])).rows
    );
    res.json(rows);
  }));

  r.post('/surgeries/:id/implants', h(async (req, res) => {
    const b = req.body ?? {};
    // Leitura de código: raw_barcode é sempre guardado; campos lidos preenchem o que não veio explícito
    const scanned = typeof b.raw_barcode === 'string' && b.raw_barcode ? parseGs1(b.raw_barcode) : undefined;
    const lot = b.lot ?? scanned?.lot ?? null;
    const serial = b.serial ?? scanned?.serial ?? null;
    const expiry = b.expiry ?? scanned?.expiry ?? null;
    const quantity = b.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw badRequest('quantity deve ser inteiro de 1 a 50.');
    if (b.procedure_id !== undefined && b.procedure_id !== null && !isUuid(b.procedure_id)) throw badRequest('procedure_id inválido.');
    if (b.size !== undefined && b.size !== null && (typeof b.size !== 'string' || b.size.length > 40)) throw badRequest('size: até 40 caracteres.');
    if (b.location !== undefined && b.location !== null && (typeof b.location !== 'string' || b.location.length > 120)) throw badRequest('location: até 120 caracteres.');
    if (b.implant_id === undefined && b.new_catalog_item === undefined) throw badRequest('Informe implant_id ou new_catalog_item.');

    const row = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      let implantId = b.implant_id;
      if (implantId !== undefined) {
        if (!isUuid(implantId) || (await db.query(`SELECT 1 FROM public.implant_catalog WHERE id = $1`, [implantId])).rowCount === 0) throw notFound('Implante do catálogo');
      } else {
        const n = b.new_catalog_item;
        if (!n || !IMPLANT_CATEGORIES.includes(n.category) || typeof n.manufacturer !== 'string' || !n.manufacturer.trim() || typeof n.model !== 'string' || !n.model.trim()) {
          throw badRequest(`new_catalog_item exige category (${IMPLANT_CATEGORIES.join(', ')}), manufacturer e model.`);
        }
        const gtin = n.gtin ?? scanned?.gtin ?? null;
        implantId = (await db.query(
          `INSERT INTO public.implant_catalog (category, manufacturer, model, ref_code, gtin, owner_id) VALUES ($1,$2,$3,$4,$5, auth.uid()) RETURNING id`,
          [n.category, n.manufacturer.trim(), n.model.trim(), n.ref_code ?? null, gtin]
        )).rows[0].id;
      }
      if (b.procedure_id && (await db.query(`SELECT 1 FROM public.surgery_procedure WHERE id = $1 AND surgery_id = $2`, [b.procedure_id, s.id])).rowCount === 0) {
        throw badRequest('procedure_id não pertence a esta cirurgia.');
      }
      return (await db.query(
        `INSERT INTO public.surgery_implant (surgery_id, procedure_id, implant_id, lot, serial, expiry, quantity, location, size, raw_barcode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, implant_id, procedure_id, lot, serial, expiry::text AS expiry, quantity, location, size, raw_barcode`,
        [s.id, b.procedure_id ?? null, implantId, lot, serial, expiry, quantity, b.location || null, b.size || null, b.raw_barcode ?? null]
      )).rows[0];
    });
    res.status(201).json({ ...row, scanned: scanned ?? null });
  }));

  r.delete('/surgeries/:id/implants/:implantRowId', h(async (req, res) => {
    if (!isUuid(req.params.implantRowId)) throw notFound('Implante');
    await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id, true);
      assertEditable(s);
      const d = await db.query(`DELETE FROM public.surgery_implant WHERE id = $2 AND surgery_id = $1`, [s.id, req.params.implantRowId]);
      if (d.rowCount === 0) throw notFound('Implante');
    });
    res.status(204).end();
  }));

  return r;
}

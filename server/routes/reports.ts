/**
 * Relatório e assinatura (Prompt 6). PROIBIDO chamar LLM neste fluxo.
 * - Geração: ReportEngine determinístico, só com dados 100% válidos pelos schemas.
 * - Assinatura: checklist no SERVIDOR, signed_at do SERVIDOR, hash SHA-256 canônico.
 * - Correção pós-assinatura: nova versão com `supersedes`.
 */
import { Router } from 'express';
import { Pool } from 'pg';
import {
  ArthroMapEntry, PresignInput, ReportEngine, ReportInput, SchemaRegistry, ValidationIssue,
  reportHash, runPresignChecklist, scheduleTimepoints
} from '../../src/clinical';
import { AuthUser, Db, isUuid, withRole, withUser } from '../db';
import { userOf } from '../auth';
import { changesOnly } from '../diff';
import { renderReportPdf } from '../pdf';
import { HttpError, badRequest, h, notFound } from '../http';
import { CORE_SCHEMA, loadSurgery } from './surgeries';
import { baseUrl } from './proms';

export const MAX_REPORT_CHARS = 100_000;

export interface Parties {
  patient: ReportInput['patient'];
  surgeon: ReportInput['surgeon'];
}

/**
 * PONTO DE ADAPTAÇÃO: de onde vêm nome/prontuário do paciente e nome/CRM do cirurgião.
 * O padrão lê `public.patient.name` e os metadados do JWT do cirurgião (user_metadata.full_name / crm).
 */
export type PartiesResolver = (db: Db, ctx: { patient_id: string; surgeon_id: string; user: AuthUser }) => Promise<Parties>;

export const defaultPartiesResolver: PartiesResolver = async (db, { patient_id, user }) => {
  const p = await db.query(`SELECT name FROM public.patient WHERE id = $1`, [patient_id]);
  if (p.rowCount === 0) throw notFound('Paciente');
  const meta = (user.claims.user_metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.full_name !== 'string' || !meta.full_name.trim()) {
    throw new HttpError(422, 'SURGEON_PROFILE_INCOMPLETE', 'Nome do cirurgião ausente no perfil (user_metadata.full_name).');
  }
  return {
    patient: { name: p.rows[0].name },
    surgeon: { name: meta.full_name.trim(), crm: typeof meta.crm === 'string' ? meta.crm : undefined }
  };
};

interface SurgeryBundle {
  surgery: Awaited<ReturnType<typeof loadSurgery>>;
  procedures: { pathology_code: string; sequence: number; schema_id: string; schema_version: number; data: Record<string, any> }[];
  map: (ArthroMapEntry & { justification?: string })[];
  implants: { category: string; manufacturer: string; model: string; size?: string; lot?: string; serial?: string; quantity: number; location?: string }[];
}

async function loadBundle(db: Db, surgeryId: string, lock: boolean): Promise<SurgeryBundle> {
  const surgery = await loadSurgery(db, surgeryId, lock);
  const [procs, map, implants] = await Promise.all([
    db.query(`SELECT pathology_code, sequence, schema_id, schema_version, data FROM public.surgery_procedure WHERE surgery_id = $1 ORDER BY sequence`, [surgery.id]),
    db.query(`SELECT structure_code, status, finding_text, justification FROM public.arthroscopic_map WHERE surgery_id = $1`, [surgery.id]),
    db.query(
      `SELECT ic.category, ic.manufacturer, ic.model, si.size, si.lot, si.serial, si.quantity, si.location
         FROM public.surgery_implant si JOIN public.implant_catalog ic ON ic.id = si.implant_id
        WHERE si.surgery_id = $1 ORDER BY si.created_at, si.id`,
      [surgery.id]
    )
  ]);
  const clean = <T extends Record<string, any>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
  return { surgery, procedures: procs.rows, map: map.rows.map(clean), implants: implants.rows.map(clean) };
}

function validateAll(registry: SchemaRegistry, b: SurgeryBundle): { scope: string; issues: ValidationIssue[] }[] {
  const out: { scope: string; issues: ValidationIssue[] }[] = [];
  const c = registry.validate(CORE_SCHEMA, b.surgery.core);
  if (!c.valid) out.push({ scope: 'core', issues: c.issues });
  for (const p of b.procedures) {
    const v = registry.validate(p.schema_id, p.data);
    if (!v.valid) out.push({ scope: `procedure#${p.sequence}:${p.pathology_code}`, issues: v.issues });
  }
  return out;
}

function presignInput(b: SurgeryBundle): PresignInput {
  return {
    episode_side: b.surgery.episode_side,
    core: b.surgery.core,
    procedures: b.procedures,
    implants: b.implants.map((i) => ({ category: i.category, lot: i.lot })),
    arthroscopic_map: b.map
  };
}

function assertSurgeon(user: AuthUser, surgery: { surgeon_id: string }): void {
  if (surgery.surgeon_id !== user.id) throw new HttpError(403, 'NOT_SURGEON', 'Somente o cirurgião responsável pode gerar ou assinar o relatório.');
}

const REPORT_COLS = `id, surgery_id, version, template_versions, generated_text, final_text, diff_from_generated, signed_by, signed_at, content_hash, supersedes, created_at`;

async function loadReport(db: Db, id: string) {
  if (!isUuid(id)) throw notFound('Relatório');
  const r = await db.query(`SELECT ${REPORT_COLS} FROM public.surgical_report WHERE id = $1`, [id]);
  if (r.rowCount === 0) throw notFound('Relatório');
  return r.rows[0];
}

export function reportRoutes(pool: Pool, registry: SchemaRegistry, engine: ReportEngine, resolveParties: PartiesResolver, publicBaseUrl?: string): Router {
  const r = Router();

  r.get('/surgeries/:id/reports', h(async (req, res) => {
    const rows = await withUser(pool, userOf(req), async (db) => {
      const s = await loadSurgery(db, req.params.id);
      return (await db.query(`SELECT id, version, signed_at, signed_by, content_hash, supersedes, created_at, final_text <> generated_text AS edited FROM public.surgical_report WHERE surgery_id = $1 ORDER BY version`, [s.id])).rows;
    });
    res.json(rows);
  }));

  r.get('/reports/:id/pdf', h(async (req, res) => {
    const rep = await withUser(pool, userOf(req), (db) => loadReport(db, req.params.id));
    const signedAt = rep.signed_at ? new Date(rep.signed_at).toISOString() : null;
    const verifyUrl = rep.content_hash ? `${baseUrl(req, publicBaseUrl)}/verify/${rep.content_hash}` : null;
    const pdf = await renderReportPdf({ final_text: rep.final_text, version: rep.version, supersedes: rep.supersedes, signed_at: signedAt, content_hash: rep.content_hash }, verifyUrl);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="relatorio-v${rep.version}${rep.signed_at ? '' : '-rascunho'}.pdf"`);
    res.set('Cache-Control', 'private, no-store');
    res.send(pdf);
  }));

  r.post('/surgeries/:id/report/generate', h(async (req, res) => {
    const user = userOf(req);
    const force = req.body?.force === true;
    const postop_plan = req.body?.postop_plan;
    if (postop_plan !== undefined && (typeof postop_plan !== 'string' || postop_plan.length > 5000)) throw badRequest('postop_plan: texto até 5000 caracteres.');

    const out = await withUser(pool, user, async (db) => {
      const b = await loadBundle(db, req.params.id, true);
      assertSurgeon(user, b.surgery);
      const invalid = validateAll(registry, b);
      if (invalid.length) throw new HttpError(422, 'VALIDATION_FAILED', 'Há campos pendentes — complete o registro antes de gerar o relatório.', invalid);

      const parties = await resolveParties(db, { patient_id: b.surgery.patient_id, surgeon_id: b.surgery.surgeon_id, user });
      const input: ReportInput = {
        region: b.surgery.region,
        ...parties,
        core: b.surgery.core,
        arthroscopic_map: b.map.map(({ structure_code, status, finding_text }) => ({ structure_code, status, finding_text })),
        procedures: b.procedures.map(({ pathology_code, sequence, schema_version, data }) => ({ pathology_code, sequence, schema_version, data })),
        implants: b.implants,
        postop_plan
      };
      const gen = engine.generate(input);

      const latest = (await db.query(`SELECT ${REPORT_COLS} FROM public.surgical_report WHERE surgery_id = $1 ORDER BY version DESC LIMIT 1`, [b.surgery.id])).rows[0];
      if (latest && !latest.signed_at) {
        // Rascunho existente: regenera no lugar, sem perder edição manual sem consentimento
        if (latest.final_text !== latest.generated_text && !force) {
          throw new HttpError(409, 'DRAFT_EDITED', 'O rascunho atual tem edições manuais. Envie force=true para descartá-las.');
        }
        return (await db.query(
          `UPDATE public.surgical_report SET template_versions = $2, generated_text = $3, final_text = $3, diff_from_generated = NULL WHERE id = $1 RETURNING ${REPORT_COLS}`,
          [latest.id, gen.template_versions, gen.text]
        )).rows[0];
      }
      // Primeira versão, ou correção pós-assinatura (supersedes = última assinada)
      return (await db.query(
        `INSERT INTO public.surgical_report (surgery_id, version, template_versions, generated_text, final_text, supersedes)
         VALUES ($1, $2, $3, $4, $4, $5) RETURNING ${REPORT_COLS}`,
        [b.surgery.id, (latest?.version ?? 0) + 1, gen.template_versions, gen.text, latest?.id ?? null]
      )).rows[0];
    });
    res.status(201).json(out);
  }));

  r.get('/reports/:id', h(async (req, res) => {
    const out = await withUser(pool, userOf(req), async (db) => {
      const rep = await loadReport(db, req.params.id);
      const b = await loadBundle(db, rep.surgery_id, false);
      return { ...rep, checklist: rep.signed_at ? null : runPresignChecklist(presignInput(b)) };
    });
    res.json(out);
  }));

  r.patch('/reports/:id', h(async (req, res) => {
    const ft = req.body?.final_text;
    if (typeof ft !== 'string' || !ft.trim() || ft.length > MAX_REPORT_CHARS) throw badRequest(`final_text: texto não vazio até ${MAX_REPORT_CHARS} caracteres.`);
    const user = userOf(req);
    const out = await withUser(pool, user, async (db) => {
      const rep = await loadReport(db, req.params.id);
      if (rep.signed_at) throw new HttpError(409, 'REPORT_SIGNED', 'Relatório assinado é imutável — gere nova versão.');
      const s = await loadSurgery(db, rep.surgery_id, true);
      assertSurgeon(user, s);
      const text = ft.replace(/\r\n/g, '\n');
      const diff = changesOnly(rep.generated_text, text);
      return (await db.query(`UPDATE public.surgical_report SET final_text = $2, diff_from_generated = $3 WHERE id = $1 RETURNING ${REPORT_COLS}`, [rep.id, text, diff.length ? JSON.stringify(diff) : null])).rows[0];
    });
    res.json(out);
  }));

  r.post('/reports/:id/sign', h(async (req, res) => {
    const user = userOf(req);
    const confirmWarnings = req.body?.confirm_warnings === true;
    const out = await withUser(pool, user, async (db) => {
      const rep = await loadReport(db, req.params.id);
      if (rep.signed_at) throw new HttpError(409, 'REPORT_SIGNED', 'Relatório já assinado.');
      const b = await loadBundle(db, rep.surgery_id, true);
      assertSurgeon(user, b.surgery);
      const newer = await db.query(`SELECT 1 FROM public.surgical_report WHERE surgery_id = $1 AND version > $2`, [rep.surgery_id, rep.version]);
      if (newer.rowCount) throw new HttpError(409, 'STALE_VERSION', 'Existe versão mais nova deste relatório.');
      const invalid = validateAll(registry, b);
      if (invalid.length) throw new HttpError(422, 'VALIDATION_FAILED', 'Registro com campos pendentes.', invalid);

      const check = runPresignChecklist(presignInput(b));
      if (!check.canSign) throw new HttpError(422, 'PRESIGN_BLOCKED', 'Há bloqueios no checklist pré-assinatura.', check.issues);
      if (check.issues.length && !confirmWarnings) throw new HttpError(409, 'PRESIGN_WARNINGS', 'Confirme os avisos para assinar (confirm_warnings=true).', check.issues);

      const signed_at = new Date().toISOString(); // relógio do SERVIDOR
      const content_hash = reportHash({ surgery_id: rep.surgery_id, version: rep.version, template_versions: rep.template_versions, final_text: rep.final_text, signed_by: user.id, signed_at });
      const u = await db.query(
        `UPDATE public.surgical_report SET signed_by = $2, signed_at = $3, content_hash = $4 WHERE id = $1 AND signed_at IS NULL RETURNING ${REPORT_COLS}`,
        [rep.id, user.id, signed_at, content_hash]
      );
      if (u.rowCount === 0) throw new HttpError(409, 'REPORT_SIGNED', 'Relatório já assinado.');
      // Primeira assinatura cria a agenda de PROMs (migração 004); correções não duplicam
      const schedule = rep.supersedes ? [] : scheduleTimepoints(b.surgery.surgery_date);
      for (const t of schedule) {
        await db.query(
          `INSERT INTO public.prom_schedule (episode_id, surgery_id, timepoint, due, window_start, window_end) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (surgery_id, timepoint) DO NOTHING`,
          [b.surgery.episode_id, b.surgery.id, t.code, t.due, t.window_start, t.window_end]
        );
      }
      return { report: u.rows[0], acknowledged_warnings: check.issues, prom_schedule: schedule };
    });
    res.json(out);
  }));

  /** Recalcula o hash a partir do conteúdo gravado — detecta adulteração direta no banco. */
  r.get('/reports/:id/integrity', h(async (req, res) => {
    const rep = await withUser(pool, userOf(req), (db) => loadReport(db, req.params.id));
    if (!rep.signed_at) return res.json({ signed: false });
    const recomputed = reportHash({
      surgery_id: rep.surgery_id, version: rep.version, template_versions: rep.template_versions,
      final_text: rep.final_text, signed_by: rep.signed_by, signed_at: new Date(rep.signed_at).toISOString()
    });
    res.json({ signed: true, stored_hash: rep.content_hash, recomputed_hash: recomputed, intact: recomputed === rep.content_hash });
  }));

  return r;
}

/** Rota PÚBLICA: responde só válido/inválido + data. Nenhum conteúdo clínico. */
export function verifyRoutes(pool: Pool): Router {
  const r = Router();
  r.get('/verify/:hash', h(async (req, res) => {
    const hash = req.params.hash.toLowerCase();
    res.set('Cache-Control', 'no-store');
    const row = /^[0-9a-f]{64}$/.test(hash)
      ? await withRole(pool, 'anon', async (db) => (await db.query(`SELECT * FROM public.verify_report_hash($1)`, [hash])).rows[0])
      : undefined;
    const body = row ? { valid: true, signed_at: row.signed_at, superseded: row.superseded } : { valid: false };
    res.status(row ? 200 : 404);
    // Navegador (QR lido no celular) → página; demais → JSON
    if (req.accepts(['json', 'html']) === 'html') return res.type('html').send(verifyPage(body));
    res.json(body);
  }));
  return r;
}

function verifyPage(b: { valid: boolean; signed_at?: string; superseded?: boolean }): string {
  const when = b.signed_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(b.signed_at)) : '';
  const [title, msg, color] = !b.valid
    ? ['Documento não encontrado', 'Este código não corresponde a nenhum relatório assinado.', '#b42318']
    : b.superseded
      ? ['Assinatura válida — versão substituída', `Assinado em ${when}. Existe versão corrigida posterior deste relatório.`, '#b54708']
      : ['Assinatura válida', `Relatório assinado em ${when}.`, '#067647'];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Verificação de relatório</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#1d2433;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}main{background:#fff;border-radius:12px;padding:28px;max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;color:${color};margin:0 0 8px}p{margin:0;line-height:1.5}small{display:block;margin-top:16px;color:#667}</style></head>
<body><main><h1>${title}</h1><p>${msg}</p><small>DocSholder — esta página não exibe conteúdo clínico.</small></main></body></html>`;
}

import request from 'supertest';
import type { Express } from 'express';
import { Pool } from 'pg';
import { createApp } from '../../server/app';
import { ReportEngine, reportHash } from '../../src/clinical';
import { coreRight, multiProcedure } from '../fixtures';
import { CLINIC, JWT_SECRET, PATIENTS, USERS, describeDb, setupDb, token } from './harness';

const SURGEON = { full_name: 'Dr. Vinicios Barreto Melo', crm: '13416-ES' };
const tA = token(USERS.A, SURGEON);
const tB = token(USERS.B, { full_name: 'Dra. B' });
const tC = token(USERS.C, { full_name: 'Dr. C' });

describeDb('API (PostgreSQL real, RLS ativa)', () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  let app: Express;
  const as = (t: string) => ({
    get: (u: string) => request(app).get(u).set('Authorization', `Bearer ${t}`),
    post: (u: string, b?: object) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b ?? {}),
    put: (u: string, b?: object) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b ?? {}),
    patch: (u: string, b?: object) => request(app).patch(u).set('Authorization', `Bearer ${t}`).send(b ?? {}),
    del: (u: string) => request(app).delete(u).set('Authorization', `Bearer ${t}`)
  });
  const A = () => as(tA);
  const B = () => as(tB);

  beforeAll(async () => {
    ({ pool, teardown } = await setupDb());
    app = createApp({ pool, jwtSecret: JWT_SECRET });
  }, 30000);
  afterAll(async () => teardown?.());

  // ---------------- autenticação ----------------
  test('sem token / token inválido → 401; /health e /verify são públicos', async () => {
    expect((await request(app).get('/api/pathologies')).status).toBe(401);
    expect((await request(app).get('/api/pathologies').set('Authorization', 'Bearer x.y.z')).status).toBe(401);
    const forged = require('jsonwebtoken').sign({ sub: USERS.A, role: 'authenticated', aud: 'authenticated' }, 'outro-segredo-com-mais-de-32-caracteres!!');
    expect((await request(app).get('/api/pathologies').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/verify/' + 'f'.repeat(64))).status).toBe(404);
  });

  // ---------------- referência ----------------
  test('catálogo agrupado por mãe e filtrado por região', async () => {
    const r = await A().get('/api/pathologies?region=shoulder');
    expect(r.status).toBe(200);
    const rct = r.body.find((p: any) => p.code === 'SH_RCT');
    expect(rct.children.map((c: any) => c.code)).toContain('SH_RCT_FULL');
    expect(r.body.every((p: any) => p.region === 'shoulder')).toBe(true);
    expect((await A().get('/api/pathologies?region=knee')).status).toBe(400);
  });

  test('schemas, rótulos, instrumentos, estruturas', async () => {
    expect((await A().get('/api/schemas')).body).toContain('SH_RCT.intraop.v1');
    expect((await A().get('/api/schemas/SH_RCT.intraop.v1')).body.$id).toBe('SH_RCT.intraop.v1');
    expect((await A().get('/api/schemas/NAO_EXISTE')).status).toBe(404);
    expect((await A().get('/api/labels')).body).toHaveProperty('_default');
    expect((await A().get('/api/arthro-structures/elbow')).body).toHaveProperty('EL_RH');
    expect((await A().get('/api/instruments')).body.find((i: any) => i.code === 'ASES').license_status).toBe('pending');
  });

  // ---------------- ferramentas puras ----------------
  test('GS1 e métricas de instabilidade (guarda → 422)', async () => {
    const g = await A().post('/api/gs1/parse', { raw: '(01)00888867123458(17)281231(10)LOT-A77(21)SN0001' });
    expect(g.body).toMatchObject({ gtin: '00888867123458', lot: 'LOT-A77', expiry: '2028-12-31' });
    expect((await A().post('/api/gs1/parse', { raw: '(01)00888867123459' })).status).toBe(422);
    const m = await A().post('/api/instability/metrics', { bone: { D_mm: 28, d_mm: 4, hsi_mm: 20 }, isis: {} });
    expect(m.body).toMatchObject({ gt_mm: 19.2, track: 'off_track', outputs_are_recommendations: false });
    const bad = await A().post('/api/instability/metrics', { bone: { D_mm: 2.8, d_mm: 0.4 } });
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ error: 'CLINICAL_GUARD', field: 'D_mm' });
    expect((await A().get('/api/proms/schedule?surgery_date=2026-09-23')).body[0]).toMatchObject({ code: '6w', due: '2026-11-04' });
  });

  // ---------------- episódios ----------------
  let episodeId: string;
  test('cria episódio herdando dono/clínica do paciente; valida entrada', async () => {
    const base = { region: 'shoulder', side: 'R', affected_is_dominant: true, primary_pathology: 'SH_RCT', secondary_pathologies: ['SH_BICEPS', 'SH_AC_OA'], mechanism: 'degenerative', onset_date: '2026-01-10' };
    expect((await A().post(`/api/patients/${PATIENTS.A}/episodes`, { ...base, primary_pathology: 'EL_DBR' })).status).toBe(400);
    expect((await A().post(`/api/patients/${PATIENTS.A}/episodes`, { ...base, secondary_pathologies: ['SH_RCT'] })).status).toBe(400);
    const r = await A().post(`/api/patients/${PATIENTS.A}/episodes`, base);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ side: 'R', primary_pathology: 'SH_RCT', onset_date: '2026-01-10', status: 'open' });
    episodeId = r.body.id;
    const own = await pool.query(`SELECT owner_id, clinic_id FROM public.care_episode WHERE id = $1`, [episodeId]);
    expect(own.rows[0]).toEqual({ owner_id: USERS.A, clinic_id: CLINIC });
  });

  test('isolamento: B não lê, não altera nem cria em paciente de A (404)', async () => {
    expect((await B().get(`/api/episodes/${episodeId}`)).status).toBe(404);
    expect((await B().patch(`/api/episodes/${episodeId}`, { status: 'closed' })).status).toBe(404);
    expect((await B().get(`/api/patients/${PATIENTS.A}/episodes`)).body).toEqual([]);
    expect((await B().post(`/api/patients/${PATIENTS.A}/episodes`, { region: 'shoulder', side: 'R', affected_is_dominant: true, primary_pathology: 'SH_RCT' })).status).toBe(404);
    expect((await B().get(`/api/episodes/nao-uuid`)).status).toBe(404);
  });

  test('membro da clínica enxerga o episódio', async () => {
    expect((await as(tC).get(`/api/episodes/${episodeId}`)).status).toBe(200);
  });

  // ---------------- cirurgia ----------------
  let surgeryId: string;
  const procIds: Record<string, string> = {};
  test('lado divergente → 422 do trigger do banco', async () => {
    const r = await A().post(`/api/episodes/${episodeId}/surgeries`, { core: { ...coreRight, side: 'L' } });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('INTEGRITY_RULE');
  });

  test('rascunho aceita core incompleto e devolve pendências', async () => {
    const r = await A().post(`/api/episodes/${episodeId}/surgeries`, { core: { surgery_date: '2026-09-23', side: 'R' } });
    expect(r.status).toBe(201);
    expect(r.body.validation.valid).toBe(false);
    surgeryId = r.body.id;
    expect((await A().patch(`/api/surgeries/${surgeryId}`, { status: 'completed' })).status).toBe(422);
    const p = await A().patch(`/api/surgeries/${surgeryId}`, { core: coreRight });
    expect(p.body.validation).toEqual({ valid: true, issues: [] });
  });

  test('defaults vêm da última cirurgia do cirurgião', async () => {
    const d = await A().get('/api/surgeries/defaults');
    expect(d.body).toMatchObject({ positioning: 'beach_chair', antibiotic: coreRight.antibiotic });
    expect(d.body).not.toHaveProperty('surgery_date');
    expect((await B().get('/api/surgeries/defaults')).body).toEqual({});
  });

  test('procedimentos: fora do episódio bloqueado; N procedimentos na mesma cirurgia', async () => {
    const out = await A().post(`/api/surgeries/${surgeryId}/procedures`, { pathology_code: 'SH_INST_ANT', data: {} });
    expect(out.status).toBe(422);
    expect(out.body.message).toMatch(/não pertence ao episódio/);
    expect((await A().post(`/api/surgeries/${surgeryId}/procedures`, { pathology_code: 'SH_STIFF', data: {} })).body.error).toBe('NO_INTRAOP_SCHEMA');
    // insere fora de ordem de propósito e reordena depois
    for (const code of ['SH_AC_OA', 'SH_RCT_FULL', 'SH_BICEPS']) {
      const p = multiProcedure.procedures.find((x) => x.pathology_code === code)!;
      const r = await A().post(`/api/surgeries/${surgeryId}/procedures`, { pathology_code: code, data: p.data });
      expect(r.status).toBe(201);
      expect(r.body.validation.valid).toBe(true);
      procIds[code] = r.body.id;
    }
    const bad = await A().put(`/api/surgeries/${surgeryId}/procedures-order`, { ids: [procIds.SH_RCT_FULL] });
    expect(bad.status).toBe(400);
    const ord = await A().put(`/api/surgeries/${surgeryId}/procedures-order`, { ids: [procIds.SH_RCT_FULL, procIds.SH_BICEPS, procIds.SH_AC_OA] });
    expect(ord.status).toBe(204);
    const s = await A().get(`/api/surgeries/${surgeryId}`);
    expect(s.body.procedures.map((p: any) => [p.pathology_code, p.sequence])).toEqual([['SH_RCT_FULL', 1], ['SH_BICEPS', 2], ['SH_AC_OA', 3]]);
  });

  test('remover secundária em uso → 422', async () => {
    const r = await A().patch(`/api/episodes/${episodeId}`, { secondary_pathologies: ['SH_AC_OA'] });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('PATHOLOGY_IN_USE');
    expect((await A().patch(`/api/episodes/${episodeId}`, { side: 'L' })).status).toBe(400);
  });

  const map = [...multiProcedure.arthroscopic_map!, { structure_code: 'SA_BURSA', status: 'lesion' as const, finding_text: 'bursite' }];
  test('mapa artroscópico valida estrutura da região', async () => {
    expect((await A().put(`/api/surgeries/${surgeryId}/arthroscopic-map`, { entries: [{ structure_code: 'EL_RH', status: 'normal' }] })).status).toBe(400);
    expect((await A().put(`/api/surgeries/${surgeryId}/arthroscopic-map`, { entries: map })).body).toEqual({ count: map.length });
  });

  test('implantes: novo item de catálogo privado, leitura GS1 preenche lote/validade', async () => {
    for (const imp of multiProcedure.implants!) {
      const r = await A().post(`/api/surgeries/${surgeryId}/implants`, {
        new_catalog_item: { category: 'anchor', manufacturer: imp.manufacturer, model: imp.model },
        lot: imp.lot, quantity: imp.quantity, location: imp.location
      });
      expect(r.status).toBe(201);
    }
    const scan = await A().post(`/api/surgeries/${surgeryId}/implants`, {
      new_catalog_item: { category: 'screw', manufacturer: 'Fabricante C', model: 'Parafuso' },
      raw_barcode: '(01)00888867123458(17)281231(10)LOT-A77(21)SN0001', procedure_id: procIds.SH_BICEPS
    });
    expect(scan.body).toMatchObject({ lot: 'LOT-A77', serial: 'SN0001', expiry: '2028-12-31', raw_barcode: expect.stringContaining('(01)') });
    const cat = await A().get('/api/implant-catalog?gtin=00888867123458');
    expect(cat.body).toHaveLength(1);
    expect(cat.body[0].private).toBe(true);
    expect((await B().get('/api/implant-catalog?gtin=00888867123458')).body).toEqual([]);
    expect((await A().del(`/api/surgeries/${surgeryId}/implants/${scan.body.id}`)).status).toBe(204);
  });

  // ---------------- relatório ----------------
  let reportId: string;
  test('procedimento inválido impede gerar relatório', async () => {
    const put = await A().put(`/api/surgeries/${surgeryId}/procedures/${procIds.SH_AC_OA}`, { data: { resection_mm: 7.5 } });
    expect(put.body.validation.valid).toBe(false);
    const g = await A().post(`/api/surgeries/${surgeryId}/report/generate`);
    expect(g.status).toBe(422);
    expect(g.body.details[0].scope).toBe('procedure#3:SH_AC_OA');
    const p = multiProcedure.procedures.find((x) => x.pathology_code === 'SH_AC_OA')!;
    await A().put(`/api/surgeries/${surgeryId}/procedures/${procIds.SH_AC_OA}`, { data: p.data });
  });

  test('não-cirurgião (membro da clínica) não gera; B recebe 404', async () => {
    expect((await as(tC).post(`/api/surgeries/${surgeryId}/report/generate`)).status).toBe(403);
    expect((await B().post(`/api/surgeries/${surgeryId}/report/generate`)).status).toBe(404);
  });

  test('gera relatório idêntico ao motor aplicado aos mesmos dados', async () => {
    const g = await A().post(`/api/surgeries/${surgeryId}/report/generate`, { postop_plan: multiProcedure.postop_plan });
    expect(g.status).toBe(201);
    reportId = g.body.id;
    const expected = new ReportEngine().generate({
      ...multiProcedure,
      patient: { name: 'Paciente Teste' },
      surgeon: { name: SURGEON.full_name, crm: SURGEON.crm },
      arthroscopic_map: map,
      implants: multiProcedure.implants!.map(({ size, ...i }) => i)
    });
    expect(g.body.generated_text).toBe(expected.text);
    expect(g.body.final_text).toBe(expected.text);
    expect(g.body.version).toBe(1);
    expect(g.body.template_versions).toEqual({ SH_RCT_FULL: 1, SH_BICEPS: 1, SH_AC_OA: 1 });
  });

  test('edição do médico gera diff; regenerar exige force', async () => {
    const r0 = (await A().get(`/api/reports/${reportId}`)).body;
    const edited = r0.final_text.replace('PROCEDIMENTOS', 'PROCEDIMENTOS REALIZADOS');
    const p = await A().patch(`/api/reports/${reportId}`, { final_text: edited });
    expect(p.body.diff_from_generated).toEqual([{ op: '-', line: 'PROCEDIMENTOS' }, { op: '+', line: 'PROCEDIMENTOS REALIZADOS' }]);
    expect((await A().post(`/api/surgeries/${surgeryId}/report/generate`)).status).toBe(409);
    expect((await A().patch(`/api/reports/${reportId}`, { final_text: '' })).status).toBe(400);
  });

  test('assinatura: aviso exige confirmação; hash confere; verificação pública', async () => {
    const pre = await A().get(`/api/reports/${reportId}`);
    expect(pre.body.checklist.canSign).toBe(true);
    expect(pre.body.checklist.issues.map((i: any) => i.rule)).toEqual(['LESION_WITHOUT_ACTION']);
    expect((await as(tC).post(`/api/reports/${reportId}/sign`, { confirm_warnings: true })).status).toBe(403);
    const w = await A().post(`/api/reports/${reportId}/sign`);
    expect(w.status).toBe(409);
    expect(w.body.error).toBe('PRESIGN_WARNINGS');

    const s = await A().post(`/api/reports/${reportId}/sign`, { confirm_warnings: true });
    expect(s.status).toBe(200);
    const rep = s.body.report;
    expect(rep.signed_by).toBe(USERS.A);
    expect(rep.content_hash).toBe(reportHash({ surgery_id: surgeryId, version: 1, template_versions: rep.template_versions, final_text: rep.final_text, signed_by: USERS.A, signed_at: new Date(rep.signed_at).toISOString() }));
    expect(s.body.prom_schedule.map((t: any) => t.code)).toEqual(['6w', '3m', '6m', '12m', '24m']);

    expect((await A().get(`/api/reports/${reportId}/integrity`)).body).toMatchObject({ signed: true, intact: true });
    const v = await request(app).get(`/verify/${rep.content_hash}`);
    expect(v.body).toEqual({ valid: true, signed_at: expect.any(String), superseded: false });
    expect(JSON.stringify(v.body)).not.toMatch(/Paciente|manguito/);
    expect((await A().get(`/api/surgeries/${surgeryId}`)).body.status).toBe('signed');
  });

  test('após assinar: tudo travado (409), relatório imutável', async () => {
    expect((await A().post(`/api/reports/${reportId}/sign`, { confirm_warnings: true })).status).toBe(409);
    expect((await A().patch(`/api/reports/${reportId}`, { final_text: 'x' })).status).toBe(409);
    expect((await A().put(`/api/surgeries/${surgeryId}/procedures/${procIds.SH_BICEPS}`, { data: {} })).status).toBe(409);
    expect((await A().post(`/api/surgeries/${surgeryId}/procedures`, { pathology_code: 'SH_BICEPS', data: {} })).status).toBe(409);
    expect((await A().put(`/api/surgeries/${surgeryId}/arthroscopic-map`, { entries: [] })).status).toBe(409);
    expect((await A().patch(`/api/surgeries/${surgeryId}`, { status: 'draft' })).status).toBe(409);
  });

  test('adulteração direta no banco é detectada pela integridade', async () => {
    // simula ataque com privilégio de superusuário desabilitando o trigger
    await pool.query(`ALTER TABLE public.surgical_report DISABLE TRIGGER surgical_report_immutable_trg`);
    await pool.query(`UPDATE public.surgical_report SET final_text = final_text || 'X' WHERE id = $1`, [reportId]);
    expect((await A().get(`/api/reports/${reportId}/integrity`)).body.intact).toBe(false);
    await pool.query(`UPDATE public.surgical_report SET final_text = left(final_text, -1) WHERE id = $1`, [reportId]);
    await pool.query(`ALTER TABLE public.surgical_report ENABLE TRIGGER surgical_report_immutable_trg`);
    expect((await A().get(`/api/reports/${reportId}/integrity`)).body.intact).toBe(true);
  });

  test('correção pós-assinatura = nova versão com supersedes', async () => {
    const g = await A().post(`/api/surgeries/${surgeryId}/report/generate`, { postop_plan: 'Plano corrigido.' });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ version: 2, supersedes: reportId });
    const oldHash = (await A().get(`/api/reports/${reportId}`)).body.content_hash;
    expect((await A().post(`/api/reports/${reportId}/sign`)).status).toBe(409);
    const s = await A().post(`/api/reports/${g.body.id}/sign`, { confirm_warnings: true });
    expect(s.status).toBe(200);
    expect(s.body.prom_schedule).toEqual([]);
    expect((await request(app).get(`/verify/${oldHash}`)).body.superseded).toBe(true);
    expect((await A().get(`/api/surgeries/${surgeryId}`)).body.status).toBe('amended');
  });

  test('B não lê relatório de A', async () => {
    expect((await B().get(`/api/reports/${reportId}`)).status).toBe(404);
    expect((await B().get(`/api/reports/${reportId}/integrity`)).status).toBe(404);
  });

  // ---------------- PROMs ----------------
  test('PROMs: Constant sem força em série separada; ASES bloqueado por licença', async () => {
    const full = { pain: 15, sleep: 2, work: 4, recreation: 4, hand_position: 'above_head', flexion_deg: 170, abduction_deg: 170, er_achieved: ['hand_behind_head_elbow_forward', 'hand_behind_head_elbow_back', 'hand_on_head_elbow_forward', 'hand_on_head_elbow_back', 'full_elevation_from_head'], ir_position: 'interscapular_T7' };
    const c1 = await A().post(`/api/episodes/${episodeId}/proms`, { instrument: 'CONSTANT', timepoint: 'preop', answers: { ...full, strength_kg: 12 } });
    expect(c1.status).toBe(201);
    expect(c1.body).toMatchObject({ score: 100, score_max: 100 });
    const c2 = await A().post(`/api/episodes/${episodeId}/proms`, { instrument: 'CONSTANT', timepoint: '6w', answers: full });
    expect(c2.body).toMatchObject({ score: 75, score_max: 75, flags: ['constant_no_strength'] });
    expect((await A().post(`/api/episodes/${episodeId}/proms`, { instrument: 'ASES', timepoint: 'preop', answers: { pain_vas: 0, adl: Array(10).fill(3) } })).body.error).toBe('INSTRUMENT_NOT_LICENSED');
    expect((await A().post(`/api/episodes/${episodeId}/proms`, { instrument: 'SANE', timepoint: '3m', answers: { value: 101 } })).status).toBe(422);
    expect((await B().post(`/api/episodes/${episodeId}/proms`, { instrument: 'SANE', timepoint: '3m', answers: { value: 80 } })).status).toBe(404);
    const list = await A().get(`/api/episodes/${episodeId}/proms`);
    const constant = list.body.series.filter((s: any) => s.instrument === 'CONSTANT');
    expect(constant.map((s: any) => s.max).sort()).toEqual([100, 75]);
    expect(constant.every((s: any) => s.points.length === 1)).toBe(true);
  });
});

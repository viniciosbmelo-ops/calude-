import request from 'supertest';
import type { Express } from 'express';
import { Pool } from 'pg';
import { createApp, devUserId } from '../../server/app';
import { coreRight, multiProcedure } from '../fixtures';
import { JWT_SECRET, PATIENTS, USERS, describeDb, setupDb, token } from './harness';

const tA = token(USERS.A, { full_name: 'Dr. A', crm: '1-ES' });
const tB = token(USERS.B, { full_name: 'Dra. B' });

describeDb('API — recursos do app', () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  let app: Express;
  const as = (t: string) => ({
    get: (u: string) => request(app).get(u).set('Authorization', `Bearer ${t}`),
    post: (u: string, b?: object) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b ?? {}),
    patch: (u: string, b?: object) => request(app).patch(u).set('Authorization', `Bearer ${t}`).send(b ?? {}),
    put: (u: string, b?: object) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b ?? {}),
    del: (u: string) => request(app).delete(u).set('Authorization', `Bearer ${t}`)
  });
  const A = () => as(tA);
  const B = () => as(tB);

  beforeAll(async () => {
    ({ pool, teardown } = await setupDb());
    app = createApp({ pool, jwtSecret: JWT_SECRET, devLogin: true, publicBaseUrl: 'https://app.exemplo' });
  }, 30000);
  afterAll(async () => teardown?.());

  test('login de desenvolvimento emite token utilizável; config pública', async () => {
    expect((await request(app).get('/api/public/config')).body).toEqual({ auth: 'dev' });
    expect((await request(app).post('/api/public/dev-login').send({ email: 'x' })).status).toBe(400);
    const r = await request(app).post('/api/public/dev-login').send({ email: 'Dr@Exemplo.com', full_name: 'Dr. Dev', crm: '9-ES' });
    expect(r.body.user_id).toBe(devUserId('dr@exemplo.com'));
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${r.body.access_token}`);
    expect(me.body).toMatchObject({ full_name: 'Dr. Dev', crm: '9-ES', email: 'Dr@Exemplo.com' });
    const off = createApp({ pool, jwtSecret: JWT_SECRET });
    expect((await request(off).post('/api/public/dev-login').send({ email: 'a@b.c', full_name: 'Dr X' })).status).toBe(401);
  });

  test('pacientes: cria, busca, isolamento', async () => {
    expect((await A().post('/api/patients', { name: 'x' })).status).toBe(400);
    const p = await A().post('/api/patients', { name: 'Maria da Silva', record_number: 'PR-77', birth_date: '1980-05-02', sex: 'F' });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ name: 'Maria da Silva', record_number: 'PR-77', birth_date: '1980-05-02', sex: 'F' });
    expect((await A().get('/api/patients?q=maria')).body.map((x: any) => x.id)).toEqual([p.body.id]);
    expect((await A().get('/api/patients?q=PR-77')).body).toHaveLength(1);
    expect((await B().get(`/api/patients/${p.body.id}`)).status).toBe(404);
    expect((await B().get('/api/patients?q=maria')).body).toEqual([]);
    expect((await A().get('/api/patients')).body.length).toBeGreaterThanOrEqual(2);
  });

  test('protocolos: CRUD só do dono', async () => {
    expect((await A().post('/api/protocols', { code: 'bad code', title: 'X', body: 'y' })).status).toBe(400);
    const p = await A().post('/api/protocols', { code: 'PROT_RCR_STANDARD', title: 'Reparo do manguito', body: 'Texto escrito pelo cirurgião.' });
    expect(p.status).toBe(201);
    expect((await A().post('/api/protocols', { code: 'PROT_RCR_STANDARD', title: 'Dup', body: 'z' })).status).toBe(409);
    expect((await B().get('/api/protocols')).body).toEqual([]);
    expect((await B().patch(`/api/protocols/${p.body.id}`, { title: 'hack' })).status).toBe(404);
    expect((await A().patch(`/api/protocols/${p.body.id}`, { title: 'Reparo do manguito (v2)' })).body.title).toBe('Reparo do manguito (v2)');
    expect((await B().del(`/api/protocols/${p.body.id}`)).status).toBe(404);
    expect((await A().del(`/api/protocols/${p.body.id}`)).status).toBe(204);
  });

  let episodeId: string;
  test('avaliação diagnóstica validada pelo schema', async () => {
    const e = await A().post(`/api/patients/${PATIENTS.A}/episodes`, { region: 'shoulder', side: 'R', affected_is_dominant: true, primary_pathology: 'SH_INST_ANT' });
    episodeId = e.body.id;
    const bad = await A().post(`/api/episodes/${episodeId}/assessments`, { kind: 'diagnosis', schema_id: 'SH_INST_ANT.diagnosis.v1', data: { event_type: 'dislocation', episodes: 'first', ct_available: true } });
    expect(bad.status).toBe(422);
    expect(bad.body.details.map((i: any) => i.field).sort()).toEqual(['D_mm', 'd_mm']);
    const ok = await A().post(`/api/episodes/${episodeId}/assessments`, { kind: 'diagnosis', schema_id: 'SH_INST_ANT.diagnosis.v1', pathology_code: 'SH_INST_ANT', data: { event_type: 'dislocation', episodes: 'first', ct_available: true, D_mm: 28, d_mm: 4 } });
    expect(ok.status).toBe(201);
    expect((await A().get(`/api/episodes/${episodeId}/assessments`)).body).toHaveLength(1);
    expect((await B().get(`/api/episodes/${episodeId}/assessments`)).status).toBe(404);
  });

  test('PROM por link: só instrumento do paciente; token de uso único; escore no servidor', async () => {
    expect((await A().post(`/api/episodes/${episodeId}/prom-invites`, { instrument: 'CONSTANT', timepoint: 'preop' })).body.error).toBe('NOT_PATIENT_INSTRUMENT');
    expect((await A().post(`/api/episodes/${episodeId}/prom-invites`, { instrument: 'ASES', timepoint: 'preop' })).body.error).toBe('NOT_PATIENT_INSTRUMENT');
    expect((await B().post(`/api/episodes/${episodeId}/prom-invites`, { instrument: 'SANE', timepoint: 'preop' })).status).toBe(404);
    const inv = await A().post(`/api/episodes/${episodeId}/prom-invites`, { instrument: 'SANE', timepoint: 'preop' });
    expect(inv.status).toBe(201);
    expect(inv.body.url).toMatch(/^https:\/\/app\.exemplo\/p\/[A-Za-z0-9_-]{43}$/);
    const tok = inv.body.url.split('/p/')[1];
    const stored = await pool.query(`SELECT token_hash FROM public.prom_invite WHERE id = $1`, [inv.body.id]);
    expect(stored.rows[0].token_hash).not.toContain(tok);

    const info = await request(app).get(`/api/public/prom/${tok}`);
    expect(info.body).toMatchObject({ instrument: 'SANE', timepoint: 'preop', status: 'open' });
    expect(JSON.stringify(info.body)).not.toMatch(/Paciente/);
    expect((await request(app).post(`/api/public/prom/${tok}`).send({ answers: { value: 101 } })).status).toBe(422);
    const sub = await request(app).post(`/api/public/prom/${tok}`).send({ answers: { value: 85 } });
    expect(sub.status).toBe(201);
    expect(sub.body).toEqual({ ok: true });
    expect((await request(app).post(`/api/public/prom/${tok}`).send({ answers: { value: 10 } })).status).toBe(410);
    expect((await request(app).get(`/api/public/prom/${'x'.repeat(43)}`)).status).toBe(404);

    const proms = (await A().get(`/api/episodes/${episodeId}/proms`)).body.responses;
    expect(proms).toEqual([expect.objectContaining({ instrument: 'SANE', score: 85, respondent: 'patient' })]);
    const list = (await A().get(`/api/episodes/${episodeId}/prom-invites`)).body;
    expect(list[0].status).toBe('used');
    expect((await A().del(`/api/prom-invites/${inv.body.id}`)).status).toBe(404); // usado não se apaga

    // convite expirado
    const old = await A().post(`/api/episodes/${episodeId}/prom-invites`, { instrument: 'SANE', timepoint: '6w' });
    await pool.query(`UPDATE public.prom_invite SET created_at = now() - interval '2 day', expires_at = now() - interval '1 day' WHERE id = $1`, [old.body.id]);
    expect((await request(app).post(`/api/public/prom/${old.body.url.split('/p/')[1]}`).send({ answers: { value: 50 } })).body.error).toBe('INVITE_EXPIRED');
  });

  test('role pública não lê tabelas clínicas diretamente', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN; SET LOCAL ROLE docsholder_public');
      await expect(c.query('SELECT * FROM public.prom_response')).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    const d = await pool.connect();
    try {
      await d.query('BEGIN; SET LOCAL ROLE anon');
      await expect(d.query(`SELECT * FROM public.prom_invite_info('${'0'.repeat(64)}')`)).rejects.toThrow(/permission denied/);
    } finally {
      await d.query('ROLLBACK');
      d.release();
    }
  });

  test('PDF: rascunho com marca d’água; assinado com QR; página de verificação HTML', async () => {
    const e = await A().post(`/api/patients/${PATIENTS.A}/episodes`, { region: 'shoulder', side: 'R', affected_is_dominant: true, primary_pathology: 'SH_RCT', secondary_pathologies: ['SH_BICEPS', 'SH_AC_OA'] });
    const s = await A().post(`/api/episodes/${e.body.id}/surgeries`, { core: coreRight });
    for (const p of multiProcedure.procedures) await A().post(`/api/surgeries/${s.body.id}/procedures`, { pathology_code: p.pathology_code, data: p.data });
    const g = await A().post(`/api/surgeries/${s.body.id}/report/generate`);
    expect(g.status).toBe(201);
    const draft = await A().get(`/api/reports/${g.body.id}/pdf`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(draft.status).toBe(200);
    expect(draft.headers['content-type']).toBe('application/pdf');
    expect((draft.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(draft.headers['content-disposition']).toMatch(/rascunho/);

    const signed = await A().post(`/api/reports/${g.body.id}/sign`, { confirm_warnings: true });
    expect(signed.status).toBe(200);
    const pdf = await A().get(`/api/reports/${g.body.id}/pdf`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).length).toBeGreaterThan(5000);
    expect((await B().get(`/api/reports/${g.body.id}/pdf`)).status).toBe(404);

    const html = await request(app).get(`/verify/${signed.body.report.content_hash}`).set('Accept', 'text/html');
    expect(html.headers['content-type']).toMatch(/html/);
    expect(html.text).toContain('Assinatura válida');
    expect(html.text).not.toMatch(/Paciente|manguito/);
    const miss = await request(app).get(`/verify/${'0'.repeat(64)}`).set('Accept', 'text/html');
    expect(miss.status).toBe(404);
    expect(miss.text).toContain('não encontrado');
    expect((await A().get(`/api/surgeries/${s.body.id}/reports`)).body).toEqual([expect.objectContaining({ version: 1, edited: false })]);
  });

  test('cabeçalhos de segurança', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-security-policy']).toMatch(/script-src 'self'/);
    expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  });
});

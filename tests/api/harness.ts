/**
 * Banco real descartável para testes de API. Requer TEST_PGURL apontando para um servidor
 * PostgreSQL 15+ com usuário superusuário (cria/derruba um banco próprio por execução).
 * Sem TEST_PGURL, as suítes de API são puladas.
 */
import * as fs from 'fs';
import * as path from 'path';
import jwt from 'jsonwebtoken';
import { Client, Pool } from 'pg';

export const PGURL = process.env.TEST_PGURL;
export const JWT_SECRET = 'test-secret-with-at-least-32-characters!!';
export const describeDb = PGURL ? describe : describe.skip;

const ROOT = path.join(__dirname, '..', '..');
const sql = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

export const USERS = {
  A: 'aaaaaaaa-0000-0000-0000-000000000001',
  B: 'bbbbbbbb-0000-0000-0000-000000000002',
  C: 'cccccccc-0000-0000-0000-000000000003' // membro da clínica de A, não é o cirurgião
};
export const CLINIC = 'c1c1c1c1-0000-0000-0000-000000000001';
export const PATIENTS = { A: '11111111-0000-0000-0000-000000000001', B: '22222222-0000-0000-0000-000000000002' };

export function token(sub: string, meta: Record<string, unknown> = {}): string {
  return jwt.sign({ sub, role: 'authenticated', aud: 'authenticated', user_metadata: meta }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

export async function setupDb(): Promise<{ pool: Pool; teardown: () => Promise<void> }> {
  const dbName = `dh_api_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: PGURL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(PGURL!);
  url.pathname = `/${dbName}`;
  const pool = new Pool({ connectionString: url.toString(), max: 5 });

  const c = await pool.connect();
  try {
    await c.query(`DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await c.query(sql('db/test/000_supabase_stub.sql'));
    await c.query(sql('db/migrations/001_docsholder_core.sql'));
    await c.query(sql('db/seeds/002_pathology_catalog.sql'));
    await c.query(sql('db/migrations/003_api_support.sql'));
    // Equivalente aos GRANTs padrão do Supabase
    await c.query(`GRANT USAGE ON SCHEMA public TO authenticated, anon; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
    await c.query(`INSERT INTO public.patient(id, owner_id, clinic_id, name) VALUES ($1,$2,$3,'Paciente Teste'), ($4,$5,NULL,'Paciente B')`, [PATIENTS.A, USERS.A, CLINIC, PATIENTS.B, USERS.B]);
    await c.query(`INSERT INTO public.clinic_member(clinic_id, user_id, role, active) VALUES ($1,$2,'surgeon',true)`, [CLINIC, USERS.C]);
  } finally {
    c.release();
  }

  return {
    pool,
    teardown: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.end();
    }
  };
}

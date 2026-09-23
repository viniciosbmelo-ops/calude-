import * as path from 'path';
import { Pool } from 'pg';
import { createApp } from './app';

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
const secret = process.env.SUPABASE_JWT_SECRET;
if (!url || !secret) fail('Defina DATABASE_URL e SUPABASE_JWT_SECRET.');
const devLogin = process.env.DEV_LOGIN === '1';
if (devLogin && process.env.NODE_ENV === 'production') fail('DEV_LOGIN=1 é proibido com NODE_ENV=production.');
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY } : undefined;
if (!supabase && !devLogin) fail('Configure SUPABASE_URL e SUPABASE_ANON_KEY (ou DEV_LOGIN=1 em desenvolvimento).');

const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
const port = Number(process.env.PORT ?? 3000);
createApp({
  pool,
  jwtSecret: secret,
  devLogin,
  supabase,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  webDist: path.join(__dirname, '..', 'web', 'dist')
}).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`DocSholder em :${port}${devLogin ? ' (LOGIN DE DESENVOLVIMENTO ATIVO)' : ''}`);
});

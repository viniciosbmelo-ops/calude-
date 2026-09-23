/**
 * Acesso ao banco com a MESMA semântica do PostgREST/Supabase:
 * cada request roda numa transação com `SET LOCAL ROLE authenticated` e o `sub` do JWT
 * em `request.jwt.claim.sub` / `request.jwt.claims`, de modo que auth.uid() e a RLS valem.
 * Nunca usar service_role nas rotas de usuário.
 */
import { Pool, PoolClient } from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthUser {
  id: string;
  claims: Record<string, unknown>;
}

export type Db = PoolClient;

export async function withUser<T>(pool: Pool, user: AuthUser, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(user.id)) throw new Error('sub do JWT não é UUID');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`,
      [user.id, JSON.stringify({ ...user.claims, sub: user.id, role: 'authenticated' })]
    );
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Transação anônima (role anon) — usada só pela rota pública de verificação. */
export async function withAnon<T>(pool: Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE anon');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Per-account login lockout, persisted in PostgreSQL (auth_lockouts) so it
 * holds across instances. Complements the per-IP limiter: a distributed
 * brute-force against one account (many IPs) still locks that account.
 *
 *   MAX_FAILURES failed logins inside WINDOW_MS → locked for LOCK_MS.
 *
 * The key is SHA-256("<role>:<normalized identifier>"): unknown and known
 * accounts behave the same (no enumeration) and no e-mail/CPF is stored.
 */
import { createHash } from "node:crypto";
import { pool } from "@workspace/docregen-db";

export const ACCOUNT_LOCKOUT = {
  MAX_FAILURES: 10,
  WINDOW_MS: 15 * 60 * 1000,
  LOCK_MS: 15 * 60 * 1000,
} as const;

export type LockoutRole = "doctor" | "secretary";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function lockKey(role: LockoutRole, identifier: string): string {
  return createHash("sha256").update(`${role}:${normalizeEmail(identifier)}`).digest("hex");
}

/** Remaining lock time in ms (0 when the account is not locked). */
export async function accountLockRemainingMs(role: LockoutRole, identifier: string): Promise<number> {
  const { rows } = await pool.query<{ locked_until: Date | null }>(
    `SELECT locked_until FROM auth_lockouts WHERE key_hash = $1`,
    [lockKey(role, identifier)],
  );
  const lockedUntil = rows[0]?.locked_until;
  if (!lockedUntil) return 0;
  return Math.max(0, new Date(lockedUntil).getTime() - Date.now());
}

/** Records one failed login; returns the remaining lock time (0 if not locked yet). */
export async function recordAccountFailure(role: LockoutRole, identifier: string): Promise<number> {
  const { rows } = await pool.query<{ locked_until: Date | null }>(
    `INSERT INTO auth_lockouts (key_hash, failures, window_started_at, locked_until, updated_at)
     VALUES ($1, 1, now(), NULL, now())
     ON CONFLICT (key_hash) DO UPDATE SET
       failures = CASE
         WHEN auth_lockouts.window_started_at <= now() - ($2 || ' milliseconds')::interval
           OR (auth_lockouts.locked_until IS NOT NULL AND auth_lockouts.locked_until <= now())
         THEN 1 ELSE auth_lockouts.failures + 1 END,
       window_started_at = CASE
         WHEN auth_lockouts.window_started_at <= now() - ($2 || ' milliseconds')::interval
           OR (auth_lockouts.locked_until IS NOT NULL AND auth_lockouts.locked_until <= now())
         THEN now() ELSE auth_lockouts.window_started_at END,
       locked_until = CASE
         WHEN auth_lockouts.locked_until IS NOT NULL AND auth_lockouts.locked_until > now()
           THEN auth_lockouts.locked_until
         WHEN auth_lockouts.window_started_at > now() - ($2 || ' milliseconds')::interval
          AND (auth_lockouts.locked_until IS NULL OR auth_lockouts.locked_until > now())
          AND auth_lockouts.failures + 1 >= $3
           THEN now() + ($4 || ' milliseconds')::interval
         ELSE NULL END,
       updated_at = now()
     RETURNING locked_until`,
    [
      lockKey(role, identifier),
      String(ACCOUNT_LOCKOUT.WINDOW_MS),
      ACCOUNT_LOCKOUT.MAX_FAILURES,
      String(ACCOUNT_LOCKOUT.LOCK_MS),
    ],
  );
  const lockedUntil = rows[0]?.locked_until;
  return lockedUntil ? Math.max(0, new Date(lockedUntil).getTime() - Date.now()) : 0;
}

export async function clearAccountFailures(role: LockoutRole, identifier: string): Promise<void> {
  await pool.query(`DELETE FROM auth_lockouts WHERE key_hash = $1`, [lockKey(role, identifier)]);
}

export function lockoutMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${minutes} minuto${minutes === 1 ? "" : "s"}.`;
}

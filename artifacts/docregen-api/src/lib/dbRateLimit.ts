/**
 * Database-backed rate limiting (shared by every API instance, so limits hold
 * under autoscale). Two entry points:
 *   - consumeRateLimit(): imperative check used by per-doctor limits (AI
 *     summaries, WhatsApp sends);
 *   - PostgresRateLimitStore: an express-rate-limit Store for the per-IP
 *     limiters (auth, registration, password reset).
 *
 * Fixed windows in rate_limit_buckets; keys are namespaced and never carry an
 * e-mail, CPF or link token in clear.
 */
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { pool } from "@workspace/docregen-db";

export interface RateLimitResult {
  allowed: boolean;
  hits: number;
  limit: number;
  resetAt: Date;
}

async function incrementBucket(key: string, windowMs: number): Promise<{ hits: number; resetAt: Date }> {
  const { rows } = await pool.query<{ hits: number; reset_at: Date }>(
    `INSERT INTO rate_limit_buckets (key, hits, reset_at)
     VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1 ELSE rate_limit_buckets.hits + 1 END,
       reset_at = CASE WHEN rate_limit_buckets.reset_at <= now()
                       THEN now() + ($2 || ' milliseconds')::interval
                       ELSE rate_limit_buckets.reset_at END
     RETURNING hits, reset_at`,
    [key, String(Math.max(1, Math.round(windowMs)))],
  );
  maybePurgeExpiredBuckets();
  return { hits: Number(rows[0]!.hits), resetAt: new Date(rows[0]!.reset_at) };
}

let lastPurgeAt = 0;
function maybePurgeExpiredBuckets(): void {
  const now = Date.now();
  if (now - lastPurgeAt < 10 * 60 * 1000) return;
  lastPurgeAt = now;
  void pool
    .query(`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 day'`)
    .catch(() => undefined);
}

/**
 * Counts one hit for `key` and reports whether it is still within `limit`
 * for the current window.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { hits, resetAt } = await incrementBucket(key, windowMs);
  return { allowed: hits <= limit, hits, limit, resetAt };
}

/** Seconds until `resetAt` (at least 1), for Retry-After headers. */
export function retryAfterSeconds(resetAt: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
}

/** express-rate-limit store persisted in PostgreSQL. */
export class PostgresRateLimitStore implements Store {
  windowMs = 60_000;
  readonly localKeys = false;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await pool.query<{ hits: number; reset_at: Date }>(
      `SELECT hits, reset_at FROM rate_limit_buckets WHERE key = $1 AND reset_at > now()`,
      [this.key(key)],
    );
    if (!rows.length) return undefined;
    return { totalHits: Number(rows[0]!.hits), resetTime: new Date(rows[0]!.reset_at) };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { hits, resetAt } = await incrementBucket(this.key(key), this.windowMs);
    return { totalHits: hits, resetTime: resetAt };
  }

  async decrement(key: string): Promise<void> {
    await pool.query(
      `UPDATE rate_limit_buckets SET hits = GREATEST(hits - 1, 0) WHERE key = $1`,
      [this.key(key)],
    );
  }

  async resetKey(key: string): Promise<void> {
    await pool.query(`DELETE FROM rate_limit_buckets WHERE key = $1`, [this.key(key)]);
  }
}

/**
 * Rate limiters are disabled under NODE_ENV=test (every E2E request comes
 * from 127.0.0.1) unless a test opts in with DOCREGEN_ENFORCE_RATE_LIMITS=1.
 */
export function rateLimitsDisabled(): boolean {
  return process.env["NODE_ENV"] === "test" && process.env["DOCREGEN_ENFORCE_RATE_LIMITS"] !== "1";
}

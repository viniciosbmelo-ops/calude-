import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * PostgreSQL connection pool with explicit resource limits and timeouts.
 *
 * Defaults are conservative for a single-server Node.js API; adjust via env:
 *   DB_POOL_MAX          — max concurrent connections (default: 10)
 *   DB_POOL_MIN          — min idle connections kept open (default: 2)
 *   DB_CONN_TIMEOUT_MS   — ms to wait for a free connection (default: 10 000)
 *   DB_IDLE_TIMEOUT_MS   — ms before an idle connection is closed (default: 30 000)
 *   DB_STMT_TIMEOUT_MS   — server-side statement timeout in ms (default: 30 000)
 */
const poolMax = Math.max(1, Number(process.env["DB_POOL_MAX"] ?? 10));
const poolMin = Math.max(0, Number(process.env["DB_POOL_MIN"] ?? 2));
const connectionTimeoutMs = Number(process.env["DB_CONN_TIMEOUT_MS"] ?? 10_000);
const idleTimeoutMs = Number(process.env["DB_IDLE_TIMEOUT_MS"] ?? 30_000);
const statementTimeoutMs = Number(process.env["DB_STMT_TIMEOUT_MS"] ?? 30_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  min: poolMin,
  connectionTimeoutMillis: connectionTimeoutMs,
  idleTimeoutMillis: idleTimeoutMs,
  // Sends SET statement_timeout once per connection on first use.
  // Guards against slow queries hanging the event loop.
  options: `--statement_timeout=${statementTimeoutMs}`,
});

// ── Pool-level error monitoring ───────────────────────────────────────────────

pool.on("error", (err: Error) => {
  // Idle-client errors (e.g. unexpected disconnection from Postgres) are
  // non-fatal to the process but must be observable. We write to stderr so
  // the log aggregator always captures them even if the pino logger is not yet
  // initialised (e.g. during startup).
  const entry = {
    level: "error",
    event: "pg_pool_error",
    errCode: (err as NodeJS.ErrnoException).code ?? null,
    errMessage: err.message,
    ts: new Date().toISOString(),
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
});

pool.on("connect", () => {
  // Logged at debug level — useful when diagnosing connection exhaustion.
  if (process.env["NODE_ENV"] !== "production") {
    process.stderr.write(
      JSON.stringify({ level: "debug", event: "pg_pool_connect", total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, ts: new Date().toISOString() }) + "\n",
    );
  }
});

export const db = drizzle(pool, { schema });

export * from "./schema";

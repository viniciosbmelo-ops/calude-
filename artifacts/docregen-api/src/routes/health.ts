import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/docregen-api-zod";
import { pool } from "@workspace/docregen-db";

const router: IRouter = Router();

/**
 * GET /healthz — liveness: the process answers. Cheap, no I/O; use it for
 * the hosting platform's health check so a database blip does not restart
 * healthy instances.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export const READINESS_TIMEOUT_MS = 2_000;

/** Runs `SELECT 1`, failing after `timeoutMs`. */
export async function databaseReady(timeoutMs = READINESS_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const probe = pool.query("SELECT 1").then(() => true);
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    return await Promise.race([probe.catch(() => false), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GET /readyz — readiness: the database answers `SELECT 1` within 2 s.
 * 503 otherwise. Use it for load-balancer readiness / uptime monitoring.
 */
router.get("/readyz", async (_req, res) => {
  const ready = await databaseReady();
  res.setHeader("Cache-Control", "no-store");
  res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable", database: ready ? "ok" : "unreachable" });
});

export default router;

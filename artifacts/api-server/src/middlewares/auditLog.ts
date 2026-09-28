import { createHash } from "node:crypto";
import { type Request, type Response, type NextFunction } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// Fields whose values are always redacted, at any nesting depth
const SENSITIVE_FIELDS = new Set([
  "senha", "password", "senhaHash", "passwordHash", "senha_hash",
  "token", "secret", "accessToken", "refreshToken",
  "cpf", "dataNascimento", "telefone",
]);

/**
 * Recursively sanitize an object/array, replacing sensitive field values with
 * "[REDACTED]". Arrays are traversed element-by-element.
 * Max depth guard prevents prototype-pollution or stack-overflow on malicious input.
 */
function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map(item => sanitizeDeep(item, depth + 1));
  }

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    clean[k] = SENSITIVE_FIELDS.has(k) ? "[REDACTED]" : sanitizeDeep(v, depth + 1);
  }
  return clean;
}

function hashBody(body: unknown): string | null {
  if (!body || (typeof body === "object" && Object.keys(body as object).length === 0)) return null;
  try {
    return createHash("sha256").update(JSON.stringify(sanitizeDeep(body))).digest("hex");
  } catch {
    return null;
  }
}

export function privacySafeAuditPath(path: string): string {
  return path.replace(
    /^(\/api)?\/pre-consult\/[^/]+/,
    (_match, apiPrefix: string | undefined) => `${apiPrefix ?? ""}/pre-consult/:token`,
  ).replace(
    /^(\/api)?\/patient-orientations\/[^/]+/,
    (_match, apiPrefix: string | undefined) => `${apiPrefix ?? ""}/patient-orientations/:token`,
  );
}

function extractResource(path: string): { resourceType: string | null; resourceId: string | null } {
  const match = path.match(/^\/api\/([a-z-]+)(?:\/([^/]+))?/);
  if (!match) return { resourceType: null, resourceId: null };
  const resourceType = match[1] ?? null;
  const candidate = match[2] ?? null;
  const resourceId = candidate && /^\d+$/.test(candidate) ? candidate : null;
  return { resourceType, resourceId };
}

const SKIP_PATHS = new Set(["/api/healthz", "/api/health"]);

/**
 * Write an audit entry. Observable failure: logs a structured warning but
 * never throws or leaks PHI.
 */
async function writeAuditEntry(req: Request, statusCode: number, durationMs: number): Promise<void> {
  const endpoint = privacySafeAuditPath(req.path);
  const { resourceType, resourceId } = extractResource(endpoint);
  const bodyHash = req.method !== "GET" ? hashBody(req.body) : null;

  try {
    await db.insert(auditLogsTable).values({
      doctorId: req.doctorId ?? null,
      method: req.method,
      endpoint,
      resourceType,
      resourceId,
      ipAddress: (req.ip ?? req.socket.remoteAddress) ?? null,
      userAgent: req.get("User-Agent") ?? null,
      requestBodyHash: bodyHash,
      responseStatus: statusCode,
      durationMs,
    });
  } catch (err) {
    // Structured failure log — no PHI, only metadata
    logger.warn({
      event: "audit_log_write_failure",
      method: req.method,
      endpoint,
      responseStatus: statusCode,
      doctorId: req.doctorId ?? null,
      errCode: (err as NodeJS.ErrnoException)?.code ?? null,
      errMessage: err instanceof Error ? err.message : "unknown",
    }, "auditLog: failed to write entry");
  }
}

export function auditLog(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_PATHS.has(req.path) || req.method === "OPTIONS") {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  // Register a single "finish" listener — fires after ALL response formats
  // (json, send, sendFile, download, pipe, etc.) once the response is fully sent.
  // This avoids double-writes that patching res.json + res.send would cause.
  res.once("finish", () => {
    const elapsedNs = process.hrtime.bigint() - startedAt;
    const durationMs = Math.max(0, Math.round(Number(elapsedNs) / 1_000_000));
    setImmediate(() => {
      writeAuditEntry(req, res.statusCode, durationMs).catch(() => {
        // already handled inside writeAuditEntry; this outer catch prevents
        // unhandled promise rejection if the logger itself throws.
      });
    });
  });

  next();
}

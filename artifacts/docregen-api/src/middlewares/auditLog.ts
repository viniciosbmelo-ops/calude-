import { createHash } from "node:crypto";
import { type Request, type Response, type NextFunction } from "express";
import { db, auditLogsTable } from "@workspace/docregen-db";
import { logger } from "../lib/logger";
import { publicLinkToken, redactPath, sha256Hex } from "../lib/redaction";
import { API_PREFIX } from "../lib/api-prefix";

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

/** Endpoint as persisted in audit_logs: no query string, public-link tokens redacted. */
export function privacySafeAuditPath(path: string): string {
  return redactPath(path) ?? "";
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Resource type/id from a (redacted) endpoint, with or without the API prefix:
 *   /regen-api/patients/12            → patients / 12
 *   /regen/cases/<uuid>/procedures    → regen/cases / <uuid>
 *   /secretaries/3                    → secretaries / 3
 *   /pre-consult/:token/answers       → pre-consult / null
 */
export function extractResource(path: string): { resourceType: string | null; resourceId: string | null } {
  const withoutPrefix = path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
  const segments = withoutPrefix.split("?")[0]!.split("/").filter(Boolean);
  if (!segments.length || !/^[a-z][a-z-]*$/.test(segments[0]!)) {
    return { resourceType: null, resourceId: null };
  }
  let typeSegments = 1;
  // Namespaced collections: /regen/cases/:id, /patient/regen/:token, /secretary/regen-cases
  if (
    segments.length > 1 &&
    ["regen", "patient", "secretary", "lgpd", "stats"].includes(segments[0]!) &&
    /^[a-z][a-z-]*$/.test(segments[1]!)
  ) {
    typeSegments = 2;
  }
  const resourceType = segments.slice(0, typeSegments).join("/");
  const candidate = segments[typeSegments] ?? null;
  const resourceId = candidate && ID_SEGMENT.test(candidate) ? candidate : null;
  return { resourceType, resourceId };
}

export type AuditActorRole = "doctor" | "secretary" | "patient_link" | "anonymous";

export function auditActor(req: Pick<Request, "role" | "doctorId" | "secretaryId" | "originalUrl">): {
  actorRole: AuditActorRole;
  doctorId: number | null;
  secretaryId: number | null;
  patientLinkHash: string | null;
} {
  if (req.role === "secretary") {
    return { actorRole: "secretary", doctorId: req.doctorId ?? null, secretaryId: req.secretaryId ?? null, patientLinkHash: null };
  }
  if (req.role === "doctor" && req.doctorId) {
    return { actorRole: "doctor", doctorId: req.doctorId, secretaryId: null, patientLinkHash: null };
  }
  const token = publicLinkToken(req.originalUrl ?? "");
  if (token) {
    return { actorRole: "patient_link", doctorId: null, secretaryId: null, patientLinkHash: sha256Hex(token) };
  }
  return { actorRole: "anonymous", doctorId: null, secretaryId: null, patientLinkHash: null };
}

const SKIP_PATHS = new Set([`${API_PREFIX}/healthz`, `${API_PREFIX}/health`, `${API_PREFIX}/readyz`]);

/**
 * Write an audit entry. Observable failure: logs a structured warning but
 * never throws or leaks PHI.
 */
async function writeAuditEntry(req: Request, statusCode: number, durationMs: number): Promise<void> {
  // originalUrl keeps the API prefix whatever router the request ended in
  // (req.path is relative to the mount point and lost the prefix).
  const endpoint = privacySafeAuditPath(req.originalUrl);
  const { resourceType, resourceId } = extractResource(endpoint);
  const bodyHash = req.method !== "GET" ? hashBody(req.body) : null;
  const actor = auditActor(req);

  try {
    await db.insert(auditLogsTable).values({
      doctorId: actor.doctorId,
      actorRole: actor.actorRole,
      secretaryId: actor.secretaryId,
      patientLinkHash: actor.patientLinkHash,
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
  if (SKIP_PATHS.has(redactPath(req.originalUrl) ?? "") || req.method === "OPTIONS") {
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

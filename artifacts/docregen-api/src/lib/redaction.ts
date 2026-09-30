/**
 * Single source of truth for removing secrets from request paths before they
 * are persisted or logged (page_visits, audit_logs, pino request logs,
 * security events).
 *
 * Public links carry bearer secrets in the path (pre-consulta and follow-up
 * tokens, temporary PDF ids, orientation JWTs) or in the query string
 * (password reset, orientation links). They are replaced by placeholders;
 * query strings are dropped from stored paths and have sensitive parameters
 * masked in logs.
 */
import { createHash } from "node:crypto";
import { API_PREFIX } from "./api-prefix";

/** Frontend base paths the SPA may be served under (VisitTracker sends the full pathname). */
const FRONTEND_BASES = ["/docregen"];

const API = API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** [pattern, placeholder] — patterns match the path without its query string. */
const TOKEN_PATH_RULES: ReadonlyArray<[RegExp, string]> = [
  // API: public pre-consultation link
  [new RegExp(`^(${API})?/pre-consult/[^/]+`), "$1/pre-consult/:token"],
  // API: public follow-up (PROM) link
  [new RegExp(`^(${API})?/patient/regen/[^/]+`), "$1/patient/regen/:token"],
  // API: public orientation link
  [new RegExp(`^(${API})?/patient-orientations/(?!token$)[^/]+`), "$1/patient-orientations/:token"],
  // API: temporary PDF (unguessable id)
  [new RegExp(`^(${API})?/pdf/temp/[^/]+`), "$1/pdf/temp/:id"],
  // SPA: public pages
  [/^\/pre-consulta\/[^/]+/, "/pre-consulta/:token"],
  [/^\/patient\/regen\/[^/]+/, "/patient/regen/:token"],
];

const SENSITIVE_QUERY_KEYS = new Set([
  "token", "t", "code", "key", "sig", "signature", "email", "cpf", "senha", "password",
]);

function stripFrontendBase(path: string): string {
  for (const base of FRONTEND_BASES) {
    if (path === base) return "/";
    if (path.startsWith(`${base}/`)) return path.slice(base.length);
  }
  return path;
}

/**
 * Path safe to persist: query/fragment removed, token segments replaced.
 * `stripBase` also removes the SPA base ("/docregen") — used for page visits.
 */
export function redactPath(raw: unknown, options: { stripBase?: boolean } = {}): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.split("#")[0]!.split("?")[0]!;
  if (options.stripBase) path = stripFrontendBase(path);
  for (const [pattern, placeholder] of TOKEN_PATH_RULES) {
    path = path.replace(pattern, placeholder);
  }
  return path;
}

/** URL safe to log: redacted path plus the query string with secret values masked. */
export function redactUrlForLog(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const [beforeHash] = raw.split("#");
  const queryIndex = beforeHash!.indexOf("?");
  const path = redactPath(queryIndex === -1 ? beforeHash : beforeHash!.slice(0, queryIndex)) ?? "";
  if (queryIndex === -1) return path;
  const params = new URLSearchParams(beforeHash!.slice(queryIndex + 1));
  const masked = [...params.entries()].map(([key, value]) =>
    `${encodeURIComponent(key)}=${SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? ":redacted" : encodeURIComponent(value)}`,
  );
  return masked.length ? `${path}?${masked.join("&")}` : path;
}

/** Public-link token carried by an API path, if any (pre-consulta / follow-up). */
export function publicLinkToken(rawPath: string): string | null {
  const path = rawPath.split("?")[0]!;
  const match = new RegExp(`^(?:${API})?/(?:pre-consult|patient/regen)/([^/]+)`).exec(path);
  return match?.[1] ?? null;
}

/** SHA-256 hex of a secret (link token, e-mail) for correlation without disclosure. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Short, non-reversible fingerprint of an identifier (e-mail/CPF) for logs. */
export function identifierFingerprint(value: string): string {
  return sha256Hex(value.trim().toLowerCase()).slice(0, 16);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

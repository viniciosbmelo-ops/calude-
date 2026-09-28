/**
 * Patient public-link session management.
 *
 * After a patient verifies their identity (CPF or DOB), the server issues a
 * short-lived, token-bound HttpOnly cookie.  Scale submission requires this
 * cookie and rejects requests without it.
 *
 * Cookie format  (base64url-encoded JSON payload + HMAC-SHA-256 signature):
 *   <base64url(JSON{typ,tokenType,linkToken,iat,exp})>.<base64url(hmac)>
 *
 * The exp field is checked server-side on every request, independently of the
 * cookie's maxAge, so even a stolen cookie reused before the browser purges it
 * is rejected once it has expired.
 *
 * Rate-limit / lockout:
 *   Persisted in PostgreSQL (patient_verification_attempts).
 *   Key = SHA-256(ip + "|" + linkToken) — no PII stored in clear.
 *   5 wrong attempts → 15-minute lockout, reset on success.
 *   Operations are atomic (upsert with row-level lock).
 */

import crypto from "node:crypto";
import type { Request, Response, CookieOptions } from "express";
import { pool } from "@workspace/db";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PATIENT_SESSION_COOKIE = "docknee_patient_session";
const PATIENT_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 h

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 min

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET not set");
  return s;
}

function b64uEncode(buf: Buffer | string): string {
  const b64 = Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): Buffer {
  // Restore standard base64 padding
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const rem = padded.length % 4;
  const withPad = rem === 0 ? padded : padded + "=".repeat(4 - rem);
  return Buffer.from(withPad, "base64");
}

export type PatientTokenType = "classic" | "regen" | "preconsult";

interface TokenPayload {
  typ: "patient-session";
  tokenType: PatientTokenType;
  linkToken: string;
  iat: number; // epoch seconds
  exp: number; // epoch seconds
}

// ─── Token sign / verify ──────────────────────────────────────────────────────

/**
 * Build a signed session cookie value bound to `tokenType` and `linkToken`.
 * Includes `iat` and `exp` claims (server-side expiry, independent of maxAge).
 */
export function buildPatientSessionToken(
  tokenType: PatientTokenType,
  linkToken: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    typ: "patient-session",
    tokenType,
    linkToken,
    iat: now,
    exp: now + Math.floor(PATIENT_SESSION_TTL_MS / 1000),
  };
  const payloadB64 = b64uEncode(JSON.stringify(payload));
  const mac = crypto
    .createHmac("sha256", sessionSecret())
    .update(payloadB64)
    .digest();
  return `${payloadB64}.${b64uEncode(mac)}`;
}

/**
 * Verify the cookie value, check the HMAC and exp.
 * Returns `{ tokenType, linkToken }` or null on any failure.
 */
export function verifyPatientSessionToken(
  cookie: string,
): { tokenType: PatientTokenType; linkToken: string } | null {
  if (!cookie || typeof cookie !== "string") return null;
  const dotIdx = cookie.lastIndexOf(".");
  if (dotIdx < 1) return null;

  const payloadB64 = cookie.slice(0, dotIdx);
  const macB64 = cookie.slice(dotIdx + 1);

  // Reconstruct expected MAC
  const expectedMac = crypto
    .createHmac("sha256", sessionSecret())
    .update(payloadB64)
    .digest();

  let macBuf: Buffer;
  try {
    macBuf = b64uDecode(macB64);
  } catch {
    return null;
  }

  // Constant-time comparison — must be same length
  if (macBuf.length !== expectedMac.length) return null;
  if (!crypto.timingSafeEqual(macBuf, expectedMac)) return null;

  // Decode payload
  let payload: unknown;
  try {
    payload = JSON.parse(b64uDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as Record<string, unknown>)["typ"] !== "patient-session"
  ) {
    return null;
  }

  const p = payload as Record<string, unknown>;
  const tokenType = p["tokenType"] as string;
  const linkToken = p["linkToken"] as string;
  const exp = p["exp"] as number;

  if (
    tokenType !== "classic" &&
    tokenType !== "regen" &&
    tokenType !== "preconsult"
  ) return null;
  if (typeof linkToken !== "string" || !linkToken) return null;
  if (typeof exp !== "number" || Math.floor(Date.now() / 1000) >= exp) return null;

  return { tokenType: tokenType as PatientTokenType, linkToken };
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: PATIENT_SESSION_TTL_MS,
  };
}

export function issuePatientSession(
  res: Response,
  tokenType: PatientTokenType,
  linkToken: string,
): void {
  const value = buildPatientSessionToken(tokenType, linkToken);
  res.cookie(PATIENT_SESSION_COOKIE, value, cookieOptions());
}

export function revokePatientSession(res: Response): void {
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(PATIENT_SESSION_COOKIE, opts);
}

export function getPatientSession(
  req: Request,
): { tokenType: PatientTokenType; linkToken: string } | null {
  const raw = req.cookies?.[PATIENT_SESSION_COOKIE];
  if (typeof raw !== "string" || !raw) return null;
  return verifyPatientSessionToken(raw);
}

// ─── Lockout helpers ──────────────────────────────────────────────────────────

/**
 * SHA-256 hash of `ip + "|" + linkToken` — avoids storing PII or link tokens
 * in the database.
 */
function lockKeyHash(ip: string, linkToken: string): string {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${linkToken}`)
    .digest("hex");
}

/**
 * Check if the IP+token is currently locked out.
 * Returns remaining ms if locked, 0 if not.
 * Atomic: reads a single row, cleans up expired lock transparently.
 */
export async function checkLockout(req: Request, linkToken: string): Promise<number> {
  const ip = req.ip ?? "unknown";
  const kh = lockKeyHash(ip, linkToken);
  const { rows } = await pool.query(
    `SELECT locked_until FROM patient_verification_attempts WHERE key_hash = $1`,
    [kh],
  );
  if (!rows.length || rows[0].locked_until === null) return 0;
  const remaining = new Date(rows[0].locked_until).getTime() - Date.now();
  if (remaining <= 0) {
    // Expired — clean up lazily
    await pool.query(
      `UPDATE patient_verification_attempts SET locked_until = NULL, attempts = 0, updated_at = now()
       WHERE key_hash = $1`,
      [kh],
    );
    return 0;
  }
  return remaining;
}

/**
 * Record a failed verification attempt atomically.
 * Upserts the row and sets locked_until once MAX_ATTEMPTS is reached.
 */
export async function recordFailedAttempt(req: Request, linkToken: string): Promise<void> {
  const ip = req.ip ?? "unknown";
  const kh = lockKeyHash(ip, linkToken);
  await pool.query(
    `INSERT INTO patient_verification_attempts (key_hash, attempts, locked_until, updated_at)
     VALUES ($1, 1, NULL, now())
     ON CONFLICT (key_hash) DO UPDATE
       SET attempts    = patient_verification_attempts.attempts + 1,
           locked_until = CASE
             WHEN patient_verification_attempts.attempts + 1 >= $2
               THEN now() + ($3 || ' milliseconds')::interval
             ELSE NULL
           END,
           updated_at  = now()`,
    [kh, MAX_ATTEMPTS, LOCKOUT_MS.toString()],
  );
}

/**
 * Clear lockout state after a successful verification.
 */
export async function clearLockout(req: Request, linkToken: string): Promise<void> {
  const ip = req.ip ?? "unknown";
  const kh = lockKeyHash(ip, linkToken);
  await pool.query(
    `DELETE FROM patient_verification_attempts WHERE key_hash = $1`,
    [kh],
  );
}

// ─── Cookie presence check (used by app.ts hasAnySessionCookie) ───────────────

export function hasPatientSessionCookie(req: Request): boolean {
  const raw = req.cookies?.[PATIENT_SESSION_COOKIE];
  return typeof raw === "string" && raw.length > 0;
}

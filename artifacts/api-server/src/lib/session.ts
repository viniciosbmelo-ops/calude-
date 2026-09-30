import type { Request, Response, CookieOptions } from "express";

export const SESSION_COOKIE_NAMES = {
  doctor: "docknee_session",
  secretary: "docknee_secretary_session",
  service: "docknee_service_session",
  patient: "docknee_patient_session",
} as const;

export type SessionRole = keyof typeof SESSION_COOKIE_NAMES;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: SESSION_TTL_MS,
  };
}

function clearCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  return options;
}

/**
 * Cookies of roles that no longer exist (the physiotherapist portal was
 * removed). They are never read, only cleared so stale browsers drop them.
 */
const RETIRED_SESSION_COOKIE_NAMES = ["docknee_physio_session"] as const;

export function clearAllSessionCookies(res: Response): void {
  for (const cookieName of [...Object.values(SESSION_COOKIE_NAMES), ...RETIRED_SESSION_COOKIE_NAMES]) {
    res.clearCookie(cookieName, clearCookieOptions());
  }
}

export function establishSession(
  res: Response,
  role: SessionRole,
  token: string,
): void {
  clearAllSessionCookies(res);
  res.cookie(SESSION_COOKIE_NAMES[role], token, cookieOptions());
}

export function getSessionCookie(
  req: Request,
  role: SessionRole,
): string | null {
  const value = req.cookies?.[SESSION_COOKIE_NAMES[role]];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function hasAnySessionCookie(req: Request): boolean {
  return Object.values(SESSION_COOKIE_NAMES).some((name) => {
    const value = req.cookies?.[name];
    return typeof value === "string" && value.length > 0;
  });
}